'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { capitalizeFirst } from '@/core/utils/format'
import ShowChartOutlined from '@mui/icons-material/ShowChartOutlined'
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined'
import { TableScroll } from '@/components/ui/table-scroll'
import { ExpandButton } from './expand-button'

/**
 * The container every dashboard chart sits in: title, legend, and the table
 * view that is each chart's accessible twin.
 *
 * The legend appears only for two or more series — with one, the title
 * already says what is plotted. Legend keys mirror the mark (a short line for
 * a line chart); the label beside them stays in text ink, never the series
 * color. `dimmed` holds the previous render at reduced opacity while fresh
 * data loads, so a refresh never flashes a skeleton or shifts the layout.
 * `bare` drops the card frame and the title, for a chart shown inside a
 * dialog that already names it; its table then takes the room the dialog
 * leaves, scrolling under its pinned headings. `expand`
 * adds the expand icon beside the table toggle. The table sorts by any
 * column, as the product tables do — pressed again, the other way round —
 * and starts most recent first.
 */

export type LegendItem = { key: string; label: string; color: string; mark?: 'line' | 'bar' }

/**
 * A table cell: its text, and for a figure the number it sorts by — null for
 * a gap ("—", still loading), which sinks to the bottom either way round.
 */
export type TableCellValue = string | { text: string; sort: number | null }

export type TableView = {
  /** A heading, with what it counts on hover when that needs saying. */
  columns: Array<string | { label: string; tip?: string }>
  /** Most recent first. The first column is the time: sorting by it keeps this order, or turns it round. */
  rows: Array<Array<TableCellValue>>
}

/**
 * A table's order: a column, either way round — and the columns it was chosen
 * among, so another set of columns (another range, another view) starts afresh.
 */
export type TableSort = { column: number; dir: 'asc' | 'desc'; columns: string }

/** A short, steady name for a set of column headings — what a remembered order keeps, so it stays small. */
function signatureOf(labels: string[]): string {
  let hash = 5381
  for (const char of labels.join('|')) hash = ((hash << 5) + hash + (char.codePointAt(0) ?? 0)) | 0
  return (hash >>> 0).toString(36)
}

/** A saved order read back — null when it is not one. */
export function acceptTableSort(value: unknown): TableSort | null {
  if (!value || typeof value !== 'object') return null
  const { column, dir, columns } = value as Record<string, unknown>
  return typeof column === 'number' && Number.isInteger(column) && column >= 0 && (dir === 'asc' || dir === 'desc') && typeof columns === 'string'
    ? { column, dir, columns }
    : null
}

/** A heading that explains itself on hover, as in the product tables. */
const HELP = { textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'help' } as const

