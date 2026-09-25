'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { HourColumns } from '@/components/charts/hour-columns'
import { TableScroll } from '@/components/ui/table-scroll'
import { usePreference } from '@/components/ui/use-preference'
import { formatCompact, formatNumber, capitalizeFirst } from '@/core/utils/format'
import type { DashboardData, GmvMaxTotals, ShopFigures } from '../../data/types'
import { useOverview } from '../../context'
import { DetailsDialog, InsightCard } from '../../shared/insight-card'
import type { OverviewWidget } from '../../types'

/** What the chart shows: the ads' ROI, spend or revenue, or a shop's sales. */
type Measure = 'roi' | 'cost' | 'revenue' | 'shop' | 'sapo'
const MEASURES: readonly Measure[] = ['roi', 'cost', 'revenue', 'shop', 'sapo']
const acceptMeasure = (value: unknown): Measure | null => (MEASURES.includes(value as Measure) ? (value as Measure) : null)

const COLOR: Record<Measure, string> = {
  roi: 'var(--adshub-series-3)',
  cost: 'var(--adshub-series-2)',
  revenue: 'var(--adshub-series-1)',
  shop: 'var(--adshub-series-1)',
  sapo: 'var(--adshub-series-3)',
}
const NUMERIC = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const

const roiOf = (f: GmvMaxTotals | null) => (f && f.cost > 0 ? f.revenue / f.cost : null)
const label = (hour: number) => `${String(hour).padStart(2, '0')}:00`

/** One hour across the three sources; null where a source has nothing for it (not connected, not read yet, ahead). */
type Hour = {
  ads: GmvMaxTotals | null
  shop: ShopFigures | null
  sapoOrders: number | null
  sapoSales: number | null
}

/**
 * The hours of the view across TikTok (GMV Max), TikTok Shop and Sapo, lined
 * up hour by hour: today's own hours, or — for a longer view — the average
 * day. Which sources there are, and the hours worth naming, come with it.
 */
function hoursOf(data: DashboardData, isToday: boolean) {
  const gmv = data.gmvMax?.hours.values.length ? data.gmvMax.hours : null
  const shop = data.tiktokShop?.hours.values.length ? data.tiktokShop.hours : null
  const sapo = data.sapo?.hours.profile.length ? data.sapo.hours : null
  const rows: Hour[] = Array.from({ length: 24 }, (_, hour) => ({
    ads: gmv?.values[hour] ?? null,
    shop: shop?.values[hour] ?? null,
    sapoOrders: sapo?.profile[hour] ?? null,
    sapoSales: sapo?.revenue[hour] ?? null,
  }))
  // Only today has an hour in progress: an average view marks none.
  const currentHour = isToday ? (gmv?.currentHour ?? shop?.currentHour ?? sapo?.currentHour ?? null) : null
  const shown = Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => !isToday || currentHour === null || hour <= currentHour)
  const viewRoi = roiOf(data.gmvMax?.totals ?? null)
  const spending = shown.filter((hour) => (rows[hour].ads?.cost ?? 0) > 0).map((hour) => ({ hour, roi: roiOf(rows[hour].ads)! }))
  const best = spending.length > 1 ? spending.reduce((a, b) => (b.roi > a.roi ? b : a)) : null
  const worst = spending.length > 1 ? spending.reduce((a, b) => (b.roi < a.roi ? b : a)) : null
  // The latest hour with figures, per source: today's most recent — for ads, the latest TikTok has broken down.
  const latest = (has: (row: Hour) => boolean) => (isToday ? [...shown].reverse().find((hour) => has(rows[hour])) ?? null : null)
  return {
    rows,
    shown,
    currentHour,
    viewRoi,
    best,
    worst,
    has: { ads: Boolean(gmv), shop: Boolean(shop), sapo: Boolean(sapo) },
    latestAds: latest((row) => row.ads !== null),
    latestShop: latest((row) => row.shop !== null),
    latestSapo: latest((row) => row.sapoOrders !== null),
  }
}
type Hours = ReturnType<typeof hoursOf>

/** ROI in colour: green above the view's own, orange below, red under 1 (losing money). */
const roiTone = (roi: number | null, viewRoi: number | null) =>
  roi === null ? 'text.disabled' : roi < 1 ? 'error.main' : viewRoi !== null && roi >= viewRoi ? 'success.main' : 'warning.main'

