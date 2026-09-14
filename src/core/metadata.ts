import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

/**
 * A page's tab title, from the same message the page shows as its heading:
 * `export const generateMetadata = titled('nav', 'apiHub')`. The layouts
 * above add the rest — "API Hub · <project> · EHub".
 */
export function titled(namespace: string, key: string) {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations(namespace)
    return { title: t(key) }
  }
}
