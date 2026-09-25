import { useTranslations } from 'next-intl'

/** Case- and accent-insensitive, so "sua rua mat" finds "Sữa rửa mặt" (see fold.ts). */
export { fold } from './fold'

/** "2 giờ 15 phút", "1 ngày 3 giờ". */
export function useDuration() {
  const t = useTranslations('dashboard')
  return (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 60_000))
    if (total < 60) return t('durMinutes', { m: total })
    if (total < 1440) {
      const h = Math.floor(total / 60)
      return total % 60 ? t('durHoursMinutes', { h, m: total % 60 }) : t('durHours', { h })
    }
    const d = Math.floor(total / 1440)
    const h = Math.floor((total % 1440) / 60)
    return h ? t('durDaysHours', { d, h }) : t('durDays', { d })
  }
}
