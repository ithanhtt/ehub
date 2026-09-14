import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './config'

/**
 * Locale lives in a cookie, not in the URL.
 *
 * Ads and order data are read behind a login, so there is nothing to gain from
 * indexable /vi and /en paths — and keeping the segment out means project
 * routes stay short and every internal link works without a locale-aware
 * router wrapper.
 */
export default getRequestConfig(async () => {
  const store = await cookies()
  const cookieLocale = store.get(LOCALE_COOKIE)?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'Asia/Ho_Chi_Minh',
  }
})
