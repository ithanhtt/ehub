'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { SortableTable } from '@/components/charts/chart-card'
import { HourColumns } from '@/components/charts/hour-columns'
import { tableCell } from '@/modules/overview/shared/series'
import { DetailsDialog, InsightCard } from '@/modules/overview/shared/insight-card'
import { SERIES, useSyncBadge } from '@/modules/analytics/shared/cards'
import { useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { bestHours, hourSpan, useOrderCancel } from '../../shared'

/**
 * When in the day orders come in, and when they are cancelled least — for the
 * whole store or one product. Two views of the same 24 hours: orders placed,
 * with the busiest hour in full color; and the share of each hour's orders
 * later cancelled, with the hour cancelled least in full color. An hour with
 * too few orders to judge is left out of the second view, so a quiet hour never
 * passes for a safe one.
 */
function OrderCancelHours() {
  const t = useTranslations('reports.orderCancel')
  const tr = useTranslations('reports')
  const { report, periodLabel } = useOrderCancel()
  const { count, number, percent } = useReportFigures()
  const badge = useSyncBadge(['sapo'])
  const [product, setProduct] = useState('all')
  const [view, setView] = useState<'orders' | 'rate'>('orders')
  const [open, setOpen] = useState(false)
  const { hours, products } = report.data

  const chosen = products.find((p) => p.key === product)
  const created = chosen ? chosen.hours.map(([orders]) => orders) : hours.created
  const cancelled = chosen ? chosen.hours.map(([, cancels]) => cancels) : hours.cancelled
  const { busiest, safest, floor } = bestHours(created, cancelled)
  const rates = created.map((orders, hour) => (orders >= floor && orders > 0 ? cancelled[hour] / orders : null))

  const hourText = {
    hourRange: hourSpan,
    hourTick: (hour: number) => `${hour}h`,
    inProgress: '',
    reference: t('cancelled'),
  }

  const body = (expanded: boolean) => (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        <TextField select size="small" value={chosen ? product : 'all'} onChange={(event) => setProduct(event.target.value)} sx={{ minWidth: 220, maxWidth: '100%' }}>
          <MenuItem value="all">{t('allProducts')}</MenuItem>
          {products.slice(0, 200).map((p) => (
            <MenuItem key={p.key} value={p.key}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <ToggleButtonGroup exclusive size="small" value={view} onChange={(_e, next: 'orders' | 'rate' | null) => next && setView(next)}>
          <ToggleButton value="orders" sx={{ textTransform: 'none', fontWeight: 600 }}>
            {t('viewOrders')}
          </ToggleButton>
          <ToggleButton value="rate" sx={{ textTransform: 'none', fontWeight: 600 }}>
            {t('viewRate')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {busiest === null
          ? tr('noData')
          : t('hoursVerdict', {
              busiest: hourSpan(busiest),
              orders: count(created[busiest]),
              safest: safest === null ? t('safestNone') : hourSpan(safest),
              rate: safest === null ? '—' : percent(cancelled[safest] / created[safest]),
            })}
      </Typography>
      {view === 'orders' ? (
        <HourColumns
          values={created}
          reference={cancelled}
          peak={busiest === null ? null : { start: busiest, end: busiest }}
          color={SERIES.aqua}
          height={expanded ? 320 : 180}
          format={count}
          formatTick={count}
          text={{ ...hourText, unit: tr('unitOrders'), value: t('created'), inPeak: t('busiestHour') }}
          ariaLabel={t('hoursTitle')}
        />
      ) : (
        <HourColumns
          values={rates.map((rate) => (rate === null ? null : rate * 100))}
          peak={safest === null ? null : { start: safest, end: safest }}
          color={SERIES.orange}
          height={expanded ? 320 : 180}
          format={(value) => `${number(value, 1)}%`}
          formatTick={(value) => `${number(value, 0)}%`}
          detail={(hour) => t('rateDetail', { cancelled: count(cancelled[hour]), orders: count(created[hour]) })}
          text={{ ...hourText, unit: '%', value: t('cancelRateColumn'), inPeak: t('safestHour') }}
          ariaLabel={t('hoursTitle')}
        />
      )}
      {expanded ? (
        <SortableTable
          table={{
            columns: [t('hour'), t('created'), t('cancelled'), t('cancelRateColumn')],
            rows: created.map((orders, hour) => [
              hourSpan(hour),
              tableCell(orders, count),
              tableCell(cancelled[hour], count),
              tableCell(orders > 0 ? cancelled[hour] / orders : null, (v) => percent(v)),
            ]),
          }}
          sort={null}
          onSortChange={() => {}}
          maxHeight={360}
        />
      ) : null}
      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
        {t('hoursNote', { days: hours.days, floor })}
      </Typography>
    </Stack>
  )

  return (
    <>
      <InsightCard
        title={t('hoursTitle')}
        subtitle={periodLabel}
        badge={badge}
        expand={{ label: tr('expand'), onClick: () => setOpen(true) }}
      >
        {body(false)}
      </InsightCard>
      <DetailsDialog open={open} onClose={() => setOpen(false)} title={t('hoursTitle')} closeLabel={tr('close')}>
        {body(true)}
      </DetailsDialog>
    </>
  )
}

export const orderCancelHoursWidget: ReportWidget = {
  id: 'order-cancel-hours',
  band: 'trend',
  order: 20,
  sources: ['sapo'],
  size: { xs: 12, lg: 5 },
  Component: OrderCancelHours,
}
