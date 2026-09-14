'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
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
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import { SyncChip } from '@/components/charts/sync-chip'
import { TableScroll } from '@/components/ui/table-scroll'
import { usePreference } from '@/components/ui/use-preference'
import { formatCompact, formatMoney, formatNumber } from '@/core/utils/format'
import type { SapoProducts, SapoTotals } from '@/modules/overview/data/types'
import { DetailsDialog, InsightCard } from '../../shared/insight-card'
import { fold, useDuration } from '../../shared/text'

/**
 * The products that sell most in the period the filter picks (Sapo orders,
 * over the chosen channels) — ranked by orders, units sold, or GMV.
 *
 * The overview shows the top five in a small table — orders (or units), GMV,
 * and GMV without the cancelled orders, each column named — with a thin bar
 * under each name for the ranked figure; the hover on a row lists every
 * figure for the product. The full ranking — search, sorting by any column, cancellations
 * and GMV without them — opens in a dialog and follows the measure chosen on
 * the card. What each figure means shows on hover only — over the measure
 * buttons and the column headings — so no explanation takes room on the page.
 *
 * Every figure counts cancelled orders too, as the Sapo tiles do. A product's
 * share is its orders over all the period's orders; an order holding several
 * products counts for each, so shares may add up to more than the whole.
 */

const ORDERS = 'var(--adshub-series-3)'
const TOP = 5
const PAGE = 20

type Measure = 'orders' | 'quantity' | 'gmv'
type SortKey = Measure | 'share' | 'cancelled' | 'net' | 'last'
/** A table's order: a column, either way round. */
type Sort = { key: SortKey | 'name'; dir: 'asc' | 'desc' }
type Item = SapoProducts['items'][number]

/** Columns beyond the product's name: shown from the small breakpoint up, folded under the name below it. */
const WIDE_ONLY = { display: { xs: 'none', sm: 'table-cell' } } as const
/**
 * The widest a name runs in the full list: on a phone, the screen less the
 * rank column and the dialog's margins; wider, a steady 380px. Set on the
 * name itself — a table cell's own max-width is not honoured.
 */
const NAME_MAX = { xs: 'calc(100vw - 160px)', sm: 380 } as const
/** A name keeps to one line, cut with an ellipsis; the whole of it shows on hover. */
const NAME_TEXT = {
  display: 'block',
  maxWidth: NAME_MAX,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const
/** A heading that explains itself on hover. */
const HELP = { textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'help' } as const
const NUMERIC = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const

const netOf = (item: Item) => item.gmv - item.cancelledGmv
const cancelRate = (item: Item) => (item.orders > 0 ? item.cancelled / item.orders : 0)

/**
 * A cancel rate worth a flag: half as high again as the store's and five
 * points above it at least, over enough orders that it is not one unlucky one.
 */
function highCancel(item: Item, storeRate: number): boolean {
  return item.orders >= 5 && item.cancelled >= 2 && cancelRate(item) >= Math.max(storeRate * 1.5, storeRate + 0.05)
}

function valueOf(item: Item, key: SortKey): number {
  if (key === 'net') return netOf(item)
  // A product's share of the orders ranks exactly as its orders do.
  if (key === 'share') return item.orders
  return item[key]
}

/**
 * Figures highest first and names A→Z, or the other way round; ties go to
 * more orders, then to the more recent order.
 */
function rank(items: Item[], key: Sort['key'], dir: Sort['dir'] = 'desc'): Item[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const primary =
      key === 'name' ? a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }) : valueOf(a, key) - valueOf(b, key)
    return sign * primary || b.orders - a.orders || b.last - a.last
  })
}

/** The way a column sorts when first chosen: names A→Z, figures highest first. */
const firstDir = (key: Sort['key']): Sort['dir'] => (key === 'name' ? 'asc' : 'desc')