export function ChartCard({
  title,
  subtitle,
  legend = [],
  table,
  labels,
  dimmed = false,
  bare = false,
  expand,
  badge,
  children,
  action,
  view: viewProp,
  onViewChange,
  sort: sortProp,
  onSortChange,
}: {
  title: string
  subtitle?: string
  legend?: LegendItem[]
  table?: TableView
  labels: { chart: string; table: string }
  dimmed?: boolean
  bare?: boolean
  expand?: { label: string; onClick: () => void }
  /** A small mark beside the title (a "syncing" chip). */
  badge?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  /** The chart or its table — held by the caller when passed, to share it (card and dialog) or remember it. */
  view?: 'chart' | 'table'
  onViewChange?: (view: 'chart' | 'table') => void
  /** The table's order, the same way. */
  sort?: TableSort | null
  onSortChange?: (sort: TableSort) => void
}) {
  // Kept here unless the caller holds them.
  const [ownView, setOwnView] = useState<'chart' | 'table'>('chart')
  const [ownSort, setOwnSort] = useState<TableSort | null>(null)
  const view = viewProp ?? ownView
  const setView = (next: 'chart' | 'table') => {
    setOwnView(next)
    onViewChange?.(next)
  }
  const sort = sortProp !== undefined ? sortProp : ownSort
  const setSort = (next: TableSort) => {
    setOwnSort(next)
    onSortChange?.(next)
  }

  const body = (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          {bare ? (
            badge ?? null
          ) : (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">{title}</Typography>
              {badge}
            </Stack>
          )}
          {subtitle ? (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {capitalizeFirst(subtitle)}
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {action}
          {table ? (
            <Tooltip title={view === 'chart' ? labels.table : labels.chart}>
              <IconButton
                size="small"
                aria-label={view === 'chart' ? labels.table : labels.chart}
                onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
              >
                {view === 'chart' ? <TableRowsOutlined fontSize="small" /> : <ShowChartOutlined fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}
          {expand ? <ExpandButton label={expand.label} onClick={expand.onClick} /> : null}
        </Stack>
      </Stack>

      {legend.length >= 2 ? (
        <Stack direction="row" spacing={2} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
          {legend.map((item) => (
            <Stack key={item.key} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Box
                sx={{
                  width: item.mark === 'bar' ? 10 : 14,
                  height: item.mark === 'bar' ? 10 : 2,
                  borderRadius: item.mark === 'bar' ? 0.5 : 1,
                  backgroundColor: item.color,
                }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {item.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}

      <Box
        sx={{
          opacity: dimmed ? 0.55 : 1,
          transition: 'opacity .2s',
          ...(bare ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : null),
        }}
      >
        {view === 'table' && table ? (
          <SortableTable table={table} sort={sort} onSortChange={setSort} maxHeight={bare ? undefined : 320} fill={bare} />
        ) : (
          children
        )}
      </Box>
    </>
  )

  return bare ? (
    // A column that may shrink, so the table in it scrolls within the dialog's fixed size.
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>{body}</Box>
  ) : (
    <Card sx={{ height: '100%' }}>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

/**
 * The chart's table, sortable by any heading: figures highest first, pressed
 * again the other way round. It opens on the time column, most recent first —
 * the rows' own order — and so does an order chosen among other columns. The
 * order itself is held by the card (see ChartCard). The headings stay pinned
 * as the rows scroll, looking as the product tables' do (see TableScroll).
 */
export function SortableTable({
  table,
  sort: chosen,
  onSortChange,
  maxHeight,
  fill = false,
}: {
  table: TableView
  sort: TableSort | null
  onSortChange: (sort: TableSort) => void
  maxHeight?: number | string
  fill?: boolean
}) {
  const columns = table.columns.map((column) => (typeof column === 'string' ? { label: column } : column))
  const signature = signatureOf(columns.map((column) => column.label))
  const sort: TableSort =
    chosen && chosen.columns === signature && chosen.column < columns.length
      ? chosen
      : { column: 0, dir: 'desc', columns: signature }
  const text = (cell: TableCellValue | undefined) => (cell === undefined ? '' : typeof cell === 'string' ? cell : cell.text)
  // The time column sorts by the rows' own order (the first row is the most recent); the others by their figures.
  const valueOf = (row: TableCellValue[], index: number): number | null => {
    if (sort.column === 0) return table.rows.length - index
    const cell = row[sort.column]
    return cell !== undefined && typeof cell !== 'string' ? cell.sort : null
  }
  const rows = table.rows
    .map((row, index) => ({ row, index, value: valueOf(row, index) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1
      return (sort.dir === 'asc' ? a.value - b.value : b.value - a.value) || a.index - b.index
    })

  return (
    <TableScroll maxHeight={maxHeight} fill={fill}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((column, i) => {
              const active = sort.column === i
              const control = (
                <TableSortLabel
                  active={active}
                  direction={active ? sort.dir : 'desc'}
                  onClick={() => onSortChange({ column: i, dir: active && sort.dir === 'desc' ? 'asc' : 'desc', columns: signature })}
                >
                  <Box component="span" sx={column.tip ? HELP : undefined}>
                    {column.label}
                  </Box>
                </TableSortLabel>
              )
              return (
                <TableCell
                  key={i}
                  align={i === 0 ? 'left' : 'right'}
                  sortDirection={active ? sort.dir : false}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {column.tip ? (
                    <Tooltip title={column.tip} placement="top" describeChild>
                      {control}
                    </Tooltip>
                  ) : (
                    control
                  )}
                </TableCell>
              )
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(({ row, index }) => (
            <TableRow key={index}>
              {row.map((cell, i) => (
                <TableCell key={i} align={i === 0 ? 'left' : 'right'} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {text(cell)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  )
}
