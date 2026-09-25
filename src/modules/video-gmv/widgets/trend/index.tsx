'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { tableCell } from '@/modules/overview/shared/series'
import { SERIES, TrendCard, useSyncBadge, type TrendPanel } from '@/modules/analytics/shared/cards'
import { useBucketLabels, useReportFigures } from '@/modules/analytics/shared/format'
import type { ReportWidget } from '@/modules/analytics/types'
import { useVideoGmv } from '../../shared'

/**
 * The three measures over the period — for the whole shop, or one product:
 * new videos with the product attached, the booked ones among them at the
 * foot of each column; below, on its own scale, the GMV.
 */
function VideoGmvTrend() {
  const t = useTranslations('reports.videoGmv')
  const tr = useTranslations('reports')
  const { report, connected, periodLabel } = useVideoGmv()
  const { count, exact } = useReportFigures()
  const { full } = useBucketLabels()
  const badge = useSyncBadge(['tiktokShop'])
  const [product, setProduct] = useState('all')
  const { buckets, products } = report.data
  const booking = connected.has('booking')
  const shop = connected.has('tiktokShop')

  const chosen = products.find((p) => p.key === product)
  const booked = chosen ? chosen.bookedByBucket : buckets.map((b) => b.booked)
  const attached = chosen ? chosen.attachedByBucket : buckets.map((b) => b.attached)
  const gmv = chosen ? chosen.gmvByBucket : buckets.map((b) => b.gmv)

  const panels: TrendPanel[] = [
    {
      kind: 'count',
      unit: tr('unitVideos'),
      bars: shop
        ? {
            key: 'attached',
            label: t('attached'),
            color: SERIES.blue,
            values: attached,
            part: booking ? { key: 'booked', label: t('booked'), color: SERIES.aqua, values: booked } : undefined,
          }
        : { key: 'booked', label: t('booked'), color: SERIES.aqua, values: booked },
    },
    ...(shop ? [{ kind: 'money' as const, unit: '₫', lines: [{ key: 'gmv', label: t('gmv'), color: SERIES.blue, values: gmv }] }] : []),
  ]

  return (
    <TrendCard
      title={chosen ? chosen.name : t('trendTitle')}
      subtitle={t('trendSubtitle', { period: periodLabel })}
      badge={badge}
      buckets={buckets.map((b) => b.at)}
      panels={panels}
      action={
        products.length > 0 ? (
          <TextField
            select
            size="small"
            aria-label={t('productFilter')}
            value={chosen ? product : 'all'}
            onChange={(event) => setProduct(event.target.value)}
            sx={{ width: { xs: 140, sm: 200 }, '& .MuiSelect-select': { py: 0.5, fontSize: '0.8125rem' } }}
          >
            <MenuItem value="all">{t('allProducts')}</MenuItem>
            {products.slice(0, 200).map((p) => (
              <MenuItem key={p.key} value={p.key}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        ) : undefined
      }
      table={{
        columns: [tr('time'), ...(booking ? [t('booked')] : []), ...(shop ? [t('attached'), t('gmv')] : [])],
        rows: [...buckets]
          .map((b, i) => [
            full(b.at),
            ...(booking ? [tableCell(booked[i], count)] : []),
            ...(shop ? [tableCell(attached[i], count, tr('pendingAnalytics')), tableCell(gmv[i], exact, tr('pending'))] : []),
          ])
          .reverse(),
      }}
    />
  )
}

export const videoGmvTrendWidget: ReportWidget = {
  id: 'video-gmv-trend',
  band: 'trend',
  order: 10,
  sources: [],
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 7 : 12 }),
  Component: VideoGmvTrend,
}
