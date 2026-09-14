'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { isLocale, LOCALE_COOKIE, type Locale } from './config'

export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return

  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  })

  // Every rendered page embeds translated strings, so the whole tree is stale.
  revalidatePath('/', 'layout')
}