/** One figure as a dashboard tile: a short label, the number large, a line of context under it — nothing cut short. */
function Tile({ label, value, note, tone }: { label: string; value: string; note?: React.ReactNode; tone?: string }) {
  return (
    <Box sx={{ height: '100%', px: 1.5, py: 1.25, borderRadius: 1.5, bgcolor: 'action.hover' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: { xs: '1.2rem', sm: '1.3rem' }, fontWeight: 700, lineHeight: 1.25, color: tone, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>
        {value}
      </Typography>
      {note ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.3 }}>
          {note}
        </Typography>
      ) : null}
    </Box>
  )
}

/**
 * The glance, as a dashboard does it: one heading says which hour (the latest,
 * today) or that it is the average day, then a tile a figure — ad spend, ROI,
 * the TikTok Shop's sales, Sapo's — two across on a phone, four on a desk.
 * Under them, the ads' best and worst hours in words, so no hover is needed.
 */
function KeyHours({ hours, isToday, wide = false }: { hours: Hours; isToday: boolean; wide?: boolean }) {
  const t = useTranslations('dashboard.hourly')
  const locale = useLocale()
  const compact = (n: number) => formatCompact(n, locale)
  const count = (n: number) => formatNumber(n, locale, isToday ? 0 : 1)
  // The average day is the sum of the hours the chart and table show — the same figures, each hour over its own days.
  const sum = <T,>(pick: (row: Hour) => T | null, add: (a: T, b: T) => T): T | null =>
    hours.shown.reduce<T | null>((acc, hour) => {
      const v = pick(hours.rows[hour])
      return v === null ? acc : acc === null ? v : add(acc, v)
    }, null)

  // Today: the latest hour any source has. The ads come from the latest hour TikTok has broken down —
  // about an hour behind the shops — and say which hour when it is another.
  const latest = isToday ? [hours.latestAds, hours.latestShop, hours.latestSapo].reduce<number | null>((a, b) => (b !== null && (a === null || b > a) ? b : a), null) : null
  const row = latest === null ? null : hours.rows[latest]
  const ads = isToday
    ? hours.latestAds === null
      ? null
      : hours.rows[hours.latestAds].ads
    : sum((r) => r.ads, (a, b) => ({ cost: a.cost + b.cost, revenue: a.revenue + b.revenue, orders: a.orders + b.orders }))
  const shop = isToday ? (row?.shop ?? null) : sum((r) => r.shop, (a, b) => ({ ...a, orders: a.orders + b.orders, net: a.net + b.net }))
  const sapoOrders = isToday ? (row?.sapoOrders ?? null) : sum((r) => r.sapoOrders, (a, b) => a + b)
  const sapoSales = isToday ? (row?.sapoSales ?? null) : sum((r) => r.sapoSales, (a, b) => a + b)
  const roi = roiOf(ads)
  const adsLag = isToday && hours.latestAds !== null && hours.latestAds !== latest ? ` · ${label(hours.latestAds)}` : ''

  const tiles: Array<{ key: string; label: string; value: string; note?: React.ReactNode; tone?: string }> = []
  if (hours.has.ads) {
    tiles.push({ key: 'cost', label: `${t('tileCost')}${adsLag}`, value: ads ? compact(ads.cost) : '—', note: ads ? t('noteRevenue', { revenue: compact(ads.revenue) }) : undefined })
    tiles.push({
      key: 'roi',
      label: `${t('tileRoi')}${adsLag}`,
      value: roi === null ? '—' : formatNumber(roi, locale, 2),
      tone: roi === null ? undefined : roiTone(roi, hours.viewRoi),
      note: hours.viewRoi === null ? undefined : t('noteViewRoi', { roi: formatNumber(hours.viewRoi, locale, 2) }),
    })
  }
  if (hours.has.shop) tiles.push({ key: 'shop', label: t('tileShop'), value: shop ? compact(shop.net) : '—', note: shop ? t('noteOrders', { orders: count(shop.orders) }) : undefined })
  if (hours.has.sapo) tiles.push({ key: 'sapo', label: t('tileSapo'), value: sapoSales === null ? '—' : compact(sapoSales), note: sapoOrders === null ? undefined : t('noteOrders', { orders: count(sapoOrders) }) })

  const heading = isToday
    ? latest === null
      ? t('latest')
      : t(latest === hours.currentHour ? 'runningRange' : 'latestRange', { from: label(latest), to: label((latest + 1) % 24) })
    : t('averageDay')

  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.6, display: 'block' }}>
        {heading}
      </Typography>
      <Grid container spacing={1}>
        {tiles.map((tile) => (
          <Grid key={tile.key} size={{ xs: 6, ...(wide ? { md: 12 / Math.max(2, tiles.length) } : {}) }}>
            <Tile label={tile.label} value={tile.value} note={tile.note} tone={tile.tone} />
          </Grid>
        ))}
      </Grid>
      {hours.has.ads && (hours.best || hours.worst) ? (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 1 }}>
          {hours.best ? (
            <Chip size="small" color="success" variant="outlined" label={t('bestChip', { hour: label(hours.best.hour), roi: formatNumber(hours.best.roi, locale, 2) })} />
          ) : null}
          {hours.worst && hours.worst.hour !== hours.best?.hour ? (
            <Chip size="small" color={hours.worst.roi < 1 ? 'error' : 'warning'} variant="outlined" label={t('worstChip', { hour: label(hours.worst.hour), roi: formatNumber(hours.worst.roi, locale, 2) })} />
          ) : null}
        </Stack>
      ) : null}
    </Box>
  )
}

