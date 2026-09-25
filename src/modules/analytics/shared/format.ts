'use client'

import { useLocale, useTranslations } from 'next-intl'
import { formatCompact, formatMoney, formatNumber } from '@/core/utils/format'
import { useReport } from '../context'

/** Figures as the reports write them. */
export function useReportFigures() {
  const locale = useLocale()
  return {
    /** "485,8 Tr ₫". */
    money: (value: number) => `${formatCompact(value, locale)} ₫`,
    /** "485.800.000 ₫". */
    exact: (value: number) => formatMoney(value, locale),
    count: (value: number) => formatNumber(value, locale),
    number: (value: number, digits: number) => formatNumber(value, locale, digits),
    compact: (value: number) => formatCompact(value, locale),
    /** "12,5%" from a share (0.125). */
    percent: (share: number, digits = 1) => `${formatNumber(share * 100, locale, digits)}%`,
  }
}

/** A bucket in words: short for an axis, in full for a tooltip or a table. */
export function useBucketLabels() {
  const t = useTranslations('reports')
  const locale = useLocale()
  const { granularity } = useReport()
  const day = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return {
    /** "08/09", or "T9/26". */
    tick: (at: string) =>
      granularity === 'month' ? t('monthTick', { month: Number(at.slice(5, 7)), year: at.slice(2, 4) }) : `${at.slice(8, 10)}/${at.slice(5, 7)}`,
    /** "Th 2, 08/09/2026", or "Tháng 9/2026". */
    full: (at: string) =>
      granularity === 'month' ? t('monthFull', { month: Number(at.slice(5, 7)), year: at.slice(0, 4) }) : day.format(new Date(`${at}T00:00:00Z`)),
  }
}

/** The chart words every trend card shares. */
export function useTrendText() {
  const t = useTranslations('reports')
  return {
    labels: { chart: t('showChart'), table: t('showTable') },
    text: (unitMoney: string, unitCount: string) => ({
      compare: t('compare'),
      current: t('current'),
      previous: t('previous'),
      toggle: t('toggleLine'),
      unitMoney,
      unitCount,
      lumped: '',
    }),
  }
}
