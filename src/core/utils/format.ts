export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
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
