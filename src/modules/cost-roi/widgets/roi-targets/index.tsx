'use client'

import { useTranslations } from 'next-intl'
import { tableCell } from '@/modules/overview/shared/series'
import { TableCard } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { roiOf, useCostRoi } from '../../shared'

/**
 * Per product on GMV Max: its ROI target now, the ROI it actually made, and
 * — from the days each target was in force — the target that delivered best.
 * The history starts the first day this report was opened (TikTok keeps no
 * record of past targets), and says how many days it rests on.
 */
function CostRoiTargets() {
  const t = useTranslations('reports.costRoi')
  const tr = useTranslations('reports')
  const { report, periodLabel } = useCostRoi()
  const { exact, number, count } = useReportFigures()
  const { products, targetDays } = report.data
  const rows = products.filter((p) => p.adsCost > 0)
  const level = (target: number | null) => (target === null ? '—' : number(target, 2))

  return (
    <TableCard
      title={t('roiTitle')}
      subtitle={periodLabel}
      empty={t('roiEmpty')}
      note={t('roiNote2', { days: targetDays })}
      table={{
        columns: [
          t('product'),
          t('adsCost'),
          t('adsRevenue'),
          t('adsOrders'),
          { label: t('roiActual'), tip: t('roiActualTip') },
          { label: t('roiTarget'), tip: t('roiTargetTip') },
          { label: t('roiBest'), tip: t('roiBestTip') },
          { label: t('roiBestActual'), tip: t('roiBestActualTip') },
          t('roiLevels'),
        ],
        rows: rows.map((p) => [
          p.name,
          tableCell(p.adsCost, exact),
          tableCell(p.adsRevenue, exact),
          tableCell(p.adsOrders, count),
          tableCell(roiOf(p.adsRevenue, p.adsCost), (v) => number(v, 2)),
          { text: level(p.target), sort: p.target },
          { text: p.best ? level(p.best.target) : tr('notEnough'), sort: p.best?.target ?? null },
          tableCell(p.best ? roiOf(p.best.revenue, p.best.cost) : null, (v) => number(v, 2)),
          p.levels.map((l) => `${number(l.target, 2)} → ${number(l.revenue / Math.max(l.cost, 1), 2)} (${l.days}d)`).join(' · ') || '—',
        ]),
      }}
    />
  )
}

export const costRoiTargetsWidget: ReportWidget = {
  id: 'cost-roi-targets',
  band: 'table',
  order: 10,
  sources: ['tiktokAds'],
  size: { xs: 12 },
  Component: CostRoiTargets,
}
