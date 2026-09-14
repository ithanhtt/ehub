import 'server-only'

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { db } from '@/core/db/client'
import { account, session, user, verification } from '@/core/db/schema/auth'
import { APP_NAME } from '@/core/brand'
import { countAccounts } from './bootstrap'

/**
 * The very first account to register owns the installation.
 *
 * Self-hosted deployments have no out-of-band way to bless an administrator,
 * so the bootstrap account gets the platform role. Every later sign-up is an
 * ordinary user who must be invited into a project.
 */
async function roleForNewUser(): Promise<'admin' | 'user'> {
  try {
    return (await countAccounts()) === 0 ? 'admin' : 'user'
  } catch {
    // A counting failure must not block registration; default to least privilege.
    return 'user'
  }
}

/**
 * Authentication is deliberately a thin, replaceable layer.
 *
 * better-auth owns identity only: credentials, sessions, and the platform-wide
 * `admin` / `user` role. Everything about *what a user may do inside a
 * project* lives in core/auth/rbac.ts against our own tables, so adding an
 * OAuth provider or swapping the auth library later does not touch
 * authorisation logic.
 */
export const auth = betterAuth({
  appName: APP_NAME,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? '').split(',').filter(Boolean),

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // No mail transport is wired yet, so requiring verification would lock
    // every new account out. Flip this on together with sendVerificationEmail.
    requireEmailVerification: false,
    autoSignIn: true,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the cookie at most once a day
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  account: {
    accountLinking: { enabled: true },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => ({ data: { ...newUser, role: await roleForNewUser() } }),
      },
    },
  },

  plugins: [
    admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    // nextCookies() rewrites Set-Cookie for server actions and must stay last:
    // it wraps every response produced by the plugins declared before it.
    nextCookies(),
  ],
})

export type Auth = typeof auth
export type SessionUser = Awaited<ReturnType<typeof auth.api.getSession>> extends { user: infer U } | null
  ? U
  : never
