'use client'

import { useTranslations } from 'next-intl'
import { ReportPage } from '@/modules/analytics/shell/report-page'
import { ORDER_CANCEL_SOURCES } from './module'
import { ORDER_CANCEL_WIDGETS } from './widgets'

/** The orders & cancellations page: the report frame with this module's widgets. */
export function OrderCancelPage({ projectId, connected }: { projectId: string; connected: string[] }) {
  const t = useTranslations('reports.orderCancel')
  return (
    <ReportPage
      projectId={projectId}
      moduleId="order-cancel"
      title={t('title')}
      description={t('description')}
      sources={ORDER_CANCEL_SOURCES}
      connected={connected}
      widgets={ORDER_CANCEL_WIDGETS}
    />
  )
}
