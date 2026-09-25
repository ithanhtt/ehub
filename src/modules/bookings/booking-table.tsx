'use client'

import { memo, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import Typography from '@mui/material/Typography'
import { alpha, useTheme, type SxProps, type Theme } from '@mui/material/styles'
import AddLinkOutlined from '@mui/icons-material/AddLinkOutlined'
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined'
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined'
import { CellTips } from '@/components/charts/cell-tips'
import { formatDateTime, formatMoney, formatNumber } from '@/core/utils/format'
import type { BookingListRow } from '@/features/bookings/queries'
import { monthOf } from './fields'
import { NUMERIC_COLUMNS, type ColumnId, type Prepared, type SortState } from './list'
import type { AirState } from './triage'

/** 2026-09-12 → 12/09/2026, as the team writes dates. */
export const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

export const videoHref = (row: BookingListRow) =>
  row.videoUrl && /^https?:\/\//.test(row.videoUrl) ? row.videoUrl : `https://www.tiktok.com/@${row.kocHandle}/video/${row.videoId}`

/** The colour of each air state: what is late warns, what is done is green, what is off is grey. */
const AIR_TONE: Record<AirState, 'error' | 'warning' | 'info' | 'success' | 'grey'> = {
  overdue: 'error',
  today: 'warning',
  waiting: 'info',
  unscheduled: 'grey',
  airedLate: 'warning',
  aired: 'success',
  cancelled: 'grey',
}

/** Width of the selection column; the code column sticks right after it. */
const CHECK_WIDTH = 48

/**
 * The styles of every cell, set once on the table rather than on each cell —
 * a page of 50 rows × 14 columns would otherwise have MUI work out 700 style
 * objects on each render. Cells take them by class; what differs per row (an
 * air state's colour, a sticky column's offset) goes in `style`.
 */
const tableSx: SxProps<Theme> = {
  '& th, & td': { whiteSpace: 'nowrap', py: 0.75, px: 1.25 },
  '& th': { fontWeight: 600, bgcolor: 'background.paper' },
  '& .num': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  '& .date': { fontVariantNumeric: 'tabular-nums' },
  '& .muted': { color: 'text.secondary' },
  '& .none': { color: 'text.disabled' },
  '& .clip': { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' },
  '& .code': { fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  '& .stick': { position: 'sticky', zIndex: 1, bgcolor: 'background.paper' },
  '& thead .stick': { zIndex: 3 },
  '& .edge': { boxShadow: (theme: Theme) => `inset -1px 0 0 ${theme.palette.divider}` },
  '& tbody tr:hover .stick': { backgroundImage: (theme: Theme) => `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})` },
  '& tbody tr.Mui-selected .stick': {
    backgroundImage: (theme: Theme) => `linear-gradient(${alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity)}, ${alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity)})`,
  },
  '& .chip': { display: 'inline-block', px: 1, py: 0.25, borderRadius: 1, fontSize: 12, fontWeight: 600, lineHeight: 1.5 },
  '& .src': { fontSize: 10, color: 'text.disabled', ml: 0.5, fontWeight: 400 },
  '& .koc': { fontSize: 14, color: 'text.primary', textAlign: 'left' },
  '& .koc b': { fontWeight: 600 },
  '& .koc span': { color: 'text.secondary' },
  '& a.video': { display: 'inline-flex', color: 'primary.main', p: 0.5 },
}

type Handlers = {
  onOpen: (row: BookingListRow) => void
  onKoc: (handle: string) => void
  onRowMenu: (anchor: HTMLElement, row: BookingListRow) => void
  onLink: (anchor: HTMLElement, row: BookingListRow) => void
  onToggle: (id: string) => void
}

/**
 * The booking list: the columns the team reads a booking by, in their order,
 * the code pinned on the left and the headings on top while the rows scroll
 * both ways; a click on a heading sorts by it. On a phone the rows become
 * compact cards instead (`cards`).
 *
 * Hovering a note, a result or a video shows its detail in one shared card
 * (CellTips) — never a Tooltip per cell.
 */
export function BookingTable({
  items,
  columns,
  sort,
  onSort,
  canEdit,
  selected,
  allSelected,
  someSelected,
  onToggleAll,
  cards,
  maxHeight,
  ...handlers
}: Handlers & {
  items: readonly Prepared[]
  columns: readonly ColumnId[]
  sort: SortState
  onSort: (column: ColumnId) => void
  canEdit: boolean
  selected: ReadonlySet<string>
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
  cards: boolean
  maxHeight: string
}) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  const theme = useTheme()

  const tones = useMemo(() => {
    const grey = { color: theme.palette.text.secondary, backgroundColor: theme.palette.action.hover }
    const of = (tone: (typeof AIR_TONE)[AirState]) =>
      tone === 'grey' ? grey : { color: theme.palette[tone].main, backgroundColor: alpha(theme.palette[tone].main, 0.12) }
    return Object.fromEntries(Object.entries(AIR_TONE).map(([state, tone]) => [state, of(tone)])) as Record<AirState, React.CSSProperties>
  }, [theme])

  const byId = useMemo(() => new Map(items.map((item) => [item.row.id, item])), [items])

  /** The shared hover card's content for a cell's `data-tip`: "<what>:<booking id>". */
  const tip = (key: string) => {
    const [what, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    const row = byId.get(id)?.row
    if (!row) return null
    if (what === 'note') return <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{row.note}</Typography>
    if (what === 'video') return t('openVideo')
    if (what === 'res') return resultTip(row)
    return null
  }

  const resultTip = (row: BookingListRow) => {
    if (row.resultSource === 'manual') return t('result.manualTip')
    const reason = row.resultNote ? t(`result.note.${row.resultNote}`) : null
    if (row.resultSource === 'tiktok') {
      const when = t('result.fromTiktok', { time: formatDateTime(row.resultSyncedAt, locale) })
      return reason ? `${when} · ${reason}` : when
    }
    if (reason) return reason
    return row.videoId ? t('result.notSynced') : t('result.noVideo')
  }

  // Steady between renders, so a row whose booking did not change is not drawn again (BookingRow is memoised).
  const labels: Labels = useMemo(
    () => ({
      headings: Object.fromEntries(columns.map((column) => [column, t(`column.${column}`)])) as Record<ColumnId, string>,
      source: { tiktok: t('result.sourceTiktok'), manual: t('result.sourceManual') },
      air: (item: Prepared) => t(`air.${item.standing.state}`, { days: item.standing.days }),
      link: t('addLink'),
      more: t('moreActions'),
    }),
    [t, columns],
  )

  if (cards) {
    return (
      <CellTips render={tip} sx={tableSx}>
        {items.map((item) => (
          <BookingCard key={item.row.id} item={item} canEdit={canEdit} selected={selected.has(item.row.id)} tone={tones[item.standing.state]} labels={labels} locale={locale} {...handlers} />
        ))}
      </CellTips>
    )
  }

  const codeLeft = canEdit ? CHECK_WIDTH : 0
  return (
    <CellTips render={tip} sx={[{ overflow: 'auto', maxHeight }, tableSx] as SxProps<Theme>}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {canEdit ? (
              <TableCell padding="checkbox" className="stick" style={{ left: 0, width: CHECK_WIDTH, minWidth: CHECK_WIDTH }}>
                <Checkbox size="small" checked={allSelected} indeterminate={!allSelected && someSelected} onChange={onToggleAll} />
              </TableCell>
            ) : null}
            {columns.map((column) => (
              <TableCell
                key={column}
                className={column === 'code' ? 'stick edge' : NUMERIC_COLUMNS.has(column) ? 'num' : undefined}
                style={column === 'code' ? { left: codeLeft } : undefined}
                sortDirection={sort.column === column ? (sort.desc ? 'desc' : 'asc') : false}
              >
                <TableSortLabel active={sort.column === column} direction={sort.column === column && sort.desc ? 'desc' : 'asc'} onClick={() => onSort(column)}>
                  {labels.headings[column]}
                </TableSortLabel>
              </TableCell>
            ))}
            <TableCell padding="checkbox" />
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <BookingRow
              key={item.row.id}
              item={item}
              columns={columns}
              canEdit={canEdit}
              selected={selected.has(item.row.id)}
              codeLeft={codeLeft}
              tone={tones[item.standing.state]}
              labels={labels}
              locale={locale}
              {...handlers}
            />
          ))}
        </TableBody>
      </Table>
    </CellTips>
  )
}

