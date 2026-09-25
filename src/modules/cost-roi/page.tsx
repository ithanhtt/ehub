'use client'

import { useTranslations } from 'next-intl'
import { ReportPage } from '@/modules/analytics/shell/report-page'
import { COST_ROI_SOURCES } from './module'
import { COST_ROI_WIDGETS } from './widgets'

/** The cost & ROI page: the report frame with this module's widgets. */
export function CostRoiPage({ projectId, connected }: { projectId: string; connected: string[] }) {
  const t = useTranslations('reports.costRoi')
  return (
    <ReportPage
      projectId={projectId}
      moduleId="cost-roi"
      title={t('title')}
      description={t('description')}
      sources={COST_ROI_SOURCES}
      connected={connected}
      widgets={COST_ROI_WIDGETS}
    />
  )
}
