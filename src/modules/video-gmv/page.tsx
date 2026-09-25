'use client'

import { useTranslations } from 'next-intl'
import { ReportPage } from '@/modules/analytics/shell/report-page'
import { VIDEO_GMV_SOURCES } from './module'
import { VIDEO_GMV_WIDGETS } from './widgets'

/** The video & product GMV page: the report frame with this module's widgets. */
export function VideoGmvPage({ projectId, connected }: { projectId: string; connected: string[] }) {
  const t = useTranslations('reports.videoGmv')
  return (
    <ReportPage
      projectId={projectId}
      moduleId="video-gmv"
      title={t('title')}
      description={t('description')}
      sources={VIDEO_GMV_SOURCES}
      connected={connected}
      widgets={VIDEO_GMV_WIDGETS}
    />
  )
}