// The measure and the full list's order are remembered in this browser (see usePreference).
const MEASURES: readonly Measure[] = ['orders', 'quantity', 'gmv']
const SORT_KEYS: ReadonlyArray<Sort['key']> = ['name', 'orders', 'quantity', 'share', 'cancelled', 'gmv', 'net', 'last']
const acceptMeasure = (value: unknown): Measure | null => (MEASURES.includes(value as Measure) ? (value as Measure) : null)
const acceptSort = (value: unknown): Sort | null => {
  if (!value || typeof value !== 'object') return null
  const { key, dir } = value as Record<string, unknown>
  return SORT_KEYS.includes(key as Sort['key']) && (dir === 'asc' || dir === 'desc') ? { key: key as Sort['key'], dir } : null
}

function useFigures(totals: SapoTotals) {
  const locale = useLocale()
  return {
    count: (value: number) => formatNumber(value, locale),
    money: (value: number) => `${formatCompact(value, locale)} ₫`,
    exact: (value: number) => formatMoney(value, locale),
    percent: (value: number) => `${formatNumber(value * 100, locale, value > 0 && value < 0.1 ? 1 : 0)}%`,
    share: (item: Item) => (totals.created > 0 ? item.orders / totals.created : 0),
    /** The store's own cancel rate over the period, the yardstick for a product's. */
    storeRate: totals.created > 0 ? totals.cancelled / totals.created : 0,
    /** The store's rate as the "Đơn huỷ" tile writes it, one decimal. */
    storePercent: `${formatNumber(totals.created > 0 ? (totals.cancelled / totals.created) * 100 : 0, locale, 1)}%`,
    totalOrders: totals.created,
  }
}

type Figures = ReturnType<typeof useFigures>

function MeasureToggle({ measure, onChange }: { measure: Measure; onChange: (measure: Measure) => void }) {
  const t = useTranslations('dashboard')
  const sx = { px: 1.25, py: 0.25, textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' } as const
  // Each button says what it counts on hover.
  const option = (value: Measure, label: string, tip: string) => (
    <Tooltip key={value} title={tip} placement="top" describeChild>
      <ToggleButton value={value} sx={sx}>
        {label}
      </ToggleButton>
    </Tooltip>
  )
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={measure}
      onChange={(_event, next: Measure | null) => next && onChange(next)}
      aria-label={t('topMeasure')}
    >
      {option('orders', t('topByOrders'), t('topDefOrders'))}
      {option('quantity', t('topByQuantity'), t('topDefQuantity'))}
      {option('gmv', t('topByGmv'), t('topDefGmv'))}
    </ToggleButtonGroup>
  )
}

function HighCancelIcon({ item, figures }: { item: Item; figures: Figures }) {
  const t = useTranslations('dashboard')
  return (
    <WarningAmberOutlined
      titleAccess={t('topHighCancel', { rate: figures.percent(cancelRate(item)), store: figures.storePercent })}
      sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }}
    />
  )
}

/** Everything known about one product, for the hover on its bar. */
function ItemTip({ item, figures }: { item: Item; figures: Figures }) {
  const t = useTranslations('dashboard')
  const lines = [
    t('topTipOrders', { orders: figures.count(item.orders), share: figures.percent(figures.share(item)) }),
    t('topTipQuantity', { quantity: figures.count(item.quantity) }),
    t('topTipGmv', { gmv: figures.exact(item.gmv) }),
    t('topTipCancelled', { cancelled: figures.count(item.cancelled), rate: figures.percent(cancelRate(item)) }),
    t('topTipNet', { net: figures.exact(netOf(item)) }),
  ]
  return (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.25 }}>
        {item.name}
      </Typography>
      {lines.map((line) => (
        <Typography key={line} variant="caption" sx={{ display: 'block' }}>
          {line}
        </Typography>
      ))}
      {highCancel(item, figures.storeRate) ? (
        <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mt: 0.25 }}>
          {t('topHighCancel', { rate: figures.percent(cancelRate(item)), store: figures.storePercent })}
        </Typography>
      ) : null}
    </Box>
  )
}

/**
 * The card's top five as a small table: orders (units when ranking by them),
 * GMV and GMV without the cancelled orders, each column named and explained on
 * hover. A thin bar under each name draws the ranked figure against the first.
 */
