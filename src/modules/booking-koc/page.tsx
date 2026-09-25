'use client'

import { useTranslations } from 'next-intl'
import { ReportPage } from '@/modules/analytics/shell/report-page'
import { BOOKING_KOC_SOURCES } from './module'
import { BOOKING_KOC_WIDGETS } from './widgets'

/** The booking & KOC page: the report frame with this module's widgets. */
export function BookingKocPage({ projectId, connected }: { projectId: string; connected: string[] }) {
  const t = useTranslations('reports.bookingKoc')
  return (
    <ReportPage
      projectId={projectId}
      moduleId="booking-koc"
      title={t('title')}
      description={t('description')}
      sources={BOOKING_KOC_SOURCES}
      connected={connected}
      widgets={BOOKING_KOC_WIDGETS}
    />
  )
}
