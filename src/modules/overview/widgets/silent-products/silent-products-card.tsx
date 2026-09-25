'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import { formatNumber } from '@/core/utils/format'
import type { SapoCatalog, SapoProducts } from '@/modules/overview/data/types'
import { SyncChip } from '@/components/charts/sync-chip'
import { TableScroll } from '@/components/ui/table-scroll'
import { usePreference } from '@/components/ui/use-preference'
import { acceptView, BarList, PartsLegend, ShareBar, ViewToggle, type DetailView, type Segment } from '../../shared/bars'
import { DetailsDialog, InsightCard } from '../../shared/insight-card'
import { fold, useDuration } from '../../shared/text'

/**
 * Products that have gone quiet: no new order within a window the reader
 * chooses (30 minutes, an hour, three… or any length).
 *
 * Two scopes, switched on the card. "Sold in the period" looks at the
 * products with an order in the period the filter picks and lists those
 * gone quiet. "All products" looks at every product the store sells — its
 * catalog, fetched only while this scope is chosen — and lists them all: the
 * quiet first, then those with a recent order (a check mark), and a product
 * with no order in the days on hand says so.
 *
 * The server sends each product's latest order; the window is applied here,
 * so switching it is instant, and with the page's one-second clock a product
 * joins the quiet ones the moment it crosses the line. The most unusual lead:
 * a product's usual pace over the period gives the orders it would normally
 * have had in the window, and one that would usually have had two or more is
 * flagged — an icon, with the reason on hover and a count in the summary.
 *
 * The overview shows a glimpse (SilentProductsSummary); the full list —
 * search, sorting, any window — opens in a dialog and shares the window and
 * the scope with the glimpse.
 */

const PRESETS = [30, 60, 180, 360, 720, 1440]
const STORAGE_KEY = 'adshub.silentWindowMinutes'
const SCOPE_KEY = 'adshub.silentScope'
const MIN_MINUTES = 5
const MAX_MINUTES = 7 * 1440
const PAGE = 20
const SUMMARY_ROWS = 5
/** Orders a product would usually have had in the window, from which its silence is flagged. */
const UNUSUAL = 2
/** How often the catalog view re-reads the latest orders. */
const CATALOG_REFRESH_MS = 60_000

type SortKey = 'expected' | 'silence' | 'orders' | 'name'
/** The table's order: a column, either way round. */
type Sort = { key: SortKey; dir: 'asc' | 'desc' }
type Draft = { value: string; unit: 'minutes' | 'hours' }
type Scope = 'sold' | 'all'
type Row = {
  key: string
  name: string
  orders: number
  last: number | null
  /** Since its latest order; Infinity without one. */
  silentMs: number
  expected: number
  quiet: boolean
}

const compare = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1)

/** Columns beyond the product's name: shown from the small breakpoint up, folded under the name below it. */
const WIDE_ONLY = { display: { xs: 'none', sm: 'table-cell' } } as const
/** A name keeps to one line, cut with an ellipsis; the whole of it shows on hover. */
const NAME_TEXT = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const
/**
 * The widest a name (and the line folded under it on a phone) runs in the
 * full list: on a phone, the screen less the status icon and the dialog's
 * margins; wider, a steady 480px. Set on the name's box — a table cell's own
 * max-width is not honoured.
 */
const NAME_MAX = { xs: 'calc(100vw - 120px)', sm: 480 } as const

// The window, the scope and the full list's order are remembered in this browser (see usePreference).
const acceptMinutes = (value: unknown): number | null =>
  typeof value === 'number' && value >= MIN_MINUTES && value <= MAX_MINUTES ? value : null
const acceptScope = (value: unknown): Scope | null => (value === 'sold' || value === 'all' ? value : null)

/** The chosen window, in minutes. */
export function useSilentWindow() {
  const [minutes, setMinutes] = usePreference<number>(STORAGE_KEY, 60, acceptMinutes)
  const update = (next: number) => setMinutes(Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(next))))
  return [minutes, update] as const
}