/** The day's shape in one measure; ROI against the view's own (a tick across each column). */
function HourChart({ hours, isToday, measure, height }: { hours: Hours; isToday: boolean; measure: Measure; height: number }) {
  const t = useTranslations('dashboard.hourly')
  const locale = useLocale()
  const compact = (n: number) => formatCompact(n, locale)
  const valueOf = (row: Hour): number | null => {
    if (measure === 'shop') return row.shop?.net ?? null
    if (measure === 'sapo') return row.sapoSales
    if (!row.ads) return null
    return measure === 'roi' ? (roiOf(row.ads) ?? 0) : row.ads[measure]
  }
  const values = hours.rows.map(valueOf)
  const top = measure === 'roi' ? (hours.best?.hour ?? null) : values.reduce<number | null>((best, v, h) => (v !== null && (best === null || v > (values[best] ?? 0)) ? h : best), null)
  const format = (v: number) => (measure === 'roi' ? formatNumber(v, locale, 2) : compact(v))
  const count = (n: number) => formatNumber(n, locale, isToday ? 0 : 1)

  return (
    <HourColumns
      height={height}
      values={values}
      reference={measure === 'roi' && hours.viewRoi !== null ? values.map((v) => (v === null ? 0 : hours.viewRoi!)) : null}
      peak={top === null ? null : { start: top, end: top }}
      currentHour={isToday ? hours.currentHour : null}
      color={COLOR[measure]}
      format={format}
      formatTick={format}
      rows={(hour) => {
        // Every source's figures for the hour, a row each, always in the same order — the one the
        // chart draws set in bold beside its colour, so the eye finds it and the others in one place.
        const row = hours.rows[hour]
        const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : compact(v))
        const withOrders = (sales: number | null | undefined, orders: number | null | undefined) =>
          orders === null || orders === undefined ? (
            money(sales)
          ) : (
            <>
              {money(sales)}
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, fontSize: 12 }}>
                {' · '}
                {t('noteOrders', { orders: count(orders) })}
              </Box>
            </>
          )
        const roi = roiOf(row.ads)
        const all: Array<{ key: Measure; value: React.ReactNode; show: boolean }> = [
          { key: 'roi', value: roi === null ? '—' : formatNumber(roi, locale, 2), show: hours.has.ads },
          { key: 'cost', value: money(row.ads?.cost), show: hours.has.ads },
          { key: 'revenue', value: money(row.ads?.revenue), show: hours.has.ads },
          { key: 'shop', value: withOrders(row.shop?.net, row.shop?.orders), show: hours.has.shop },
          { key: 'sapo', value: withOrders(row.sapoSales, row.sapoOrders), show: hours.has.sapo },
        ]
        return all
          .filter((item) => item.show)
          .map((item) => ({
            key: item.key,
            label: t(`measure.${item.key}`),
            value: item.value,
            mark: item.key === measure ? ('bar' as const) : ('none' as const),
            color: COLOR[item.key],
            strong: item.key === measure,
          }))
      }}
      text={{
        unit: measure === 'roi' ? 'ROI' : '₫',
        value: t(`measure.${measure}`),
        reference: t('viewRoi'),
        inProgress: t('now'),
        inPeak: measure === 'roi' ? t('bestLabel') : t('peak'),
        hourRange: (hour) => `${label(hour)}–${label((hour + 1) % 24)}`,
        hourTick: (hour) => `${hour}h`,
      }}
      ariaLabel={t('title')}
    />
  )
}

/** The chart's measure as chips that wrap: every option in sight and easy to tap, on a phone too — no sideways scroll. */
function MeasureChips({ measures, measure, onChange }: { measures: Measure[]; measure: Measure; onChange: (next: Measure) => void }) {
  const t = useTranslations('dashboard.hourly')
  return (
    <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
      {measures.map((value) => (
        <Chip
          key={value}
          label={t(`measureShort.${value}`)}
          color={value === measure ? 'primary' : 'default'}
          variant={value === measure ? 'filled' : 'outlined'}
          onClick={() => onChange(value)}
          sx={{ height: 32 }}
        />
      ))}
    </Stack>
  )
}