type Labels = {
  headings: Record<ColumnId, string>
  source: { tiktok: string; manual: string }
  air: (item: Prepared) => string
  link: string
  more: string
}

type RowProps = Handlers & {
  item: Prepared
  canEdit: boolean
  selected: boolean
  tone: React.CSSProperties
  labels: Labels
  locale: string
}

/** A figure of the results, "—" when unknown, with where it came from. */
function Result({ row, value, labels }: { row: BookingListRow; value: string | null; labels: Labels }) {
  return (
    <span data-tip={`res:${row.id}`}>
      {value === null ? <span className="none">—</span> : value}
      {value !== null && row.resultSource ? <span className="src">{labels.source[row.resultSource]}</span> : null}
    </span>
  )
}

function VideoCell({ row, canEdit, labels, onLink }: Pick<RowProps, 'canEdit' | 'labels' | 'onLink'> & { row: BookingListRow }) {
  if (row.videoId) {
    return (
      <a className="video" href={videoHref(row)} target="_blank" rel="noreferrer" data-tip={`video:${row.id}`} onClick={(event) => event.stopPropagation()}>
        <OpenInNewOutlined sx={{ fontSize: 18 }} />
      </a>
    )
  }
  if (canEdit && row.status !== 'cancelled') {
    return (
      <IconButton
        size="small"
        aria-label={labels.link}
        color={row.status === 'aired' ? 'warning' : 'primary'}
        onClick={(event) => {
          event.stopPropagation()
          onLink(event.currentTarget, row)
        }}
      >
        <AddLinkOutlined sx={{ fontSize: 18 }} />
      </IconButton>
    )
  }
  return <span className="none">—</span>
}