/** Which products the list looks at. */
function useSilentScope() {
  return usePreference<Scope>(SCOPE_KEY, 'sold', acceptScope)
}

/** The store's catalog with each product's latest order — read only while the "all products" scope is on. */
function useCatalog(projectId: string, enabled: boolean) {
  const [catalog, setCatalog] = useState<SapoCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/dashboard/catalog`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const next = (await response.json()) as SapoCatalog | null
        if (!cancelled) {
          setCatalog(next)
          setError(null)
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, CATALOG_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [projectId, enabled])
  return { catalog, error, loading: enabled && catalog === null && error === null }
}

/**
 * The rows the list works from. "Sold in the period": the period's products.
 * "All products": the catalog, each with its orders in the period, plus any
 * product sold in the period that is no longer for sale. A product the period
 * did not sell carries its latest order from the days on hand — for a view
 * that reaches today; a view that ended before today counts only its own days.
 * Each row knows its silence as of `asOf` and the orders it would usually
 * have had in the window (its orders over the time the period has run).
 */
function productRows(products: SapoProducts, catalog: SapoCatalog | null, asOf: number, minutes: number): Row[] {
  const elapsedHours = Math.max(1 / 60, (asOf - products.since) / 3_600_000)
  const sold = new Map(products.items.map((item) => [item.key, item]))
  // A set, not a scan per product: this runs every second, over catalogs of thousands.
  const listed = new Set(catalog?.items.map((product) => product.key) ?? [])
  const base: Array<{ key: string; name: string; orders: number; last: number | null }> = catalog
    ? [
        ...catalog.items.map((product) => {
          const inPeriod = sold.get(product.key)
          return inPeriod ?? { key: product.key, name: product.name, orders: 0, last: products.until === null ? product.last : null }
        }),
        ...products.items.filter((item) => !listed.has(item.key)),
      ]
    : products.items
  return base.map((item) => {
    const silentMs = item.last === null ? Number.POSITIVE_INFINITY : asOf - item.last
    return {
      key: item.key,
      name: item.name,
      orders: item.orders,
      last: item.last,
      silentMs,
      expected: (item.orders / elapsedHours) * (minutes / 60),
      quiet: silentMs >= minutes * 60_000,
    }
  })
}

/** The list's own order: usual orders, highest first — see `sortRows`. */
const DEFAULT_SORT: Sort = { key: 'expected', dir: 'desc' }

/** The way a column sorts when first chosen: names A→Z, figures highest first. */
const firstDir = (key: SortKey): Sort['dir'] => (key === 'name' ? 'asc' : 'desc')

const SORT_KEYS: readonly SortKey[] = ['expected', 'silence', 'orders', 'name']
const acceptSort = (value: unknown): Sort | null => {
  if (!value || typeof value !== 'object') return null
  const { key, dir } = value as Record<string, unknown>
  return SORT_KEYS.includes(key as SortKey) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : null
}

/**
 * The rows in the order picked. The default puts the quiet products first —
 * the most unusual, then the longest quiet — and those with a recent order
 * after, latest first. Any other choice is the column's own order, either way
 * round; ties go to the longest quiet.
 */
function sortRows(rows: Row[], sort: Sort): Row[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) {
      if (a.quiet !== b.quiet) return a.quiet ? -1 : 1
      if (!a.quiet) return compare(a.silentMs, b.silentMs)
      return compare(b.expected, a.expected) || compare(b.silentMs, a.silentMs)
    }
    const primary =
      sort.key === 'name'
        ? a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' })
        : sort.key === 'orders'
          ? compare(a.orders, b.orders)
          : sort.key === 'silence'
            ? compare(a.silentMs, b.silentMs)
            : compare(a.expected, b.expected)
    return sign * primary || compare(b.silentMs, a.silentMs)
  })
}

/** The colours of a product's state: flagged, quiet, never ordered, recent. */
const STATE_COLOR = {
  unusual: 'warning.main',
  quiet: 'color-mix(in srgb, var(--mui-palette-warning-main) 40%, transparent)',
  never: 'text.disabled',
  recent: 'color-mix(in srgb, var(--mui-palette-success-main) 70%, transparent)',
} as const
type State = keyof typeof STATE_COLOR
const stateOf = (row: Row): State => (!row.quiet ? 'recent' : row.last === null ? 'never' : row.expected >= UNUSUAL ? 'unusual' : 'quiet')

/** The rows counted by state, the ones that need a look first. */
function useStateSegments(rows: Row[]): Segment[] {
  const t = useTranslations('dashboard')
  const counts: Record<State, number> = { unusual: 0, quiet: 0, never: 0, recent: 0 }
  for (const row of rows) counts[stateOf(row)] += 1
  const order: State[] = ['unusual', 'quiet', 'never', 'recent']
  // A state no product is in stays out of the legend, except the two every reader looks for.
  return order
    .filter((state) => counts[state] > 0 || state === 'quiet' || state === 'recent')
    .map((state) => ({ key: state, label: t(`silentSeg.${state}`), value: counts[state], color: STATE_COLOR[state] }))
}

/** How long since the last order, in the steps a reader thinks in (minutes). */
const BUCKETS = [60, 180, 360, 720, 1440, 4320]

/**
 * The full view's chart: the products by state; then how long each has gone
 * without an order, step by step (each step split by state); and the most
 * unusually quiet, ranked by the orders they would usually have had.
 */
function SilentChart({
  rows,
  quiet,
  windowLabel,
  since,
  approx,
}: {
  rows: Row[]
  quiet: Row[]
  windowLabel: string
  since: (row: Row) => string
  approx: (value: number) => string
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const duration = useDuration()
  const count = (value: number) => formatNumber(value, locale)
  const segments = useStateSegments(rows)

  const steps = [
    ...BUCKETS.map((upTo, i) => ({
      key: String(upTo),
      label: i === 0 ? `< ${duration(upTo * 60_000)}` : `${duration(BUCKETS[i - 1] * 60_000)} – ${duration(upTo * 60_000)}`,
      within: (row: Row) => row.last !== null && row.silentMs < upTo * 60_000 && (i === 0 || row.silentMs >= BUCKETS[i - 1] * 60_000),
    })),
    { key: 'longer', label: `> ${duration(BUCKETS[BUCKETS.length - 1] * 60_000)}`, within: (row: Row) => row.last !== null && row.silentMs >= BUCKETS[BUCKETS.length - 1] * 60_000 },
    { key: 'never', label: t('silentBucketNever'), within: (row: Row) => row.last === null },
  ]
  const stepRows = steps
    .map((step) => {
      const members = rows.filter(step.within)
      const by = (state: State) => members.filter((row) => stateOf(row) === state).length
      return {
        key: step.key,
        label: step.label,
        valueText: count(members.length),
        parts: (['unusual', 'quiet', 'never', 'recent'] as State[]).map((state) => ({ value: by(state), color: STATE_COLOR[state] })),
        total: members.length,
      }
    })
    // The never-ordered step only where there are such products.
    .filter((step) => step.key !== 'never' || step.total > 0)

  const flagged = [...quiet].filter((row) => row.expected > 0).sort((a, b) => b.expected - a.expected).slice(0, 10)
  const flaggedRows = flagged.map((row) => ({
    key: row.key,
    label: row.name,
    valueText: t('silentExpectedOrders', { expected: approx(row.expected) }),
    sub: t('silentUnusualSub', { since: since(row), orders: count(row.orders) }),
    parts: [{ value: row.expected, color: row.expected >= UNUSUAL ? STATE_COLOR.unusual : STATE_COLOR.quiet }],
    strong: row.expected >= UNUSUAL,
  }))

  return (
    <Box sx={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0, pr: 0.5 }}>
      <ShareBar segments={segments} height={14} format={count} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 3, md: 4 }, mt: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            {t('silentBucketsTitle')}
          </Typography>
          <Box sx={{ mb: 1.5 }}>
            <PartsLegend parts={segments.map((s) => ({ label: s.label, color: s.color }))} />
          </Box>
          <BarList rows={stepRows} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {t('silentTopUnusualTitle')}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1.5 }}>
            {t('silentTopUnusualNote', { window: windowLabel })}
          </Typography>
          {flaggedRows.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
              {t('silentNoUnusual')}
            </Typography>
          ) : (
            <BarList rows={flaggedRows} rank />
          )}
        </Box>
      </Box>
    </Box>
  )
}

function FlagIcon({ tip }: { tip: string }) {
  return (
    <Tooltip title={tip}>
      <ReportProblemOutlined aria-label={tip} sx={{ fontSize: 18, color: 'warning.main', flexShrink: 0 }} />
    </Tooltip>
  )
}

function RecentIcon({ tip }: { tip: string }) {
  return (
    <Tooltip title={tip}>
      <CheckCircleOutlined aria-label={tip} sx={{ fontSize: 18, color: 'success.main', flexShrink: 0 }} />
    </Tooltip>
  )
}

function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void }) {
  const t = useTranslations('dashboard')
  const sx = { px: 1.25, py: 0.25, textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' } as const
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={scope}
      onChange={(_event, next: Scope | null) => next && onChange(next)}
      aria-label={t('silentScope')}
    >
      <ToggleButton value="sold" sx={sx}>
        {t('silentScopeSold')}
      </ToggleButton>
      <ToggleButton value="all" sx={sx}>
        {t('silentScopeAll')}
      </ToggleButton>
    </ToggleButtonGroup>
  )
}

/** The texts a row needs: its status icon, how long it has been quiet, and why it is flagged. */
function useRowText(products: SapoProducts, catalog: SapoCatalog | null, windowLabel: string, asOf: number) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const duration = useDuration()
  const knownDays = catalog?.knownSince ? Math.max(1, Math.round((asOf - catalog.knownSince) / 86_400_000)) : null
  return {
    since: (row: Row) =>
      row.last !== null ? duration(row.silentMs) : products.until === null ? t('neverOrdered') : t('neverInPeriod'),
    sinceTip: (row: Row, at: Intl.DateTimeFormat) =>
      row.last !== null
        ? t('silentLastOrder', { time: at.format(new Date(row.last)) })
        : knownDays
          ? t('neverOrderedTip', { days: knownDays })
          : t('neverInPeriod'),
    icon: (row: Row) =>
      !row.quiet ? (
        <RecentIcon tip={t('recentOrder', { window: windowLabel })} />
      ) : row.expected >= UNUSUAL ? (
        <FlagIcon tip={t('silentUnusualTip', { expected: formatNumber(row.expected, locale, 1), window: windowLabel })} />
      ) : (
        <Box sx={{ width: 18, flexShrink: 0 }} />
      ),
  }
}

export function SilentProductsCard({
  products,
  periodLabel,
  now,
  minutes,
  onMinutesChange,
  scope,
  onScopeChange,
  catalog,
  catalogError,
  catalogLoading,
  bare = false,
}: {
  products: SapoProducts
  /** The period as words: "hôm nay", "7 ngày qua", "01/09 – 10/09". */
  periodLabel: string
  /** The page's one-second clock. */
  now: number
  minutes: number
  onMinutesChange: (minutes: number) => void
  scope: Scope
  onScopeChange: (scope: Scope) => void
  catalog: SapoCatalog | null
  catalogError: string | null
  catalogLoading: boolean
  /** Without the card frame and title, inside a dialog that names it. */
  bare?: boolean
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const duration = useDuration()
  const [custom, setCustom] = useState(() => !PRESETS.includes(minutes))
  const [draft, setDraft] = useState<Draft>(() =>
    PRESETS.includes(minutes)
      ? { value: '90', unit: 'minutes' }
      : minutes % 60 === 0
        ? { value: String(minutes / 60), unit: 'hours' }
        : { value: String(minutes), unit: 'minutes' },
  )
  const [query, setQuery] = useState('')
  const [sort, setSort] = usePreference<Sort>('adshub.silent.sort', DEFAULT_SORT, acceptSort)
  const [limit, setLimit] = useState(PAGE)
  const [savedView, setView] = usePreference<DetailView>('adshub.silent.view', 'chart', acceptView)
  // The card's own list is always the table; the chart is the full view's.
  const view: DetailView = bare ? savedView : 'table'

  const choose = (next: number) => {
    onMinutesChange(next)
    setLimit(PAGE)
  }
  const applyDraft = (next: Draft) => {
    setDraft(next)
    const value = Number(next.value)
    if (Number.isFinite(value) && value > 0) choose(next.unit === 'hours' ? value * 60 : value)
  }
  const pick = (next: number | 'custom') => {
    if (next === 'custom') {
      setCustom(true)
      applyDraft(draft)
      return
    }
    setCustom(false)
    choose(next)
  }

  const all = scope === 'all'
  // A view that ended before today counts its quiet back from its own end.
  const ended = products.until !== null
  const asOf = products.until ?? now
  const windowLabel = duration(minutes * 60_000)
  const period = periodLabel
  const approx = (value: number) =>
    value < 0.1 ? t('silentLessThanOne') : `≈ ${formatNumber(value, locale, value < 10 ? 1 : 0)}`
  const at = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  const text = useRowText(products, all ? catalog : null, windowLabel, asOf)

  const rows = productRows(products, all ? catalog : null, asOf, minutes)
  const quiet = rows.filter((row) => row.quiet)
  const listed = all ? rows : quiet
  const unusual = quiet.filter((row) => row.expected >= UNUSUAL).length
  const needle = fold(query.trim())
  const matching = needle ? listed.filter((row) => fold(row.name).includes(needle)) : listed
  const sorted = sortRows(matching, sort)
  const visible = sorted.slice(0, limit)

  // A heading sorts by its column; pressed again, the other way round.
  const sortHeader = (key: SortKey, label: string) => (
    <TableSortLabel
      active={sort.key === key}
      // Unchosen, the arrow shown on hover is the way the first press sorts.
      direction={sort.key === key ? sort.dir : firstDir(key)}
      onClick={() => {
        setSort((current) =>
          current.key === key ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: firstDir(key) },
        )
        setLimit(PAGE)
      }}
    >
      {label}
    </TableSortLabel>
  )
  const ariaSort = (key: SortKey) => (sort.key === key ? sort.dir : false)

  const summaryKey = all
    ? ended
      ? 'silentSummaryAllEnd'
      : 'silentSummaryAll'
    : ended
      ? 'silentSummaryEnd'
      : 'silentSummary'

  const body = (
    <>
      {bare ? null : <Typography variant="subtitle2">{t('silentTitle')}</Typography>}
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        {all ? t('silentSubtitleAll') : t('silentSubtitle', { period })}
      </Typography>

      {/* The scope and the window, then the search: one row of controls above the list. */}
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          {bare ? <ViewToggle view={savedView} onChange={setView} /> : null}
          <ScopeToggle scope={scope} onChange={onScopeChange} />
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: { sm: 1 } }}>
            {t('silentWindow')}
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={custom ? 'custom' : minutes}
            onChange={(_event, next: number | 'custom' | null) => next !== null && pick(next)}
            aria-label={t('silentWindow')}
            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          >
            {PRESETS.map((preset) => (
              <ToggleButton
                key={preset}
                value={preset}
                sx={{ px: 1.25, py: 0.25, textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {duration(preset * 60_000)}
              </ToggleButton>
            ))}
            <ToggleButton value="custom" sx={{ px: 1.25, py: 0.25, textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {t('silentCustom')}
            </ToggleButton>
          </ToggleButtonGroup>
          {/* The same choice as a dropdown, where the buttons would not fit. */}
          <TextField
            select
            size="small"
            value={custom ? 'custom' : String(minutes)}
            onChange={(event) => pick(event.target.value === 'custom' ? 'custom' : Number(event.target.value))}
            slotProps={{ htmlInput: { 'aria-label': t('silentWindow') } }}
            sx={{ display: { xs: 'inline-flex', sm: 'none' }, minWidth: 120 }}
          >
            {PRESETS.map((preset) => (
              <MenuItem key={preset} value={String(preset)}>
                {duration(preset * 60_000)}
              </MenuItem>
            ))}
            <MenuItem value="custom">{t('silentCustom')}</MenuItem>
          </TextField>
          {custom ? (
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                type="number"
                value={draft.value}
                onChange={(event) => applyDraft({ ...draft, value: event.target.value })}
                slotProps={{ htmlInput: { min: 1, 'aria-label': t('silentCustom') } }}
                sx={{ width: 90 }}
              />
              <TextField
                size="small"
                select
                value={draft.unit}
                onChange={(event) => applyDraft({ ...draft, unit: event.target.value as Draft['unit'] })}
                sx={{ width: 100 }}
              >
                <MenuItem value="minutes">{t('unitMinutes')}</MenuItem>
                <MenuItem value="hours">{t('unitHours')}</MenuItem>
              </TextField>
            </Stack>
          ) : null}
        </Stack>
        {view === 'chart' ? null : (
        <TextField
          size="small"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setLimit(PAGE)
          }}
          placeholder={t('silentSearch')}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
            },
            htmlInput: { 'aria-label': t('silentSearch') },
          }}
          sx={{ flex: { xs: '1 1 100%', sm: '0 0 240px' } }}
        />
        )}
      </Stack>

      {all && catalogLoading ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
          {t('catalogLoading')}
        </Typography>
      ) : null}
      {all && catalogError ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'error.main', mb: 1 }}>
          {t('catalogError', { message: catalogError })}
        </Typography>
      ) : null}

      {rows.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {products.pendingDays > 0 ? t('silentSyncing', { count: products.pendingDays }) : t('silentNoSales', { period })}
        </Typography>
      ) : (
        <>
          {/* The answer in one line, with the flagged count beside it. */}
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mb: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t(summaryKey, { silent: quiet.length, total: rows.length, window: windowLabel })}
            </Typography>
            {unusual > 0 ? (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <ReportProblemOutlined sx={{ fontSize: 16, color: 'warning.main' }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('silentUnusual', { count: unusual })}
                </Typography>
              </Stack>
            ) : null}
          </Stack>

          {view === 'chart' ? (
            <SilentChart rows={rows} quiet={quiet} windowLabel={windowLabel} since={text.since} approx={approx} />
          ) : listed.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t(ended ? 'silentNoneEnd' : 'silentNone', { total: rows.length, period, window: windowLabel })}
            </Typography>
          ) : matching.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t('silentNoMatch')}
            </Typography>
          ) : (
            <TableScroll fill={bare}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sortDirection={ariaSort('name')}>{sortHeader('name', t('silentColProduct'))}</TableCell>
                    <TableCell align="right" sortDirection={ariaSort('silence')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                      {sortHeader('silence', t('silentColSince'))}
                    </TableCell>
                    <TableCell align="right" sortDirection={ariaSort('orders')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                      {sortHeader('orders', t('silentColOrders'))}
                    </TableCell>
                    <TableCell align="right" sortDirection={ariaSort('expected')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                      {sortHeader('expected', t('silentColExpected', { window: windowLabel }))}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((row) => {
                    const flagged = row.quiet && row.expected >= UNUSUAL
                    const opensInSapo = products.adminUrl !== '' && /^\d+$/.test(row.key)
                    const sinceTip = text.sinceTip(row, at)
                    return (
                      <TableRow key={row.key} hover>
                        <TableCell>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                            {text.icon(row)}
                            <Box sx={{ minWidth: 0, maxWidth: NAME_MAX }}>
                              {opensInSapo ? (
                                <Link
                                  href={`${products.adminUrl}${row.key}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  underline="hover"
                                  color="inherit"
                                  title={`${row.name} · ${t('silentOpen')}`}
                                  sx={{ display: 'block', fontWeight: flagged ? 600 : 400, ...NAME_TEXT }}
                                >
                                  {row.name}
                                </Link>
                              ) : (
                                <Typography variant="body2" title={row.name} sx={{ fontWeight: flagged ? 600 : 400, ...NAME_TEXT }}>
                                  {row.name}
                                </Typography>
                              )}
                              {/* On a phone, the other columns fold into this line. */}
                              <Typography
                                variant="caption"
                                title={sinceTip}
                                sx={{ display: { xs: 'block', sm: 'none' }, color: 'text.secondary' }}
                              >
                                {/* A product never ordered reads "No orders yet · …", not "No orders for No orders yet". */}
                                {t(row.last === null ? 'silentCompactNever' : 'silentCompact', {
                                  since: text.since(row),
                                  orders: formatNumber(row.orders, locale),
                                  expected: approx(row.expected),
                                })}
                              </Typography>
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', ...WIDE_ONLY }}>
                          <Tooltip title={sinceTip}>
                            <span>{text.since(row)}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', ...WIDE_ONLY }}>
                          {formatNumber(row.orders, locale)}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', ...WIDE_ONLY }}>
                          {approx(row.expected)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableScroll>
          )}

          {view === 'table' && sorted.length > limit ? (
            <Box sx={{ textAlign: 'center', mt: 1 }}>
              <Button size="small" onClick={() => setLimit((value) => value + PAGE)}>
                {t('silentMore', { count: Math.min(PAGE, sorted.length - limit) })}
              </Button>
            </Box>
          ) : null}

          {products.pendingDays > 0 ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', mt: 1 }}>
              {t('silentSyncing', { count: products.pendingDays })}
            </Typography>
          ) : null}
        </>
      )}
    </>
  )

  return bare ? (
    // A column that may shrink: the controls stay put and the table scrolls in the room the dialog leaves.
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>{body}</Box>
  ) : (
    <Card>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

/**
 * The overview's glimpse: how many products have gone quiet in the chosen
 * window, and the five that matter most; the full list opens in a dialog and
 * shares the window and the scope.
 */
export function SilentProductsSummary({
  products,
  periodLabel,
  now,
  projectId,
}: {
  products: SapoProducts
  periodLabel: string
  now: number
  projectId: string
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const duration = useDuration()
  const [minutes, setMinutes] = useSilentWindow()
  const [scope, setScope] = useSilentScope()
  const all = scope === 'all'
  const { catalog, error: catalogError, loading: catalogLoading } = useCatalog(projectId, all)
  const [open, setOpen] = useState(false)

  const ended = products.until !== null
  const asOf = products.until ?? now
  const windowLabel = duration(minutes * 60_000)
  const period = periodLabel
  const text = useRowText(products, all ? catalog : null, windowLabel, asOf)
  const rows = productRows(products, all ? catalog : null, asOf, minutes)
  const quiet = sortRows(
    rows.filter((row) => row.quiet),
    DEFAULT_SORT,
  )
  const unusual = quiet.filter((row) => row.expected >= UNUSUAL).length
  const segments = useStateSegments(rows)
  const options = PRESETS.includes(minutes) ? PRESETS : [...PRESETS, minutes].sort((a, b) => a - b)
  const headlineKey = all
    ? ended
      ? 'silentHeadlineAllEnd'
      : 'silentHeadlineAll'
    : ended
      ? 'silentHeadlineEnd'
      : 'silentHeadline'

  return (
    <>
      <InsightCard
        title={t('silentTitle')}
        badge={products.pendingDays > 0 ? <SyncChip label={t('syncChip')} tip={t('syncChipTip')} /> : undefined}
        subtitle={all ? t('silentSummarySubtitleAll') : t('silentSummarySubtitle', { period })}
        headerAction={
          <TextField
            select
            size="small"
            fullWidth={false}
            value={String(minutes)}
            onChange={(event) => setMinutes(Number(event.target.value))}
            slotProps={{ htmlInput: { 'aria-label': t('silentWindow') } }}
            sx={{ width: 120, flexShrink: 0 }}
          >
            {options.map((option) => (
              <MenuItem key={option} value={String(option)}>
                {duration(option * 60_000)}
              </MenuItem>
            ))}
          </TextField>
        }
        expand={rows.length > 0 ? { label: t('expand'), onClick: () => setOpen(true) } : undefined}
      >
        <Box sx={{ mb: 1.25 }}>
          <ScopeToggle scope={scope} onChange={setScope} />
        </Box>

        {rows.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
            {all && catalogLoading
              ? t('catalogLoading')
              : products.pendingDays > 0
                ? t('silentSyncing', { count: products.pendingDays })
                : t('silentNoSales', { period })}
          </Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Typography variant="h3" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {`${quiet.length}/${rows.length}`}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t(headlineKey, { window: windowLabel })}
              </Typography>
            </Stack>
            {unusual > 0 ? (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.5 }}>
                <ReportProblemOutlined sx={{ fontSize: 16, color: 'warning.main' }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('silentUnusual', { count: unusual })}
                </Typography>
              </Stack>
            ) : null}
            <Box sx={{ mt: 1.25 }}>
              <ShareBar segments={segments} height={10} format={(value) => formatNumber(value, locale)} />
            </Box>

            {quiet.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', py: 3 }}>
                {t(ended ? 'silentAllGoodEnd' : 'silentAllGood', { window: windowLabel })}
              </Typography>
            ) : (
              <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5 }}>
                {quiet.slice(0, SUMMARY_ROWS).map((row) => (
                  <Stack
                    key={row.key}
                    component="li"
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}
                  >
                    {text.icon(row)}
                    <Typography
                      variant="body2"
                      noWrap
                      title={row.name}
                      sx={{ flex: 1, minWidth: 0, fontWeight: row.expected >= UNUSUAL ? 600 : 400 }}
                    >
                      {row.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {text.since(row)}
                    </Typography>
                  </Stack>
                ))}
                {quiet.length > SUMMARY_ROWS ? (
                  <Typography component="li" variant="caption" sx={{ display: 'block', color: 'text.secondary', pt: 0.75 }}>
                    {t('silentMoreHidden', { count: quiet.length - SUMMARY_ROWS })}
                  </Typography>
                ) : null}
              </Box>
            )}
            {all && catalogError ? (
              <Typography variant="caption" sx={{ display: 'block', color: 'error.main', mt: 1 }}>
                {t('catalogError', { message: catalogError })}
              </Typography>
            ) : null}
          </>
        )}
      </InsightCard>

      <DetailsDialog open={open} onClose={() => setOpen(false)} title={t('silentTitle')} closeLabel={t('closeDetails')}>
        <SilentProductsCard
          products={products}
          periodLabel={periodLabel}
          now={now}
          minutes={minutes}
          onMinutesChange={setMinutes}
          scope={scope}
          onScopeChange={setScope}
          catalog={catalog}
          catalogError={catalogError}
          catalogLoading={catalogLoading}
          bare
        />
      </DetailsDialog>
    </>
  )
}