function TopFive({ items, measure, figures }: { items: Item[]; measure: Measure; figures: Figures }) {
  const t = useTranslations('dashboard')
  const max = Math.max(0, ...items.map((item) => valueOf(item, measure))) || 1
  const first: 'orders' | 'quantity' = measure === 'quantity' ? 'quantity' : 'orders'
  const weight = (key: SortKey) => (measure === key ? 700 : 400)
  const heading = (label: string, tip: string, key: SortKey) => (
    <TableCell align="right" sx={{ fontWeight: weight(key) }}>
      <Tooltip title={tip} placement="top" describeChild>
        <Box component="span" sx={HELP}>
          {label}
        </Box>
      </Tooltip>
    </TableCell>
  )

  return (
    <Table
      size="small"
      sx={{
        '& th, & td': { px: 0.75, py: 0.75, fontVariantNumeric: 'tabular-nums' },
        // The figures and headings keep to one line; the name (first body cell) wraps.
        '& th, & td:not(:first-of-type)': { whiteSpace: 'nowrap' },
        '& th:first-of-type, & td:first-of-type': { pl: 0 },
        '& th:last-of-type, & td:last-of-type': { pr: 0 },
        '& tbody tr:last-of-type td': { borderBottom: 0 },
      }}
    >
      <TableHead>
        <TableRow>
          <TableCell>{t('silentColProduct')}</TableCell>
          {first === 'orders'
            ? heading(t('topColOrders'), t('topDefOrders'), 'orders')
            : heading(t('topColQuantity'), t('topDefQuantity'), 'quantity')}
          {heading(t('topColGmv'), t('topDefGmv'), 'gmv')}
          {heading(t('topColNet'), t('topDefNet'), 'net')}
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item) => (
          <Tooltip key={item.key} title={<ItemTip item={item} figures={figures} />} placement="top-start">
            <TableRow hover tabIndex={0} sx={{ outline: 'none', '&:focus-visible': { backgroundColor: 'action.hover' } }}>
              {/* Takes the room the figures leave; a long name keeps to one line, cut with an ellipsis (whole in the row's hover). */}
              <TableCell sx={{ width: '100%', maxWidth: 0 }}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                    {item.name}
                  </Typography>
                  {highCancel(item, figures.storeRate) ? <HighCancelIcon item={item} figures={figures} /> : null}
                </Stack>
                <Box
                  sx={{
                    mt: 0.5,
                    height: 4,
                    borderRadius: '0 2px 2px 0',
                    backgroundColor: ORDERS,
                    width: `${Math.max(2, (valueOf(item, measure) / max) * 100)}%`,
                    transition: 'width .6s cubic-bezier(0.22, 1, 0.36, 1)',
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  }}
                />
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: weight(first) }}>
                {figures.count(item[first])}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: weight('gmv') }}>
                {figures.money(item.gmv)}
              </TableCell>
              <TableCell align="right">{figures.money(netOf(item))}</TableCell>
            </TableRow>
          </Tooltip>
        ))}
      </TableBody>
    </Table>
  )
}

/** The overview's glimpse: the top five in a small table; the full ranking opens in a dialog. */
export function TopProductsSummary({
  products,
  periodLabel,
  totals,
  now,
}: {
  products: SapoProducts
  /** The period as words: "hôm nay", "7 ngày qua", "01/09 – 10/09". */
  periodLabel: string
  /** The period's Sapo totals: each product's share of the orders, and the store's cancel rate beside its own. */
  totals: SapoTotals
  /** The page's one-second clock. */
  now: number
}) {
  const t = useTranslations('dashboard')
  const [measure, setMeasure] = usePreference<Measure>('adshub.top.measure', 'orders', acceptMeasure)
  const [open, setOpen] = useState(false)
  const figures = useFigures(totals)
  const ranked = rank(products.items, measure)
  const syncing = products.pendingDays > 0

  return (
    <>
      <InsightCard
        title={t('topTitle')}
        badge={syncing ? <SyncChip label={t('syncChip')} tip={t('syncChipTip')} /> : undefined}
        subtitle={t('topSubtitle', { period: periodLabel })}
        expand={ranked.length > 0 ? { label: t('expand'), onClick: () => setOpen(true) } : undefined}
      >
        <Box sx={{ mb: 1.5 }}>
          <MeasureToggle measure={measure} onChange={setMeasure} />
        </Box>
        {ranked.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
            {syncing ? t('silentSyncing', { count: products.pendingDays }) : t('topEmpty', { period: periodLabel })}
          </Typography>
        ) : (
          <TopFive items={ranked.slice(0, TOP)} measure={measure} figures={figures} />
        )}
        {ranked.length > TOP ? (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
            {t('silentMoreHidden', { count: ranked.length - TOP })}
          </Typography>
        ) : null}
      </InsightCard>

      <DetailsDialog open={open} onClose={() => setOpen(false)} title={t('topTitle')} closeLabel={t('closeDetails')}>
        <TopProductsTable
          products={products}
          periodLabel={periodLabel}
          figures={figures}
          now={now}
          measure={measure}
          onMeasureChange={setMeasure}
        />
      </DetailsDialog>
    </>
  )
}

