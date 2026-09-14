'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import { ChartCard, type TableSort, type TableView } from '@/components/charts/chart-card'
import { ExpandButton } from '@/components/charts/expand-button'

/**
 * The overview's cards and the room behind them. Every card — chart, table
 * or summary — carries the same expand icon in its top corner, opening its
 * content at full size in a dialog (the whole screen on a phone), so the page
 * stays a place to glance at and nothing on it is ever cramped.
 */

type Expand = { label: string; onClick: () => void }

/** A small card: a title, the answer, a glimpse; the rest behind the expand icon. */
export function InsightCard({
  title,
  subtitle,
  headerAction,
  expand,
  badge,
  children,
}: {
  title: string
  subtitle?: string
  /** A small control beside the title (a window picker). */
  headerAction?: React.ReactNode
  expand?: Expand
  /** A small mark next to the title (a "syncing" chip). */
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">{title}</Typography>
              {badge}
            </Stack>
            {subtitle ? (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
            {headerAction}
            {expand ? <ExpandButton label={expand.label} onClick={expand.onClick} /> : null}
          </Stack>
        </Stack>
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </CardContent>
    </Card>
  )
}

/**
 * The full-size view behind a card, at one fixed size whatever it holds:
 * nearly the whole window on a desk, the whole screen on a phone. Longer
 * content scrolls inside, so switching a view or opening another card never
 * makes the dialog jump.
 */
export function DetailsDialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel: string
  children: React.ReactNode
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      fullScreen={phone}
      scroll="paper"
      // The paper's own margins leave 32px all round; its height is fixed to the room that leaves.
      slotProps={{ paper: { sx: { height: { sm: 'calc(100% - 64px)' } } } }}
    >
      <DialogTitle sx={{ pr: 7 }}>
        {title}
        <IconButton aria-label={closeLabel} onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      {/* A column, so a table inside takes the room left and scrolls under its pinned headings. */}
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column' }}>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * A chart card with the expand icon: the same chart and table again in a
 * dialog, drawn for the room there. `render(expanded)` draws the content for
 * either place; the dialog's copy is only rendered while it is open.
 *
 * The card and its dialog share one choice of chart or table and one table
 * order, so the dialog opens as the card was left — its table when the card
 * shows its table. They are held here, or by the caller when it passes them
 * (to remember them).
 */
export function ExpandableChartCard({
  title,
  subtitle,
  labels,
  table,
  expandLabel,
  closeLabel,
  badge,
  view,
  onViewChange,
  sort,
  onSortChange,
  render,
}: {
  title: string
  subtitle?: string
  labels: { chart: string; table: string }
  table?: TableView
  expandLabel: string
  closeLabel: string
  /** A small mark beside the title, in the card and in the dialog. */
  badge?: React.ReactNode
  view?: 'chart' | 'table'
  onViewChange?: (view: 'chart' | 'table') => void
  sort?: TableSort | null
  onSortChange?: (sort: TableSort) => void
  render: (expanded: boolean) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [ownView, setOwnView] = useState<'chart' | 'table'>('chart')
  const [ownSort, setOwnSort] = useState<TableSort | null>(null)
  const shared = {
    view: view ?? ownView,
    onViewChange: (next: 'chart' | 'table') => {
      setOwnView(next)
      onViewChange?.(next)
    },
    sort: sort !== undefined ? sort : ownSort,
    onSortChange: (next: TableSort) => {
      setOwnSort(next)
      onSortChange?.(next)
    },
  }
  return (
    <>
      <ChartCard
        title={title}
        subtitle={subtitle}
        labels={labels}
        table={table}
        expand={{ label: expandLabel, onClick: () => setOpen(true) }}
        badge={badge}
        {...shared}
      >
        {render(false)}
      </ChartCard>
      <DetailsDialog open={open} onClose={() => setOpen(false)} title={title} closeLabel={closeLabel}>
        <ChartCard bare title={title} subtitle={subtitle} labels={labels} table={table} badge={badge} {...shared}>
          {render(true)}
        </ChartCard>
      </DetailsDialog>
    </>
  )
}