function KocName({ row, onKoc }: { row: BookingListRow; onKoc: (handle: string) => void }) {
  return (
    <Link
      component="button"
      underline="hover"
      className="koc"
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation()
        onKoc(row.kocHandle)
      }}
    >
      {row.kocName ? (
        <>
          <b>{row.kocName}</b> <span>· @{row.kocHandle}</span>
        </>
      ) : (
        <b>@{row.kocHandle}</b>
      )}
    </Link>
  )
}

/** One row — memoised, so selecting a row or opening a menu re-renders that row, not the page of them. */
const BookingRow = memo(function BookingRow({ item, columns, canEdit, selected, codeLeft, tone, labels, locale, ...handlers }: RowProps & { columns: readonly ColumnId[]; codeLeft: number }) {
  const { row } = item
  const cell = (column: ColumnId) => {
    switch (column) {
      case 'code':
        return (
          <TableCell key={column} className="stick edge code" style={{ left: codeLeft }}>
            {row.code}
          </TableCell>
        )
      case 'bookedOn':
        return <TableCell key={column} className="date">{dmy(row.bookedOn)}</TableCell>
      case 'month':
        return <TableCell key={column} className="date muted">{monthOf(row.bookedOn)}</TableCell>
      case 'product':
        return (
          <TableCell key={column} className="clip muted" title={row.product ?? undefined}>
            {row.product ?? <span className="none">—</span>}
          </TableCell>
        )
      case 'koc':
        return (
          <TableCell key={column}>
            <KocName row={row} onKoc={handlers.onKoc} />
          </TableCell>
        )
      case 'cost':
        return <TableCell key={column} className="num">{formatMoney(row.cost, locale)}</TableCell>
      case 'plannedAirOn':
        return <TableCell key={column} className="date">{row.plannedAirOn ? dmy(row.plannedAirOn) : <span className="none">—</span>}</TableCell>
      case 'airedOn':
        return <TableCell key={column} className="date">{row.airedOn ? dmy(row.airedOn) : <span className="none">—</span>}</TableCell>
      case 'airStatus':
        return (
          <TableCell key={column}>
            <span className="chip" style={tone}>
              {labels.air(item)}
            </span>
          </TableCell>
        )
      case 'orders':
        return (
          <TableCell key={column} className="num">
            <Result row={row} value={row.resultOrders === null ? null : formatNumber(row.resultOrders, locale)} labels={labels} />
          </TableCell>
        )
      case 'revenue':
        return (
          <TableCell key={column} className="num">
            <Result row={row} value={row.resultRevenue === null ? null : formatMoney(row.resultRevenue, locale)} labels={labels} />
          </TableCell>
        )
      case 'tier':
        return <TableCell key={column}>{row.kocTier ?? <span className="none">—</span>}</TableCell>
      case 'video':
        return (
          <TableCell key={column} padding="none" align="center">
            <VideoCell row={row} canEdit={canEdit} labels={labels} onLink={handlers.onLink} />
          </TableCell>
        )
      case 'note':
        return (
          <TableCell key={column} className="clip muted">
            {row.note ? <span data-tip={`note:${row.id}`}>{row.note}</span> : <span className="none">—</span>}
          </TableCell>
        )
    }
  }
  return (
    <TableRow
      hover
      selected={selected}
      onClick={canEdit ? () => handlers.onOpen(row) : undefined}
      style={{ cursor: canEdit ? 'pointer' : undefined, opacity: row.status === 'cancelled' ? 0.55 : undefined }}
    >
      {canEdit ? (
        <TableCell padding="checkbox" className="stick" style={{ left: 0 }} onClick={(event) => event.stopPropagation()}>
          <Checkbox size="small" checked={selected} onChange={() => handlers.onToggle(row.id)} />
        </TableCell>
      ) : null}
      {columns.map(cell)}
      <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
        {canEdit ? (
          <IconButton size="small" aria-label={labels.more} onClick={(event) => handlers.onRowMenu(event.currentTarget, row)}>
            <MoreHorizOutlined fontSize="small" />
          </IconButton>
        ) : null}
      </TableCell>
    </TableRow>
  )
})

