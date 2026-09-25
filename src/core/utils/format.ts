export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatDateTime(value: Date | string | null | undefined, locale: string): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date)
}

const numberLocale = (locale: string) => (locale === 'vi' ? 'vi-VN' : 'en-US')

/** 12,9 Tr / 1,2 T — for tiles and axis ticks, where the exact đồng is noise. */
export function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(numberLocale(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** Exact amount with the currency, for tooltips and tables. */
export function formatMoney(value: number, locale: string, currency = 'VND'): string {
  return new Intl.NumberFormat(numberLocale(locale), { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

export function formatNumber(value: number, locale: string, fractionDigits = 0): string {
  return new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: fractionDigits }).format(value)
}

/** Two-letter monogram for avatars, taken from the last words of a name. */
export function initialsOf(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

/**
 * A line as it opens a sentence: its first letter capitalised ("hôm nay · …"
 * → "Hôm nay · …"). Text opening with a figure or a sign is left as it is,
 * and so is the rest of it — a period's name ("hôm nay") stays lowercase
 * where it runs on inside a sentence, and is capitalised only where it leads.
 */
export function capitalizeFirst(text: string, locale?: string): string {
  const first = text.codePointAt(0)
  if (first === undefined) return text
  const char = String.fromCodePoint(first)
  if (!/\p{L}/u.test(char)) return text
  return char.toLocaleUpperCase(locale) + text.slice(char.length)
}
