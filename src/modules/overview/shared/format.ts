import { useLocale, useTranslations } from 'next-intl'
import { formatCompact, formatMoney, formatNumber } from '@/core/utils/format'
import { useOverview } from '../context'

/** Money and counts as the page writes them. */
export function useFigures() {
  const locale = useLocale()
  return {
    /** "485,8 Tr ₫". */
    money: (value: number) => `${formatCompact(value, locale)} ₫`,
    /** "485.800.000 ₫". */
    exact: (value: number) => formatMoney(value, locale),
    count: (value: number) => formatNumber(value, locale),
    number: (value: number, digits: number) => formatNumber(value, locale, digits),
  }
}

/** A trend's positions in words: short for the axis, in full for the tooltip and the table. */
export function useTimeLabels() {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const { isToday } = useOverview()
  const day = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })
  return {
    /** "14:00", or "08/09". */
    tick: (at: string) => (isToday ? at.slice(11, 16) : `${at.slice(8, 10)}/${at.slice(5, 7)}`),
    /** Today's points are running totals: "to 14:00" for a finished hour, "now" for the last; days as "Mon 08/09". */
    full: (at: string, index: number, length: number) =>
      isToday
        ? index === length - 1
          ? t('now')
          : t('untilHour', { time: `${String((Number(at.slice(11, 13)) + 1) % 24).padStart(2, '0')}:00` })
        : day.format(new Date(`${at}T00:00:00Z`)),
  }
}

/** What every trend chart says around its marks: the table toggle, number formats, the legend's words. */
export function useChartSetup() {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const { range } = useOverview()
  const { exact, count } = useFigures()
  return {
    labels: { chart: t('showChart'), table: t('showTable') },
    formats: { moneyExact: exact, count, tick: (value: number) => formatCompact(value, locale) },
    text: {
      compare: t(`compareWith.${range}`),
      current: t(`current.${range}`),
      previous: t(`previous.${range}`),
      toggle: t('toggleLine'),
      unitMoney: '₫',
      unitCount: t('unitCount'),
      lumped: t('lumpedNote'),
    },
  }
}