/** A booking on a phone: the same fields, stacked in a few lines. */
const BookingCard = memo(function BookingCard({ item, canEdit, selected, tone, labels, locale, ...handlers }: RowProps) {
  const { row } = item
  return (
    <Box
      onClick={canEdit ? () => handlers.onOpen(row) : undefined}
      style={{ opacity: row.status === 'cancelled' ? 0.55 : undefined }}
      sx={{ display: 'flex', gap: 1, px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider', cursor: canEdit ? 'pointer' : undefined, bgcolor: selected ? 'action.selected' : undefined }}
    >
      {canEdit ? (
        <Box onClick={(event) => event.stopPropagation()} sx={{ ml: -1 }}>
          <Checkbox size="small" checked={selected} onChange={() => handlers.onToggle(row.id)} />
        </Box>
      ) : null}
      <Box sx={{ minWidth: 0, flex: 1, fontSize: 14 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span className="code">{row.code}</span>
          <span className="muted date">{dmy(row.bookedOn)}</span>
          <Box sx={{ flex: 1 }} />
          <span className="chip" style={tone}>
            {labels.air(item)}
          </span>
        </Box>
        <Box sx={{ mt: 0.5 }}>
          <KocName row={row} onKoc={handlers.onKoc} />
          {row.kocTier ? <span className="muted"> · {row.kocTier}</span> : null}
        </Box>
        <Box className="muted" sx={{ mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[row.product, formatMoney(row.cost, locale)].filter(Boolean).join(' · ')}
        </Box>
        <Box sx={{ mt: 0.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Result row={row} value={row.resultOrders === null ? null : formatNumber(row.resultOrders, locale)} labels={labels} />
          <Result row={row} value={row.resultRevenue === null ? null : formatMoney(row.resultRevenue, locale)} labels={labels} />
          <Box sx={{ flex: 1 }} />
          <VideoCell row={row} canEdit={canEdit} labels={labels} onLink={handlers.onLink} />
          {canEdit ? (
            <IconButton
              size="small"
              aria-label={labels.more}
              onClick={(event) => {
                event.stopPropagation()
                handlers.onRowMenu(event.currentTarget, row)
              }}
            >
              <MoreHorizOutlined fontSize="small" />
            </IconButton>
          ) : null}
        </Box>
        {row.note ? (
          <Box className="muted" data-tip={`note:${row.id}`} sx={{ mt: 0.25, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.note}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
})