/** A figure over a thin bar of its share of the column's largest — the shape of the day, read down the table. */
function BarCell({ value, max, color, text }: { value: number | null; max: number; color: string; text: string }) {
  return (
    <TableCell align="right" sx={{ ...NUMERIC, minWidth: 100 }}>
      {value === null ? (
        <Typography variant="body2" sx={{ color: 'text.disabled' }}>
          —
        </Typography>
      ) : (
        <>
          {text}
          <Box sx={{ mt: 0.25, height: 3, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Box sx={{ height: 3, borderRadius: 2, bgcolor: color, width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
          </Box>
        </>
      )}
    </TableCell>
  )
}

/** Every hour in full, the three sources side by side — the dialog's table. */
function HourTable({ hours, isToday }: { hours: Hours; isToday: boolean }) {
  const t = useTranslations('dashboard.hourly')
  const locale = useLocale()
  const compact = (n: number) => formatCompact(n, locale)
  const count = (n: number | null) => (n === null ? '—' : formatNumber(n, locale, isToday ? 0 : 1))
  const rows = isToday ? [...hours.shown].reverse() : hours.shown
  const max = (pick: (row: Hour) => number | null) => Math.max(0, ...hours.shown.map((h) => pick(hours.rows[h]) ?? 0))
  const maxCost = max((row) => row.ads?.cost ?? null)
  const maxSales = Math.max(max((row) => row.ads?.revenue ?? null), max((row) => row.shop?.net ?? null), max((row) => row.sapoSales))
  const { has } = hours
  const group = (text: string, span: number) => (
    <TableCell colSpan={span} align="center" sx={{ fontWeight: 700, borderBottom: 1, borderColor: 'divider' }}>
      {text}
    </TableCell>
  )

  return (
    <TableScroll fill>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell />
            {has.ads ? group(t('sourceAds'), 4) : null}
            {has.shop ? group(t('sourceShop'), 2) : null}
            {has.sapo ? group(t('sourceSapo'), 2) : null}
            {has.ads && (has.shop || has.sapo) ? <TableCell /> : null}
          </TableRow>
          <TableRow>
            <TableCell>{t('hour')}</TableCell>
            {has.ads ? (
              <>
                <TableCell align="right">{t('cost')}</TableCell>
                <TableCell align="right">{t('revenue')}</TableCell>
                <TableCell align="right">
                  <Tooltip title={t('roiTip')}>
                    <span>ROI</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">{t('orders')}</TableCell>
              </>
            ) : null}
            {has.shop ? (
              <>
                <TableCell align="right">{t('shopOrders')}</TableCell>
                <TableCell align="right">{t('shopSales')}</TableCell>
              </>
            ) : null}
            {has.sapo ? (
              <>
                <TableCell align="right">{t('shopOrders')}</TableCell>
                <TableCell align="right">{t('shopSales')}</TableCell>
              </>
            ) : null}
            {has.ads && (has.shop || has.sapo) ? (
              <TableCell align="right">
                <Tooltip title={t('costShareTip')}>
                  <span>{t('costShare')}</span>
                </Tooltip>
              </TableCell>
            ) : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((hour) => {
            const row = hours.rows[hour]
            const roi = roiOf(row.ads)
            const current = hour === hours.currentHour
            // Spend against the sales it most directly drives: the TikTok Shop's, else the shop's in Sapo.
            const sales = row.shop?.net ?? row.sapoSales
            return (
              <TableRow key={hour} selected={current}>
                <TableCell sx={{ ...NUMERIC, fontWeight: current ? 700 : undefined }}>
                  {label(hour)}
                  {current ? (
                    <Typography component="span" variant="caption" sx={{ ml: 0.75, color: 'primary.main' }}>
                      {t('now')}
                    </Typography>
                  ) : null}
                </TableCell>
                {has.ads ? (
                  <>
                    <BarCell value={row.ads?.cost ?? null} max={maxCost} color={COLOR.cost} text={row.ads ? compact(row.ads.cost) : ''} />
                    <BarCell value={row.ads?.revenue ?? null} max={maxSales} color={COLOR.revenue} text={row.ads ? compact(row.ads.revenue) : ''} />
                    <TableCell align="right" sx={{ ...NUMERIC, fontWeight: 600, color: roiTone(roi, hours.viewRoi) }}>
                      {roi === null ? '—' : formatNumber(roi, locale, 2)}
                    </TableCell>
                    <TableCell align="right" sx={NUMERIC}>
                      {count(row.ads?.orders ?? null)}
                    </TableCell>
                  </>
                ) : null}
                {has.shop ? (
                  <>
                    <TableCell align="right" sx={NUMERIC}>
                      {count(row.shop?.orders ?? null)}
                    </TableCell>
                    <BarCell value={row.shop?.net ?? null} max={maxSales} color={COLOR.shop} text={row.shop ? compact(row.shop.net) : ''} />
                  </>
                ) : null}
                {has.sapo ? (
                  <>
                    <TableCell align="right" sx={NUMERIC}>
                      {count(row.sapoOrders)}
                    </TableCell>
                    <BarCell value={row.sapoSales} max={maxSales} color={COLOR.sapo} text={row.sapoSales === null ? '' : compact(row.sapoSales)} />
                  </>
                ) : null}
                {has.ads && (has.shop || has.sapo) ? (
                  <TableCell align="right" sx={NUMERIC}>
                    {row.ads && sales ? `${formatNumber((row.ads.cost / sales) * 100, locale, 1)}%` : '—'}
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableScroll>
  )
}

/**
 * The day hour by hour across every source — what GMV Max spent and brought
 * in, what the TikTok Shop and Sapo sold — for whoever runs the ads to see at
 * once which hours pay and which only spend, and move budget while the day
 * still runs.
 *
 * The card is the glance: a box per source for the latest hour (today) or
 * the average day, the ads' best and worst hours, and the day's shape in one
 * measure. The expand icon opens the whole of it: the chart large and every
 * hour in a table, the sources side by side.
 */
function HourlyPerformance() {
  const t = useTranslations('dashboard.hourly')
  const { data, isToday, periodLabel } = useOverview()
  const [chosen, setMeasure] = usePreference<Measure>('adshub.overview.hourlyMeasure', 'roi', acceptMeasure)
  const [open, setOpen] = useState(false)
  const hours = hoursOf(data, isToday)
  const measures = MEASURES.filter((m) => (m === 'shop' ? hours.has.shop : m === 'sapo' ? hours.has.sapo : hours.has.ads))
  if (measures.length === 0) return null
  const measure = measures.includes(chosen) ? chosen : measures[0]
  // dataThrough is the start of the last hour TikTok has broken down: it has reported up to that hour's end.
  const through = isToday && data.gmvMax?.dataThrough ? t('through', { hour: label((Number(data.gmvMax.dataThrough.slice(11, 13)) + 1) % 24) }) : null
  const subtitle = [isToday ? t('subtitleToday', { period: periodLabel }) : t('subtitleAverage', { period: periodLabel }), through].filter(Boolean).join(' · ')
  const toggle = <MeasureChips measures={measures} measure={measure} onChange={setMeasure} />

  return (
    <>
      <InsightCard title={t('title')} subtitle={subtitle} expand={{ label: t('expand'), onClick: () => setOpen(true) }}>
        <KeyHours hours={hours} isToday={isToday} />
        <Box sx={{ mb: 1 }}>{toggle}</Box>
        <HourChart hours={hours} isToday={isToday} measure={measure} height={170} />
      </InsightCard>
      <DetailsDialog open={open} onClose={() => setOpen(false)} title={`${t('title')} · ${capitalizeFirst(periodLabel)}`} closeLabel={t('close')}>
        {/*
          The dialog lays its content out as a flex column so the table can take the room left.
          Everything above it keeps its own height: a box that clips (the toggle's sideways scroll)
          would otherwise be squeezed to nothing and the chart would ride up over it.
        */}
        <Box sx={{ flexShrink: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {subtitle}
          </Typography>
          <KeyHours hours={hours} isToday={isToday} wide />
          <Box sx={{ mb: 1.5 }}>{toggle}</Box>
          <Box sx={{ mb: 2 }}>
            <HourChart hours={hours} isToday={isToday} measure={measure} height={260} />
          </Box>
        </Box>
        {/* At least a screenful of hours: on a short window the dialog scrolls rather than crush the table. */}
        <Box sx={{ flex: '1 0 320px', minHeight: 320, display: 'flex', flexDirection: 'column' }}>
          <HourTable hours={hours} isToday={isToday} />
        </Box>
      </DetailsDialog>
    </>
  )
}

export const hourlyPerformanceWidget: OverviewWidget = {
  id: 'hourly-performance',
  band: 'ads',
  order: 10,
  // Any of TikTok, TikTok Shop and Sapo will do: it shows what it has.
  sources: [],
  // Half the row beside the products by hour, the two read side by side; the whole row alone.
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 6 : 12 }),
  Component: HourlyPerformance,
}
