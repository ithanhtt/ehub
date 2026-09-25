'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isAPIError } from 'better-auth/api'
import { auth } from '@/core/auth/auth'
import { redactSecrets } from '@/core/plugins/http'
import { clientAddress, recordSignInFailure, recordSignInSuccess, safeNext, signInAllowed } from '@/core/auth/sign-in-throttle'

/**
 * Signing in, done on the server — so the form works the moment it is on
 * screen, before the page's JavaScript has arrived.
 *
 * On a phone the page is often shown well before it can run: a tap on "Sign
 * in" then submitted the form the browser's own way, which (the form had no
 * action) only reloaded the sign-in page, fields empty and not a word said —
 * what people saw. As a server action (React's form actions), the same form
 * posts here with or without JavaScript. better-auth's nextCookies plugin sets
 * the session cookie on the response, and the redirect is the server's.
 *
 * Every failure says what it is: wrong email or password, too many tries, a
 * page opened over http where the session cookie can only travel over https
 * (it would be dropped and the next page would bounce back here unexplained),
 * or the server itself (its detail goes to the log).
 */

export type SignInState = {
  error: null | 'invalid' | 'tooMany' | 'insecure' | 'unavailable'
  /** Kept, so a failed try does not make the reader type the address again. */
  email: string
  /** The address to open the app at, when the one used cannot keep the session. */
  url?: string
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export async function signInAction(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get('email') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const next = safeNext(form.get('next'))
  if (!email || !password) return { error: 'invalid', email }

  const requestHeaders = await headers()
  // Called directly, better-auth's own rate limit does not apply: ours does (sign-in-throttle.ts).
  const ip = clientAddress(requestHeaders)
  if (!signInAllowed(ip, email).ok) return { error: 'tooMany', email }
  // The session cookie is marked Secure when the app's address is https: a browser drops it over plain http.
  const base = process.env.BETTER_AUTH_URL ?? ''
  const proto = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? ''
  if (base.startsWith('https://') && proto === 'http' && !LOCAL.test(host)) {
    return { error: 'insecure', email, url: base }
  }

  try {
    await auth.api.signInEmail({ body: { email, password }, headers: requestHeaders })
  } catch (error) {
    const status = isAPIError(error) ? ((error as { statusCode?: number }).statusCode ?? 0) : 0
    if (status === 401) {
      recordSignInFailure(ip, email)
      return { error: 'invalid', email }
    }
    if (status === 429) return { error: 'tooMany', email }
    console.error('[auth] sign-in failed:', redactSecrets(error instanceof Error ? error.message : String(error)))
    return { error: 'unavailable', email }
  }
  recordSignInSuccess(email)
  // Outside the try: redirect() works by throwing.
  redirect(next)
}