/** The full ranking, in the dialog behind the card. */
function TopProductsTable({
  products,
  periodLabel,
  figures,
  now,
  measure,
  onMeasureChange,
}: {
  products: SapoProducts
  periodLabel: string
  figures: Figures
  now: number
  measure: Measure
  onMeasureChange: (measure: Measure) => void
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const duration = useDuration()
  const [query, setQuery] = useState('')
  // The order chosen last time; without one, the measure picked, highest first.
  const [saved, setSort] = usePreference<Sort | null>('adshub.top.sort', null, acceptSort)
  const sort: Sort = saved ?? { key: measure, dir: 'desc' }
  const [limit, setLimit] = useState(PAGE)
  const at = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  })

  const needle = fold(query.trim())
  const matching = needle ? products.items.filter((item) => fold(item.name).includes(needle)) : products.items
  const sorted = rank(matching, sort.key, sort.dir)
  const visible = sorted.slice(0, limit)

  // A heading sorts by its column; pressed again, the other way round.
  const sortBy = (key: Sort['key']) => {
    setSort({ key, dir: sort.key === key ? (sort.dir === 'desc' ? 'asc' : 'desc') : firstDir(key) })
    setLimit(PAGE)
  }
  const ariaSort = (key: Sort['key']) => (sort.key === key ? sort.dir : false)

  const heading = (label: string, tip: string | null, key?: Sort['key']) => {
    const text = (
      <Box component="span" sx={tip ? HELP : undefined}>
        {label}
      </Box>
    )
    const control = key ? (
      <TableSortLabel
        active={sort.key === key}
        // Unchosen, the arrow shown on hover is the way the first press sorts.
        direction={sort.key === key ? sort.dir : firstDir(key)}
        onClick={() => sortBy(key)}
      >
        {text}
      </TableSortLabel>
    ) : (
      text
    )
    return tip ? (
      <Tooltip title={tip} placement="top">
        {control}
      </Tooltip>
    ) : (
      control
    )
  }
  const bold = (key: SortKey) => (sort.key === key ? 700 : 400)

  return (
    // A column that may shrink: the controls stay put and the table scrolls in the room left.
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        {t('topSubtitle', { period: periodLabel })}
      </Typography>

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
        <MeasureToggle
          measure={measure}
          onChange={(next) => {
            onMeasureChange(next)
            setSort({ key: next, dir: 'desc' })
            setLimit(PAGE)
          }}
        />
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
      </Stack>

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        {t('topSummary', { count: products.items.length, period: periodLabel })}
      </Typography>

      {products.items.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t('topEmpty', { period: periodLabel })}
        </Typography>
      ) : matching.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t('silentNoMatch')}
        </Typography>
      ) : (
        <TableScroll fill>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 40 }}>#</TableCell>
                <TableCell sortDirection={ariaSort('name')}>{heading(t('silentColProduct'), null, 'name')}</TableCell>
                <TableCell align="right" sortDirection={ariaSort('orders')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                  {heading(t('topColOrders'), t('topDefOrders'), 'orders')}
                </TableCell>
                <TableCell align="right" sortDirection={ariaSort('quantity')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                  {heading(t('topColQuantity'), t('topDefQuantity'), 'quantity')}
                </TableCell>
                <TableCell align="right" sortDirection={ariaSort('share')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                  {heading(t('topColShare'), t('topDefShare', { total: figures.count(figures.totalOrders) }), 'share')}
                </TableCell>
                <TableCell align="right" sortDirection={ariaSort('cancelled')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                  {heading(t('topColCancelled'), t('topDefCancelled', { store: figures.storePercent }), 'cancelled')}
                </TableCell>
                <TableCell align="right" sortDirection={ariaSort('gmv')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                  {heading(t('topColGmv'), t('topDefGmv'), 'gmv')}
                </TableCell>
                <TableCell align="right" sortDirection={ariaSort('net')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                  {heading(t('topColNet'), t('topDefNet'), 'net')}
                </TableCell>
                <TableCell align="right" sortDirection={ariaSort('last')} sx={{ whiteSpace: 'nowrap', ...WIDE_ONLY }}>
                  {heading(t('topColLast'), null, 'last')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((item, index) => {
                const opensInSapo = products.adminUrl !== '' && /^\d+$/.test(item.key)
                const share = figures.share(item)
                const flagged = highCancel(item, figures.storeRate)
                return (
                  <TableRow key={item.key} hover>
                    <TableCell sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{index + 1}</TableCell>
                    <TableCell>
                      {opensInSapo ? (
                        <Link
                          href={`${products.adminUrl}${item.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                          color="inherit"
                          title={`${item.name} · ${t('silentOpen')}`}
                          sx={{ fontWeight: index < 3 ? 600 : 400, ...NAME_TEXT }}
                        >
                          {item.name}
                        </Link>
                      ) : (
                        <Typography variant="body2" title={item.name} sx={{ fontWeight: index < 3 ? 600 : 400, ...NAME_TEXT }}>
                          {item.name}
                        </Typography>
                      )}
                      {/* On a phone, the other columns fold into this line. */}
                      <Typography variant="caption" sx={{ display: { xs: 'block', sm: 'none' }, maxWidth: NAME_MAX, color: 'text.secondary' }}>
                        {t('topCompact', {
                          orders: figures.count(item.orders),
                          quantity: figures.count(item.quantity),
                          gmv: figures.money(item.gmv),
                          cancelled: figures.count(item.cancelled),
                        })}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ ...NUMERIC, fontWeight: bold('orders'), ...WIDE_ONLY }}>
                      {figures.count(item.orders)}
                    </TableCell>
                    <TableCell align="right" sx={{ ...NUMERIC, fontWeight: bold('quantity'), ...WIDE_ONLY }}>
                      {figures.count(item.quantity)}
                    </TableCell>
                    <TableCell align="right" sx={{ ...NUMERIC, ...WIDE_ONLY }}>
                      <Tooltip title={t('topShareTip', { share: figures.percent(share), total: figures.count(figures.totalOrders) })}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                          <Box sx={{ width: 56, height: 6, borderRadius: 3, backgroundColor: 'action.hover', overflow: 'hidden' }}>
                            <Box sx={{ width: `${Math.min(100, share * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: ORDERS }} />
                          </Box>
                          <span>{figures.percent(share)}</span>
                        </Stack>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ ...NUMERIC, fontWeight: bold('cancelled'), ...WIDE_ONLY }}>
                      {item.cancelled === 0 ? (
                        <Box component="span" sx={{ color: 'text.disabled' }}>
                          0
                        </Box>
                      ) : (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                          {flagged ? <HighCancelIcon item={item} figures={figures} /> : null}
                          <span>{figures.count(item.cancelled)}</span>
                          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                            · {figures.percent(cancelRate(item))}
                          </Box>
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ ...NUMERIC, fontWeight: bold('gmv'), ...WIDE_ONLY }}>
                      <Tooltip title={figures.exact(item.gmv)}>
                        <span>{figures.money(item.gmv)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ ...NUMERIC, fontWeight: bold('net'), ...WIDE_ONLY }}>
                      <Tooltip title={figures.exact(netOf(item))}>
                        <span>{figures.money(netOf(item))}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ ...NUMERIC, ...WIDE_ONLY }}>
                      <Tooltip title={at.format(new Date(item.last))}>
                        <span>{t('topLastAgo', { since: duration(now - item.last) })}</span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {sorted.length > limit ? (
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
    </Box>
  )
}
