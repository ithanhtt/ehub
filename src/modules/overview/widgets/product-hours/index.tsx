'use client'

import { memo, useDeferredValue, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import { CellTips } from '@/components/charts/cell-tips'
import { TipContent } from '@/components/charts/chart-tooltip'
import { usePreference } from '@/components/ui/use-preference'
import { formatCompact, formatMoney, formatNumber, capitalizeFirst } from '@/core/utils/format'
import type { DashboardData, GmvMaxProducts, GmvMaxTotals } from '../../data/types'
import { useOverview } from '../../context'
import { DetailsDialog, InsightCard } from '../../shared/insight-card'
import type { OverviewWidget } from '../../types'

type Measure = 'cost' | 'revenue' | 'roi'
type Sort = 'cost' | 'revenue' | 'roiLow' | 'roiHigh'
type Item = GmvMaxProducts['items'][number]

const MEASURES: readonly Measure[] = ['cost', 'revenue', 'roi']
const SORTS: readonly Sort[] = ['cost', 'revenue', 'roiLow', 'roiHigh']
const acceptMeasure = (value: unknown): Measure | null => (MEASURES.includes(value as Measure) ? (value as Measure) : null)
/** Products on the card — few enough to read at a glance; "see all" opens the rest. */
const TOP = 4

const NUMERIC = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const
/**
 * The product column stays put while the hours scroll sideways. The dialog's paper carries an overlay in
 * dark mode (--Paper-overlay); the pinned cells take it too, so they match the paper instead of showing darker.
 */
const STICKY = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', backgroundImage: 'var(--Paper-overlay)' } as const
/** The pinned heading sits over both the pinned column and the pinned headings row. */
const STICKY_HEAD = { ...STICKY, zIndex: 3 } as const
/**
 * The dialog's tables scroll in one box, both ways, so the headings (stickyHeader) and the product column
 * (STICKY) both pin to it — two nested scroll boxes would pin the column to one that never scrolls sideways.
 */
const SCROLL = { flex: '1 1 auto', minHeight: 240, overflow: 'auto' } as const
/** An hour of a strip, and of the tables; each cell's colour goes inline. */
const STRIP_CELL = { flex: 1, height: 12, borderRadius: '2px' } as const
const HOUR_CELL = { ...NUMERIC, px: 0.5, fontSize: 12, minWidth: 46 } as const
const EMPTY_CELL = 'var(--mui-palette-action-hover)'
/** Pinned headings on the dialog's paper, not the page's background (what MUI gives sticky headings). */
const HEAD = { '& th': { bgcolor: 'background.paper', backgroundImage: 'var(--Paper-overlay)' } } as const
const SPEND = 'var(--adshub-series-2)'
const REVENUE = 'var(--adshub-series-1)'
const GOOD = 'var(--mui-palette-success-main)'
const FAIR = 'var(--mui-palette-warning-main)'
const BAD = 'var(--mui-palette-error-main)'

const roiOf = (f: GmvMaxTotals) => (f.cost > 0 ? f.revenue / f.cost : null)
const losing = (item: Item) => item.totals.cost > 0 && (roiOf(item.totals) ?? 0) < 1
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`

/** An hour's ROI against the product's own: green above it, orange below, red under 1. */
const roiColor = (roi: number | null, own: number | null) => (roi === null ? undefined : roi < 1 ? BAD : own !== null && roi >= own ? GOOD : FAIR)

const mix = (color: string, percent: number) => `color-mix(in srgb, ${color} ${Math.round(percent)}%, transparent)`

function sortItems(items: Item[], sort: Sort) {
  const roi = (item: Item) => roiOf(item.totals) ?? 0
  return [...items].sort((a, b) =>
    sort === 'cost' ? b.totals.cost - a.totals.cost : sort === 'revenue' ? b.totals.revenue - a.totals.revenue : sort === 'roiLow' ? roi(a) - roi(b) : roi(b) - roi(a),
  )
}

/**
 * A product's day in one strip, an hour a block: how well each hour paid
 * (green above the product's own ROI, orange below, red under 1) and how much
 * it spent (the deeper, the more) — read at a glance, figures on hover.
 */
function HourStrip({ item, hours }: { item: Item; hours: number[] }) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  if (!item.hours) return null
  const own = roiOf(item.totals)
  const max = Math.max(0, ...hours.map((h) => item.hours![h].cost))
  return (
    <CellTips render={(key) => <GmvCellTip hour={Number(key)} cell={item.hours![Number(key)]} />}>
      <Stack direction="row" sx={{ gap: '2px', mt: 0.5 }}>
        {hours.map((hour) => {
          const cell = item.hours![hour]
          const spent = cell.cost > 0
          const color = spent ? mix(roiColor(roiOf(cell), own) ?? SPEND, 25 + (max > 0 ? (cell.cost / max) * 75 : 0)) : EMPTY_CELL
          return <Box key={hour} data-tip={hour} sx={STRIP_CELL} style={{ backgroundColor: color }} />
        })}
      </Stack>
    </CellTips>
  )
}

/** A GMV Max hour of one product on hover: the hour, then spend, revenue, ROI and orders as a small table. */
function GmvCellTip({ hour, cell }: { hour: number; cell: GmvMaxTotals }) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  const roi = roiOf(cell)
  return (
    <TipContent
      title={hourLabel(hour)}
      rows={[
        { key: 'cost', label: t('measure.cost'), value: formatMoney(cell.cost, locale) },
        { key: 'revenue', label: t('measure.revenue'), value: formatMoney(cell.revenue, locale) },
        { key: 'roi', label: t('measure.roi'), value: roi === null ? '—' : formatNumber(roi, locale, 2), strong: true },
        { key: 'orders', label: t('salesMeasure.orders'), value: formatNumber(cell.orders, locale) },
      ]}
    />
  )
}

/** A Sapo or TikTok Shop hour of one product on hover: orders and sales. */
function SalesCellTip({ hour, cell }: { hour: number; cell: { orders: number; sales: number | null } }) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  return (
    <TipContent
      title={hourLabel(hour)}
      rows={[
        { key: 'orders', label: t('salesMeasure.orders'), value: formatNumber(cell.orders, locale), strong: true },
        { key: 'sales', label: t('salesMeasure.sales'), value: cell.sales === null ? '—' : formatMoney(cell.sales, locale) },
      ]}
    />
  )
}

/** A product's name on up to two lines — long names read, never cut to one. */
const NAME_TWO_LINES = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'break-word',
  lineHeight: 1.35,
} as const

/**
 * The hours over the strips, every six, each over its own block — so which
 * hour a block is reads off the axis, on a phone as on a desk, without a hover.
 */
function HourAxis({ hours, hourNow }: { hours: number[]; hourNow: number | null }) {
  return (
    <Stack direction="row" sx={{ gap: '2px', mb: 0.25 }} aria-hidden>
      {hours.map((hour) => (
        <Box key={hour} sx={{ flex: 1, minWidth: 0, position: 'relative', height: 14 }}>
          {hour === hourNow || (hour % 6 === 0 && (hourNow === null || Math.abs(hour - hourNow) > 1)) ? (
            <Typography
              component="span"
              sx={{ position: 'absolute', left: 0, fontSize: 10, lineHeight: '14px', whiteSpace: 'nowrap', color: hour === hourNow ? 'primary.main' : 'text.disabled', fontWeight: hour === hourNow ? 700 : 400 }}
            >
              {hour}h
            </Typography>
          ) : null}
        </Box>
      ))}
    </Stack>
  )
}

/** One product in the glance: its name and the figure that matters, the rest in a line, its day in a strip, its busy hour in words. */
function GlanceRow({ name, value, valueTone, line, strip, peak, onOpen }: { name: string; value: string; valueTone?: string; line: string; strip: React.ReactNode; peak: string | null; onOpen: () => void }) {
  return (
    <Box onClick={onOpen} sx={{ cursor: 'pointer', py: 0.75, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 }, '&:hover .name': { color: 'primary.main' } }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography className="name" variant="body2" title={name} sx={{ fontWeight: 600, ...NAME_TWO_LINES }}>
            {name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {line}
          </Typography>
        </Box>
        <Typography sx={{ ...NUMERIC, fontWeight: 700, fontSize: '1rem', color: valueTone }}>{value}</Typography>
      </Stack>
      {strip}
      {peak ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
          {peak}
        </Typography>
      ) : null}
    </Box>
  )
}

/** The hour with the most of something, among the hours shown; null when none has any. */
function peakHour(hours: number[], valueOf: (hour: number) => number): number | null {
  let best: number | null = null
  for (const hour of hours) if (valueOf(hour) > 0 && (best === null || valueOf(hour) > valueOf(best))) best = hour
  return best
}

/** The card: the products spending most, each with its ROI, its day in a strip, and its busiest and best hours in words. */
function ProductGlance({ items, hours, hourNow, onOpen }: { items: Item[]; hours: number[]; hourNow: number | null; onOpen: () => void }) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  const compact = (n: number) => formatCompact(n, locale)
  const hourly = items.some((item) => item.hours)
  return (
    <Box>
      {hourly ? <HourAxis hours={hours} hourNow={hourNow} /> : null}
      {items.map((item) => {
        const roi = roiOf(item.totals)
        const busiest = item.hours ? peakHour(hours, (h) => item.hours![h].cost) : null
        const best = item.hours ? peakHour(hours, (h) => (item.hours![h].cost > 0 ? (roiOf(item.hours![h]) ?? 0) : 0)) : null
        const peak =
          busiest === null ? null : best !== null && best !== busiest ? t('peakGmvBoth', { spend: `${busiest}h`, best: `${best}h` }) : t('peakGmv', { spend: `${busiest}h` })
        return (
          <GlanceRow
            key={item.id}
            name={item.name}
            value={roi === null ? '—' : `ROI ${formatNumber(roi, locale, 2)}`}
            valueTone={roi === null ? 'text.disabled' : roi < 1 ? 'error.main' : undefined}
            line={t('spendRevenue', { cost: compact(item.totals.cost), revenue: compact(item.totals.revenue) })}
            strip={<HourStrip item={item} hours={hours} />}
            peak={peak}
            onOpen={onOpen}
          />
        )
      })}
    </Box>
  )
}

/** The dialog: every product, hour by hour in the chosen measure, searchable and sortable. */
/** Memoised: the table (up to 60 × 24 cells) renders again only when what it shows changes — not with the page's clock. */
const ProductTable = memo(function ProductTable({ items, hours, hourly, hourNow, measure }: { items: Item[]; hours: number[]; hourly: boolean; hourNow: number | null; measure: Measure }) {
  const t = useTranslations('dashboard.productHours')
  const th = useTranslations('dashboard.hourly')
  const locale = useLocale()
  const compact = (n: number) => formatCompact(n, locale)

  const shade = (cell: GmvMaxTotals, rowMax: number, own: number | null) => {
    if (cell.cost === 0 && cell.revenue === 0) return undefined
    if (measure === 'roi') {
      const color = roiColor(roiOf(cell), own)
      return color ? mix(color, 22) : undefined
    }
    const share = rowMax > 0 ? cell[measure] / rowMax : 0
    return mix(measure === 'cost' ? SPEND : REVENUE, 8 + share * 52)
  }
  const text = (cell: GmvMaxTotals) => {
    if (cell.cost === 0 && cell.revenue === 0) return ''
    if (measure === 'roi') {
      const roi = roiOf(cell)
      return roi === null ? '' : formatNumber(roi, locale, 2)
    }
    return compact(cell[measure])
  }

  return (
    <CellTips
      sx={SCROLL}
      render={(key) => {
        const [row, hour] = key.split('|').map(Number)
        const cell = items[row]?.hours?.[hour]
        return cell ? <GmvCellTip hour={hour} cell={cell} /> : null
      }}
    >
      <Table size="small" stickyHeader>
        <TableHead sx={HEAD}>
          <TableRow>
            <TableCell sx={{ ...STICKY_HEAD, minWidth: 240 }}>{t('product')}</TableCell>
            <TableCell align="right">{th('cost')}</TableCell>
            <TableCell align="right">{th('revenue')}</TableCell>
            <TableCell align="right">ROI</TableCell>
            <TableCell align="right">{th('orders')}</TableCell>
            {hourly
              ? hours.map((hour) => (
                  <TableCell key={hour} align="center" sx={{ ...NUMERIC, px: 0.5, fontSize: 12, color: hour === hourNow ? 'primary.main' : 'text.secondary' }}>
                    {String(hour).padStart(2, '0')}h
                  </TableCell>
                ))
              : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, row) => {
            const own = roiOf(item.totals)
            const rowMax = measure === 'roi' || !item.hours ? 0 : Math.max(0, ...hours.map((h) => item.hours![h][measure]))
            return (
              <TableRow key={item.id} hover>
                <TableCell sx={{ ...STICKY, maxWidth: 300 }}>
                  <Typography variant="body2" noWrap title={item.name} sx={{ fontWeight: 600 }}>
                    {item.name}
                  </Typography>
                  {item.name !== item.id ? (
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {item.id}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell align="right" sx={NUMERIC}>
                  {formatMoney(item.totals.cost, locale)}
                </TableCell>
                <TableCell align="right" sx={NUMERIC}>
                  {formatMoney(item.totals.revenue, locale)}
                </TableCell>
                <TableCell align="right" sx={{ ...NUMERIC, fontWeight: 700, color: own === null ? 'text.disabled' : own < 1 ? 'error.main' : 'text.primary' }}>
                  {own === null ? '—' : formatNumber(own, locale, 2)}
                </TableCell>
                <TableCell align="right" sx={NUMERIC}>
                  {formatNumber(item.totals.orders, locale)}
                </TableCell>
                {item.hours
                  ? hours.map((hour) => {
                      const cell = item.hours![hour]
                      return (
                        <TableCell key={hour} align="center" data-tip={`${row}|${hour}`} sx={HOUR_CELL} style={{ backgroundColor: shade(cell, rowMax, own) }}>
                          {text(cell)}
                        </TableCell>
                      )
                    })
                  : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </CellTips>
  )
})

/**
 * GMV Max product by product — and, when TikTok breaks products down by hour,
 * hour by hour: which product pays at which hour, without opening each
 * campaign.
 *
 * The card is the glance: how many products lose money, and the ones
 * spending most with their day in a strip. The expand icon opens the whole
 * list — searchable, sortable (worst ROI first to find what to cut), one
 * measure across the hours.
 */
/** `full`: where the widget's open dialog wants this view's full table (null while it is closed). */
function GmvProducts({ tabs, setOpen, full }: { tabs: React.ReactNode; setOpen: (open: boolean) => void; full: HTMLElement | null }) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  const { data, isToday, periodLabel } = useOverview()
  const [measure, setMeasure] = usePreference<Measure>('adshub.overview.productHoursMeasure', 'cost', acceptMeasure)
  const [query, setQuery] = useState('')
  const [onlyLosing, setOnlyLosing] = useState(false)
  const [sort, setSort] = useState<Sort>('cost')

  const products = data.gmvMax?.products
  const hourNow = isToday ? (data.gmvMax?.hours.currentHour ?? null) : null
  const all = products?.items ?? []
  const losingCount = all.filter(losing).length
  const losingOn = onlyLosing && losingCount > 0
  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const kept = all.filter((item) => (!losingOn || losing(item)) && (!needle || item.name.toLowerCase().includes(needle) || item.id.includes(needle)))
    return sortItems(kept, sort)
  }, [all, query, losingOn, sort])
  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => !isToday || hourNow === null || hour <= hourNow), [isToday, hourNow])
  // The toggle answers at once; the table follows as soon as it can, without holding the page up.
  const deferredMeasure = useDeferredValue(measure)
  if (!products) return null

  const spent = data.gmvMax?.totals.cost ?? all.reduce((sum, item) => sum + item.totals.cost, 0)
  const glance = sortItems(losingOn ? all.filter(losing) : all, losingOn ? 'roiLow' : 'cost').slice(0, TOP)

  const losingChip = losingCount > 0 ? (
    <Chip
      size="small"
      icon={<WarningAmberOutlined sx={{ fontSize: 16 }} />}
      color="error"
      variant={losingOn ? 'filled' : 'outlined'}
      label={t('losing', { count: losingCount })}
      onClick={() => setOnlyLosing(!losingOn)}
    />
  ) : null

  return (
    <>
      <InsightCard
        title={t('title')}
        subtitle={t('subtitle', { period: periodLabel, count: products.total || all.length, spent: formatCompact(spent, locale) })}
        headerAction={losingChip}
        expand={all.length > 0 ? { label: t('expand'), onClick: () => setOpen(true) } : undefined}
      >
        {tabs}
        {all.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
            {products.pending ? t('pending') : products.failures.length > 0 ? t('failed') : t('empty')}
          </Typography>
        ) : (
          <>
            {products.hourly ? (
              <Stack direction="row" useFlexGap sx={{ mb: 1, alignItems: 'center', color: 'text.secondary', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5 }}>
                <Typography variant="caption">{t('legend')}</Typography>
                {[
                  { color: GOOD, label: t('legendGood') },
                  { color: FAIR, label: t('legendFair') },
                  { color: BAD, label: t('legendBad') },
                ].map((entry) => (
                  <Stack key={entry.label} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: entry.color }} />
                    <Typography variant="caption">{entry.label}</Typography>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
                {t('noHours')}
              </Typography>
            )}
            <ProductGlance items={glance} hours={hours} hourNow={hourNow} onOpen={() => setOpen(true)} />
            {all.length > TOP ? (
              <Button size="small" onClick={() => setOpen(true)} sx={{ mt: 1 }}>
                {t('seeAll', { count: all.length })}
              </Button>
            ) : null}
          </>
        )}
      </InsightCard>

      {full
        ? createPortal(
          <>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1.5, flexShrink: 0 }}>
          <TextField
            size="small"
            placeholder={t('search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlined fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: '100%', sm: 240 } }}
          />
          <TextField select size="small" label={t('sortBy')} value={sort} onChange={(event) => setSort(event.target.value as Sort)} sx={{ minWidth: 190 }}>
            {SORTS.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`sort.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          {losingChip}
          <Box sx={{ flexGrow: 1 }} />
          {products.hourly ? (
            <ToggleButtonGroup exclusive size="small" value={measure} onChange={(_event, next: Measure | null) => next && setMeasure(next)}>
              {MEASURES.map((value) => (
                <ToggleButton key={value} value={value} sx={{ px: 1.5, textTransform: 'none' }}>
                  {t(`measure.${value}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : null}
        </Stack>
        {!products.hourly ? (
          <Alert severity="info" sx={{ mb: 1.5, flexShrink: 0 }}>
            {t('noHours')}
          </Alert>
        ) : null}
        {listed.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
            {t('noMatch')}
          </Typography>
        ) : (
          <ProductTable items={listed} hours={hours} hourly={products.hourly} hourNow={hourNow} measure={deferredMeasure} />
        )}
          </>,
          full,
        )
        : null}
    </>
  )
}

/* ------------------------------------------------ TikTok Shop and Sapo --- */

type SalesSource = 'shop' | 'sapo'
type Source = 'gmv' | SalesSource
/** Sapo first: the shop's whole sales, before the TikTok channel and its ads. */
const SOURCES: readonly Source[] = ['sapo', 'gmv', 'shop']
const acceptSource = (value: unknown): Source | null => (SOURCES.includes(value as Source) ? (value as Source) : null)

/** A product as a shop sold it: orders and net sales (cancelled out), and the same by the hour placed. */
type SalesItem = { id: string; name: string; orders: number; cancelled: number; sales: number; hours: Array<{ orders: number; sales: number | null }> | null }
type SalesMeasure = 'orders' | 'sales'

function salesItems(data: DashboardData, source: SalesSource): SalesItem[] | null {
  if (source === 'shop') {
    return (
      data.tiktokShop?.products.map((p) => ({
        id: p.id,
        name: p.name,
        orders: p.totals.orders,
        cancelled: p.totals.cancelled,
        sales: p.totals.net,
        hours: p.hours.map((h) => ({ orders: h.orders, sales: h.net })),
      })) ?? null
    )
  }
  if (!data.sapo) return null
  return data.sapo.products.items
    .map((p) => ({
      id: p.key,
      name: p.name,
      orders: p.orders,
      cancelled: p.cancelled,
      sales: p.gmv - p.cancelledGmv,
      // Sales by the hour once every day of the view has them (Sapo reads older days again for it).
      hours: p.hours ? p.hours.map((orders, hour) => ({ orders, sales: p.hourSales ? p.hourSales[hour] : null })) : null,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 60)
}

/** A product's day in one strip, an hour a block, deeper the more orders it took. */
function OrderStrip({ item, hours, color }: { item: SalesItem; hours: number[]; color: string }) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  if (!item.hours) return null
  const max = Math.max(0, ...hours.map((h) => item.hours![h].orders))
  return (
    <CellTips render={(key) => <SalesCellTip hour={Number(key)} cell={item.hours![Number(key)]} />}>
      <Stack direction="row" sx={{ gap: '2px', mt: 0.5 }}>
        {hours.map((hour) => {
          const cell = item.hours![hour]
          const shade = cell.orders > 0 ? mix(color, 20 + (max > 0 ? (cell.orders / max) * 80 : 0)) : EMPTY_CELL
          return <Box key={hour} data-tip={hour} sx={STRIP_CELL} style={{ backgroundColor: shade }} />
        })}
      </Stack>
    </CellTips>
  )
}

/** The TikTok Shop's or Sapo's products hour by hour, in orders or sales — memoised, as ProductTable. */
const SalesTable = memo(function SalesTable({
  items,
  hours,
  hourly,
  hourNow,
  shown,
  color,
}: {
  items: SalesItem[]
  hours: number[]
  hourly: boolean
  hourNow: number | null
  shown: SalesMeasure
  color: string
}) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  const compact = (n: number) => formatCompact(n, locale)
  const pick = (cell: { orders: number; sales: number | null }) => (shown === 'sales' ? (cell.sales ?? 0) : cell.orders)
  return (
    <CellTips
      sx={SCROLL}
      render={(key) => {
        const [row, hour] = key.split('|').map(Number)
        const cell = items[row]?.hours?.[hour]
        return cell ? <SalesCellTip hour={hour} cell={cell} /> : null
      }}
    >
      <Table size="small" stickyHeader>
        <TableHead sx={HEAD}>
          <TableRow>
            <TableCell sx={{ ...STICKY_HEAD, minWidth: 240 }}>{t('product')}</TableCell>
            <TableCell align="right">{t('salesMeasure.orders')}</TableCell>
            <TableCell align="right">{t('cancelled')}</TableCell>
            <TableCell align="right">{t('salesMeasure.sales')}</TableCell>
            {hourly
              ? hours.map((hour) => (
                  <TableCell key={hour} align="center" sx={{ ...NUMERIC, px: 0.5, fontSize: 12, color: hour === hourNow ? 'primary.main' : 'text.secondary' }}>
                    {String(hour).padStart(2, '0')}h
                  </TableCell>
                ))
              : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, row) => {
            const rowMax = item.hours ? Math.max(0, ...hours.map((h) => pick(item.hours![h]))) : 0
            return (
              <TableRow key={item.id} hover>
                <TableCell sx={{ ...STICKY, maxWidth: 300 }}>
                  <Typography variant="body2" noWrap title={item.name} sx={{ fontWeight: 600 }}>
                    {item.name}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={NUMERIC}>
                  {formatNumber(item.orders, locale)}
                </TableCell>
                <TableCell align="right" sx={{ ...NUMERIC, color: item.cancelled > 0 ? 'error.main' : 'text.disabled' }}>
                  {formatNumber(item.cancelled, locale)}
                </TableCell>
                <TableCell align="right" sx={{ ...NUMERIC, fontWeight: 600 }}>
                  {formatMoney(item.sales, locale)}
                </TableCell>
                {item.hours
                  ? hours.map((hour) => {
                      const value = pick(item.hours![hour])
                      return (
                        <TableCell
                          key={hour}
                          align="center"
                          data-tip={`${row}|${hour}`}
                          sx={HOUR_CELL}
                          style={{ backgroundColor: value > 0 ? mix(color, 8 + (rowMax > 0 ? (value / rowMax) * 52 : 0)) : undefined }}
                        >
                          {value > 0 ? (shown === 'sales' ? compact(value) : formatNumber(value, locale)) : ''}
                        </TableCell>
                      )
                    })
                  : hourly
                    ? hours.map((hour) => <TableCell key={hour} />)
                    : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </CellTips>
  )
})

/**
 * The TikTok Shop's or Sapo's products, by net sales: the card lists the
 * top ones with their day in a strip (orders by the hour placed); the dialog
 * every product, hour by hour, in orders — or, for the TikTok Shop, sales.
 */
function SalesProducts({ source, tabs, setOpen, full }: { source: SalesSource; tabs: React.ReactNode; setOpen: (open: boolean) => void; full: HTMLElement | null }) {
  const t = useTranslations('dashboard.productHours')
  const locale = useLocale()
  const { data, isToday, periodLabel } = useOverview()
  const [query, setQuery] = useState('')
  const [measure, setMeasure] = useState<SalesMeasure>('orders')
  const all = useMemo(() => salesItems(data, source) ?? [], [data, source])
  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return all.filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle))
  }, [all, query])

  const color = source === 'shop' ? REVENUE : 'var(--adshub-series-3)'
  const hourNow = isToday ? ((source === 'shop' ? data.tiktokShop?.hours.currentHour : data.sapo?.hours.currentHour) ?? null) : null
  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => !isToday || hourNow === null || hour <= hourNow), [isToday, hourNow])
  const hourly = all.some((item) => item.hours !== null)
  // Sales by the hour: the TikTok Shop always has them; Sapo once every day of the view has been read with them.
  const hourSales = all.some((item) => item.hours?.some((cell) => cell.sales !== null))
  const salesPending = source === 'sapo' && hourly && !hourSales
  const measures: SalesMeasure[] = source === 'shop' || hourSales ? ['orders', 'sales'] : ['orders']
  const shown = measures.includes(measure) ? measure : 'orders'
  // The toggle answers at once; the table follows as soon as it can, without holding the page up.
  const deferredShown = useDeferredValue(shown)
  // Every product sold, not only the top ones listed.
  const productCount = source === 'shop' ? (data.tiktokShop?.productCount ?? all.length) : (data.sapo?.products.items.length ?? all.length)
  const sales =
    source === 'shop'
      ? (data.tiktokShop?.totals.net ?? 0)
      : (data.sapo?.products.items ?? []).reduce((sum, item) => sum + item.gmv - item.cancelledGmv, 0)
  const compact = (n: number) => formatCompact(n, locale)

  return (
    <>
      <InsightCard
        title={t('title')}
        subtitle={t('salesSubtitle', { period: periodLabel, count: productCount, sales: compact(sales) })}
        expand={all.length > 0 ? { label: t('expand'), onClick: () => setOpen(true) } : undefined}
      >
        {tabs}
        {all.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
            {t('salesEmpty')}
          </Typography>
        ) : (
          <>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
              {hourly ? t('ordersLegend') : t('noSalesHours')}
            </Typography>
            <Box>
              {hourly ? <HourAxis hours={hours} hourNow={hourNow} /> : null}
              {all.slice(0, TOP).map((item) => {
                const busiest = item.hours ? peakHour(hours, (h) => item.hours![h].orders) : null
                return (
                  <GlanceRow
                    key={item.id}
                    name={item.name}
                    value={compact(item.sales)}
                    line={t('ordersLine', { count: formatNumber(item.orders, locale), cancelled: formatNumber(item.cancelled, locale) })}
                    strip={<OrderStrip item={item} hours={hours} color={color} />}
                    peak={busiest === null ? null : t('peakOrders', { hour: `${busiest}h`, orders: formatNumber(item.hours![busiest].orders, locale) })}
                    onOpen={() => setOpen(true)}
                  />
                )
              })}
            </Box>
            {all.length > TOP ? (
              <Button size="small" onClick={() => setOpen(true)} sx={{ mt: 1 }}>
                {t('seeAll', { count: all.length })}
              </Button>
            ) : null}
          </>
        )}
      </InsightCard>

      {full
        ? createPortal(
          <>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1.5, flexShrink: 0 }}>
          <TextField
            size="small"
            placeholder={t('search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlined fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: '100%', sm: 240 } }}
          />
          <Box sx={{ flexGrow: 1 }} />
          {salesPending ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('salesHoursPending')}
            </Typography>
          ) : null}
          {hourly && measures.length > 1 ? (
            <ToggleButtonGroup exclusive size="small" value={shown} onChange={(_event, next: SalesMeasure | null) => next && setMeasure(next)}>
              {measures.map((value) => (
                <ToggleButton key={value} value={value} sx={{ px: 1.5, textTransform: 'none' }}>
                  {t(`salesMeasure.${value}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : null}
        </Stack>
        {listed.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
            {t('noMatch')}
          </Typography>
        ) : (
          <SalesTable items={listed} hours={hours} hourly={hourly} hourNow={hourNow} shown={deferredShown} color={color} />
        )}
          </>,
          full,
        )
        : null}
    </>
  )
}

/**
 * Products hour by hour, from whichever source is chosen: Sapo's orders,
 * GMV Max (spend, revenue, ROI), or the TikTok Shop's own orders. The tabs
 * show only the sources the project has, on the card and in its full view
 * alike — switching there keeps the full view open; the choice is remembered.
 */
function ProductHours() {
  const t = useTranslations('dashboard.productHours')
  const { data, periodLabel } = useOverview()
  const [chosen, setSource] = usePreference<Source>('adshub.overview.productHoursSource', 'sapo', acceptSource)
  // Held here, not in each source's view, so a tab switched in the full view leaves it open.
  const [open, setOpen] = useState(false)
  // The one dialog's body, where the chosen view puts its full table: switching tabs swaps the
  // table in place — the dialog, its title bar and the tabs stay, with no closing and reopening.
  const [full, setFull] = useState<HTMLDivElement | null>(null)
  const available = SOURCES.filter((s) => (s === 'gmv' ? data.gmvMax : s === 'shop' ? data.tiktokShop : data.sapo))
  const source = available.includes(chosen) ? chosen : (available[0] ?? chosen)
  // The tab answers at once; the view follows deferred, so the switch never waits on the table.
  const view = useDeferredValue(source)
  if (available.length === 0) return null
  const tabs =
    available.length > 1 ? (
      <ToggleButtonGroup exclusive size="small" value={source} onChange={(_event, next: Source | null) => next && setSource(next)} sx={{ mb: 1.5 }}>
        {available.map((value) => (
          <ToggleButton key={value} value={value} sx={{ px: 1.25, py: 0.25, textTransform: 'none' }}>
            {t(`source.${value}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    ) : null
  return (
    <>
      {view === 'gmv' ? (
        <GmvProducts tabs={tabs} setOpen={setOpen} full={open ? full : null} />
      ) : (
        <SalesProducts source={view} tabs={tabs} setOpen={setOpen} full={open ? full : null} />
      )}
      <DetailsDialog open={open} onClose={() => setOpen(false)} title={`${t('title')} · ${t(`source.${source}`)} · ${capitalizeFirst(periodLabel)}`} closeLabel={t('close')}>
        {tabs ? <Box sx={{ flexShrink: 0 }}>{tabs}</Box> : null}
        <Box ref={setFull} sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} />
      </DetailsDialog>
    </>
  )
}

export const productHoursWidget: OverviewWidget = {
  id: 'product-hours',
  band: 'ads',
  order: 20,
  // Any of TikTok, TikTok Shop and Sapo will do: it offers the ones there are.
  sources: [],
  // Half the row beside the hourly card, the two read side by side; the whole row alone.
  size: ({ count }) => ({ xs: 12, lg: count > 1 ? 6 : 12 }),
  Component: ProductHours,
}
