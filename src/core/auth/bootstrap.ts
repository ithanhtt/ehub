import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { user } from '@/core/db/schema/auth'

/**
 * "Has anybody claimed this installation yet?"
 *
 * One definition, two callers that must agree: the sign-up hook that grants
 * the platform role to the first account, and the sign-in screen that tells a
 * visitor there is nothing to sign in to yet. If those two ever disagreed,
 * someone would be told their password is wrong on an empty database — which
 * is exactly the confusion this function exists to prevent.
 */
export async function countAccounts(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(user)
  return row?.count ?? 0
}

export async function isFreshInstall(): Promise<boolean> {
  try {
    return (await countAccounts()) === 0
  } catch {
    // An unreachable or unmigrated database is not a fresh install; saying so
    // would send the visitor to a sign-up page that cannot work either.
    return false
  }
}
