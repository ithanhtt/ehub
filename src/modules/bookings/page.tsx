'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Popover from '@mui/material/Popover'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import TablePagination from '@mui/material/TablePagination'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import AddOutlined from '@mui/icons-material/AddOutlined'
import AddLinkOutlined from '@mui/icons-material/AddLinkOutlined'
import BlockOutlined from '@mui/icons-material/BlockOutlined'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined'
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined'
import RestoreOutlined from '@mui/icons-material/RestoreOutlined'
import SyncOutlined from '@mui/icons-material/SyncOutlined'
import ViewColumnOutlined from '@mui/icons-material/ViewColumnOutlined'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import { EmptyState, PageHeader } from '@/components/ui/page-header'
import { usePreference } from '@/components/ui/use-preference'
import { formatCompact, formatDateTime, formatMoney, formatNumber } from '@/core/utils/format'
import { attachVideo, deleteBookings, moveBookings, resultsSyncStatus, resumeSyncedResults, setCancelled, syncResults, syncResultsWhenDue } from '@/features/bookings/actions'
import type { BookingListRow, CampaignListRow } from '@/features/bookings/queries'
import { vnDate } from '@/modules/analytics/period'
import { BookingForm, type KocSuggestion } from './booking-form'
import { BookingTable, dmy } from './booking-table'
import { CampaignForm } from './campaign-form'
import { CampaignTabs, type CampaignFilter } from './campaign-tabs'
import { BOOKING_FIELDS, EXPORT_COLUMNS, monthOf, REQUIRED_FIELDS, type BookingField } from './fields'
import { FilterBar } from './filter-bar'
import { ImportDialog } from './import-dialog'
import { KocDrawer, kocProfiles } from './koc-drawer'
import {
  acceptFilterMemory,
  acceptHidden,
  acceptSort,
  COLUMNS,
  FIXED_COLUMNS,
  filterOptions,
  matches,
  needleOf,
  NO_FILTERS,
  prepare,
  rememberFilters,
  SORT_DEFAULT,
  sortRows,
  summarise,
  type ColumnId,
  type FilterMemory,
  type ListFilters,
  type SortState,
} from './list'
import { downloadRows, downloadTemplate } from './spreadsheet'
import { attentionOf, tally } from './triage'

/** The list's quick views: everything, what needs a hand, or one status. */
type View = 'all' | 'attention' | 'pending' | 'aired' | 'cancelled'

const VIEWS: readonly View[] = ['all', 'attention', 'pending', 'aired', 'cancelled']

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

const EXAMPLES: Record<BookingField, string> = {
  campaign: 'Ra mắt serum 9.9',
  code: '',
  koc: '@linh.beauty',
  kocName: 'Linh Beauty',
  kocContact: '0912 345 678',
  kocTier: 'Micro',
  bookedOn: '10/09/2026',
  plannedAirOn: '12/09/2026',
  airedOn: '12/09/2026',
  videoUrl: 'https://www.tiktok.com/@linh.beauty/video/7412345678901234567',
  product: '1729503179457070324',
  cost: '1.500.000',
  status: 'Đã air',
  resultOrders: '',
  resultRevenue: '',
  note: '',
}

/** The list's remembered choices — the same for every project, but the filters, which are each project's own. */
const NO_HIDDEN: ColumnId[] = []
const NO_MEMORY: FilterMemory = {}

/** How often the page asks whether the results sync it is waiting on is done. */
const SYNC_POLL_MS = 4_000
/** How often the open page checks whether the results are due a sync (the server's own loop runs as often). */
const AUTO_SYNC_CHECK_MS = 5 * 60_000

/**
 * The project's booking data: the booked KOC videos, grouped in campaigns,
 * kept in one standard form. Everyone in the project reads it (the reports
 * do); bookers and up add, import, edit and delete.
 *
 * Made to be followed at a glance and worked from the list itself: the
 * campaigns are tabs; the rows shown are summed up above the list (bookings,
 * cost, aired and overdue, orders, revenue, ROI); what needs a hand (bookings
 * overdue or late to air, aired ones without their video) is a view of its
 * own; the list filters by month, air state, KOC tier and booking dates and
 * searches everything a booking is known by, and sorts by any column — all of
 * it remembered in this browser; a pending booking takes its video link right
 * in its row; and selecting rows turns the filters into the actions for them.
 *
 * The orders and revenue each video brought in are synced from TikTok Shop
 * (features/bookings/sync.ts): opening the page starts a sync when the last
 * is old, without waiting on it — the page says so, and refreshes when done.
 */
export function BookingsPage({
  projectId,
  rows,
  campaigns,
  canEdit,
  sync,
}: {
  projectId: string
  rows: BookingListRow[]
  campaigns: CampaignListRow[]
  canEdit: boolean
  /** The project has a TikTok Shop connection to sync results from; a sync is running as the page opens. */
  sync: { enabled: boolean; running: boolean }
}) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  const router = useRouter()
  const theme = useTheme()
  const cards = useMediaQuery(theme.breakpoints.down('sm'))
  const today = vnDate(new Date())

  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>('all')
  const [view, setView] = useState<View>('all')
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(50)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(false)
  /** A KOC booked again from their profile: the form starts with them. */
  const [presetKoc, setPresetKoc] = useState<string | null>(null)
  /** The KOC whose profile is open beside the list. */
  const [kocOpen, setKocOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<BookingListRow | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<CampaignListRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [pageMenu, setPageMenu] = useState<HTMLElement | null>(null)
  const [moveMenu, setMoveMenu] = useState<HTMLElement | null>(null)
  const [columnMenu, setColumnMenu] = useState<HTMLElement | null>(null)
  const [rowMenu, setRowMenu] = useState<{ anchor: HTMLElement; row: BookingListRow } | null>(null)
  const [linking, setLinking] = useState<{ anchor: HTMLElement; row: BookingListRow } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()
  const [syncing, setSyncing] = useState(sync.running)

  /* ------------------------------------------------ remembered choices --- */

  const [sort, setSort] = usePreference<SortState>('adshub.bookings.sort', SORT_DEFAULT, acceptSort)
  const [hidden, setHidden] = usePreference<ColumnId[]>('adshub.bookings.hidden', NO_HIDDEN, acceptHidden)
  const [memory, setMemory] = usePreference<FilterMemory>('adshub.bookings.filters', NO_MEMORY, acceptFilterMemory)
  const filters = memory[projectId] ?? NO_FILTERS
  const setFilters = useCallback(
    (next: ListFilters) => {
      setMemory((current) => rememberFilters(current, projectId, next))
      setPage(0)
    },
    [setMemory, projectId],
  )
  // The search box answers at once; it is remembered a moment after typing stops.
  const [query, setQuery] = useState(filters.q)
  useEffect(() => {
    if (query === filters.q) return
    const timer = setTimeout(() => setFilters({ ...filters, q: query }), 400)
    return () => clearTimeout(timer)
  }, [query, filters, setFilters])
  const searched = useDeferredValue(query)
  const columns = useMemo(() => COLUMNS.filter((column) => !hidden.includes(column)), [hidden])

  /* ------------------------------------------------------ what is known --- */

  const campaignName = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name])), [campaigns])
  // A tab left on a campaign that was just deleted falls back to all.
  const activeFilter: CampaignFilter = campaignFilter === 'all' || campaignFilter === 'none' || campaignName.has(campaignFilter) ? campaignFilter : 'all'
  const current = campaigns.find((c) => c.id === activeFilter) ?? null

  const counts = useMemo(() => {
    const out = new Map<string | null, number>()
    for (const row of rows) if (row.status !== 'cancelled') out.set(row.campaignId, (out.get(row.campaignId) ?? 0) + 1)
    for (const campaign of campaigns) if (!out.has(campaign.id)) out.set(campaign.id, 0)
    return out
  }, [rows, campaigns])

  // Every row's derived fields (air state, month, search text), worked out once per change of the rows.
  const prepared = useMemo(() => prepare(rows, today, campaignName), [rows, today, campaignName])
  const scoped = useMemo(
    () => prepared.filter(({ row }) => activeFilter === 'all' || (activeFilter === 'none' ? !row.campaignId : row.campaignId === activeFilter)),
    [prepared, activeFilter],
  )
  const figures = useMemo(() => tally(scoped.map((item) => item.row), today), [scoped, today])
  const options = useMemo(() => filterOptions(scoped), [scoped])

  // Rows come newest booking first, so a KOC's first row carries their last fee and tier.
  const profiles = useMemo(() => kocProfiles(rows), [rows])
  const kocs: KocSuggestion[] = useMemo(() => {
    const byHandle = new Map<string, KocSuggestion>()
    for (const row of rows) {
      const own = byHandle.get(row.kocHandle) ?? { handle: row.kocHandle, name: '', contact: '', tier: '', lastCost: null, lastOn: null }
      own.name ||= row.kocName ?? ''
      own.contact ||= row.kocContact ?? ''
      own.tier ||= row.kocTier ?? ''
      if (own.lastCost === null && row.status !== 'cancelled') {
        own.lastCost = row.cost
        own.lastOn = row.bookedOn
      }
      byHandle.set(row.kocHandle, own)
    }
    return [...byHandle.values()]
  }, [rows])
  const products = useMemo(
    () => [...new Set([...campaigns.map((c) => c.product), ...rows.map((row) => row.product)].filter((p): p is string => Boolean(p)))],
    [rows, campaigns],
  )

  const viewCount: Record<View, number> = {
    all: scoped.length - figures.cancelled,
    attention: figures.attention,
    pending: figures.pending,
    aired: figures.aired,
    cancelled: figures.cancelled,
  }

  const filtered = useMemo(() => {
    const needle = needleOf(searched)
    const wanted = { ...filters, q: searched }
    const matching = scoped.filter((item) => {
      const { row } = item
      const inView =
        view === 'all'
          ? row.status !== 'cancelled' || filters.air.includes('cancelled')
          : view === 'attention'
            ? attentionOf(row, today) !== null
            : row.status === view
      return inView && matches(item, wanted, needle)
    })
    return sortRows(matching, sort)
  }, [scoped, view, searched, filters, today, sort])
  const shownFigures = useMemo(() => summarise(filtered), [filtered])
  const lastPage = Math.max(0, Math.ceil(filtered.length / perPage) - 1)
  const shown = useMemo(() => filtered.slice(Math.min(page, lastPage) * perPage, Math.min(page, lastPage) * perPage + perPage), [filtered, page, lastPage, perPage])
  const lastSynced = useMemo(() => rows.reduce<string | null>((latest, row) => (row.resultSyncedAt && (!latest || row.resultSyncedAt > latest) ? row.resultSyncedAt : latest), null), [rows])

  /* ------------------------------------------------------------ doing --- */

  const refresh = useCallback(
    (message: string) => {
      setToast(message)
      router.refresh()
    },
    [router],
  )
  const run = (action: () => Promise<{ ok: boolean; message?: string }>, done: string, after?: () => void) =>
    startBusy(async () => {
      const result = await action()
      if (!result.ok) {
        setError(t(`actionErrors.${result.message ?? 'server'}`))
        return
      }
      after?.()
      refresh(done)
    })

  const openForm = useCallback((row: BookingListRow | null, koc: string | null = null) => {
    setEditing(row)
    setPresetKoc(koc)
    setFormOpen(true)
  }, [])
  const openCampaign = (campaign: CampaignListRow | null) => {
    setEditingCampaign(campaign)
    setCampaignOpen(true)
  }

  // "N" adds a booking, from anywhere on the page but a text box or a dialog.
  useEffect(() => {
    if (!canEdit) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key.toLowerCase() !== 'n' || event.ctrlKey || event.metaKey || event.altKey) return
      if (target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return
      event.preventDefault()
      setEditing(null)
      setPresetKoc(null)
      setFormOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEdit])

  // While the page is open, the results keep themselves current: every few minutes, and on coming back to the
  // tab, a sync when one is due — followed below until done, the list then reloading with the new figures.
  useEffect(() => {
    if (!sync.enabled) return
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      const state = await syncResultsWhenDue(projectId).catch(() => null)
      if (state?.running) setSyncing(true)
    }
    const timer = setInterval(check, AUTO_SYNC_CHECK_MS)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sync.enabled, projectId])

  // A sync the server started (on opening the page, or asked for): followed until it is done, then the list reloads.
  useEffect(() => {
    if (sync.running) setSyncing(true)
  }, [sync.running])
  useEffect(() => {
    if (!syncing) return
    let stopped = false
    const timer = setInterval(async () => {
      const state = await resultsSyncStatus(projectId).catch(() => undefined)
      if (stopped || state === undefined || state?.running) return
      stopped = true
      clearInterval(timer)
      setSyncing(false)
      if (state?.last?.reason === 'failed') setError(t('sync.failed'))
      else if (state?.last && state.last.updated > 0) setToast(t('sync.done', { count: state.last.updated }))
      router.refresh()
    }, SYNC_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [syncing, projectId, router, t])

  const startSync = () =>
    startBusy(async () => {
      const result = await syncResults(projectId)
      if (!result.ok) setError(t(`actionErrors.${result.message ?? 'server'}`))
      else setSyncing(true)
    })

  const chosen = [...selected]
  const chosenRows = rows.filter((row) => selected.has(row.id))
  const clearSelection = () => setSelected(new Set())
  const allShownSelected = shown.length > 0 && shown.every(({ row }) => selected.has(row.id))
  const toggle = useCallback(
    (id: string) =>
      setSelected((currentSet) => {
        const next = new Set(currentSet)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [],
  )
  const toggleShown = () =>
    setSelected((currentSet) => {
      const next = new Set(currentSet)
      for (const { row } of shown) {
        if (allShownSelected) next.delete(row.id)
        else next.add(row.id)
      }
      return next
    })
  const onSort = useCallback(
    (column: ColumnId) => setSort((currentSort) => (currentSort.column === column ? { column, desc: !currentSort.desc } : { column, desc: column === 'bookedOn' || column === 'cost' || column === 'orders' || column === 'revenue' })),
    [setSort],
  )
  const onKoc = useCallback((handle: string) => setKocOpen(handle), [])
  const onRowMenu = useCallback((anchor: HTMLElement, row: BookingListRow) => setRowMenu({ anchor, row }), [])
  const onLink = useCallback((anchor: HTMLElement, row: BookingListRow) => setLinking({ anchor, row }), [])
  const onOpen = useCallback((row: BookingListRow) => openForm(row), [openForm])

  const template = () =>
    void downloadTemplate(
      BOOKING_FIELDS.map((field) => ({ field, required: REQUIRED_FIELDS.has(field), description: t(`guide.${field}`), example: EXAMPLES[field] })),
      { sheet: 'Booking', guide: t('guide.sheet'), field: t('guide.field'), required: t('guide.required'), description: t('guide.description'), example: t('guide.example'), yes: t('guide.yes') },
    )

  /** The rows shown — filtered and sorted as on screen — with every column, derived ones included. */
  const exportRows = () =>
    void downloadRows(
      filtered.map(({ row, standing }) => ({
        code: row.code,
        campaign: campaignName.get(row.campaignId ?? '') ?? '',
        koc: row.kocHandle,
        kocName: row.kocName ?? '',
        kocContact: row.kocContact ?? '',
        kocTier: row.kocTier ?? '',
        bookedOn: dmy(row.bookedOn),
        month: monthOf(row.bookedOn),
        plannedAirOn: dmy(row.plannedAirOn),
        airedOn: dmy(row.airedOn),
        airStanding: t(`air.${standing.state}`, { days: standing.days }),
        videoUrl: row.videoUrl ?? '',
        product: row.product ?? '',
        cost: row.cost,
        status: t(`status.${row.status}`),
        resultOrders: row.resultOrders ?? '',
        resultRevenue: row.resultRevenue ?? '',
        note: row.note ?? '',
      })),
      `booking-${today}.xlsx`,
      'Booking',
      [],
      EXPORT_COLUMNS,
    )

  /* ------------------------------------------------------------ parts --- */

  const money = (n: number) => formatCompact(n, locale)
  const progress = (value: number, target: number, overIsBad = false) => {
    const ratio = target > 0 ? value / target : 0
    return (
      <LinearProgress
        variant="determinate"
        value={Math.min(100, ratio * 100)}
        color={overIsBad && ratio > 1 ? 'error' : ratio >= 1 ? 'success' : 'primary'}
        sx={{ height: 4, borderRadius: 2, width: 72 }}
      />
    )
  }

  /** The chosen campaign in one line: its dates, and how far along its targets it is. */
  const campaignLine = current ? (
    <Stack direction="row" spacing={2.5} divider={<Divider orientation="vertical" flexItem />} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {current.endOn ? `${dm(current.startOn)} – ${dm(current.endOn)}` : t('campaign.since', { date: dm(current.startOn) })}
          {current.status === 'ended' ? ` · ${t('campaign.status.ended')}` : ''}
        </Typography>
        {canEdit ? (
          <IconButton size="small" aria-label={t('campaign.editTitle')} onClick={() => openCampaign(current)}>
            <EditOutlined sx={{ fontSize: 16 }} />
          </IconButton>
        ) : null}
      </Stack>
      {current.targetVideos ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">
            <b>{figures.aired}</b>/{current.targetVideos} {t('summary.aired')}
          </Typography>
          {progress(figures.aired, current.targetVideos)}
        </Stack>
      ) : null}
      {current.budget ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: figures.spent > current.budget ? 'error.main' : undefined }}>
            <b>{money(figures.spent)}</b>/{money(current.budget)} {t('summary.spent')}
          </Typography>
          {progress(figures.spent, current.budget, true)}
        </Stack>
      ) : null}
    </Stack>
  ) : null

  /** The rows shown, summed up: small boxes, each one figure. */
  const stats = [
    { key: 'bookings', label: t('summary.count'), value: formatNumber(shownFigures.bookings, locale) },
    { key: 'cost', label: t('summary.cost'), value: money(shownFigures.cost), tip: formatMoney(shownFigures.cost, locale) },
    { key: 'aired', label: t('summary.airedOverdue'), value: `${formatNumber(shownFigures.aired, locale)} / ${formatNumber(shownFigures.overdue, locale)}`, warn: shownFigures.overdue > 0 },
    { key: 'orders', label: t('summary.orders'), value: formatNumber(shownFigures.orders, locale) },
    { key: 'revenue', label: t('summary.revenue'), value: money(shownFigures.revenue), tip: formatMoney(shownFigures.revenue, locale) },
    { key: 'roi', label: t('summary.roi'), value: shownFigures.roi === null ? '—' : `${formatNumber(shownFigures.roi, locale, 2)}×` },
  ]
  const statStrip = (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {stats.map((stat) => (
        <Box key={stat.key} title={stat.tip} sx={{ px: 1.5, py: 0.75, borderRadius: 1, bgcolor: 'action.hover', minWidth: 104 }}>
          <Typography variant="caption" component="div" sx={{ color: 'text.secondary', lineHeight: 1.4 }} noWrap>
            {stat.label}
          </Typography>
          <Typography variant="subtitle1" component="div" sx={{ fontWeight: 700, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', color: stat.warn ? 'warning.main' : undefined }}>
            {stat.value}
          </Typography>
        </Box>
      ))}
      {sync.enabled ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', alignSelf: 'flex-end', ml: 0.5 }}>
          {syncing ? t('sync.running') : lastSynced ? t('sync.last', { time: formatDateTime(lastSynced, locale) }) : t('sync.never')}
        </Typography>
      ) : null}
    </Stack>
  )

  const viewLabel = (value: View) => (value === 'all' ? t('status.all') : value === 'attention' ? t('view.attention') : t(`status.${value}`))

  const views = VIEWS.filter((value) => value === 'all' || viewCount[value] > 0 || view === value).map((value) => (
    <Chip
      key={value}
      icon={value === 'attention' ? <WarningAmberOutlined sx={{ fontSize: 16 }} /> : undefined}
      label={`${viewLabel(value)} ${viewCount[value]}`}
      color={value === 'attention' ? 'warning' : view === value ? 'primary' : 'default'}
      variant={view === value ? 'filled' : 'outlined'}
      onClick={() => {
        setView(value)
        setPage(0)
      }}
    />
  ))

  const columnsButton = (
    <Button size="small" color="inherit" startIcon={<ViewColumnOutlined />} onClick={(event) => setColumnMenu(event.currentTarget)} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
      {t('columns.button')}
    </Button>
  )

  const filters_ = (
    <FilterBar
      filters={filters}
      onChange={setFilters}
      query={query}
      onQuery={(q) => {
        setQuery(q)
        setPage(0)
      }}
      options={options}
      views={views}
      columnsButton={columnsButton}
    />
  )

  /** Selecting rows turns the filters into what can be done with them. */
  const bulk = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, minHeight: 40 }}>
      <IconButton size="small" aria-label={t('clearSelection')} onClick={clearSelection}>
        <CloseOutlined fontSize="small" />
      </IconButton>
      <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>
        {t('selected', { count: selected.size })}
      </Typography>
      {campaigns.length > 0 ? (
        <Button size="small" startIcon={<DriveFileMoveOutlined />} onClick={(event) => setMoveMenu(event.currentTarget)} disabled={busy}>
          {t('moveTo', { count: selected.size })}
        </Button>
      ) : null}
      {chosenRows.some((row) => row.status !== 'cancelled') ? (
        <Button size="small" startIcon={<BlockOutlined />} onClick={() => run(() => setCancelled(projectId, chosen, true), t('cancelledDone', { count: chosen.length }), clearSelection)} disabled={busy}>
          {t('cancelBooking')}
        </Button>
      ) : null}
      {chosenRows.some((row) => row.status === 'cancelled') ? (
        <Button size="small" startIcon={<RestoreOutlined />} onClick={() => run(() => setCancelled(projectId, chosen, false), t('restoredDone', { count: chosen.length }), clearSelection)} disabled={busy}>
          {t('restore')}
        </Button>
      ) : null}
      <Button size="small" color="error" startIcon={<DeleteOutlineOutlined />} onClick={() => setConfirmDelete(chosen)} disabled={busy}>
        {t('delete')}
      </Button>
    </Stack>
  )

  const syncControl = sync.enabled ? (
    syncing ? (
      <Chip icon={<CircularProgress size={14} />} label={t('sync.running')} variant="outlined" />
    ) : canEdit ? (
      <Tooltip title={t('sync.help')}>
        <Button variant="outlined" startIcon={<SyncOutlined />} onClick={startSync} disabled={busy}>
          <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
            {t('sync.button')}
          </Box>
        </Button>
      </Tooltip>
    ) : null
  ) : null

  /* ---------------------------------------------------------- the page --- */

  return (
    <>
      <PageHeader
        title={t('title')}
        description={canEdit ? t('description') : `${t('description')} ${t('readOnly')}`}
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {syncControl}
            {canEdit ? (
              <Tooltip title={t('addShortcut')}>
                <Button variant="contained" startIcon={<AddOutlined />} onClick={() => openForm(null)}>
                  {t('add')}
                </Button>
              </Tooltip>
            ) : null}
            <IconButton aria-label={t('moreActions')} onClick={(event) => setPageMenu(event.currentTarget)}>
              <MoreHorizOutlined />
            </IconButton>
          </Stack>
        }
      />
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {rows.length === 0 && campaigns.length === 0 ? (
        <EmptyState
          icon={<DescriptionOutlined sx={{ fontSize: 32 }} />}
          title={t('emptyTitle')}
          description={canEdit ? t('emptyHint') : t('emptyReadOnly')}
          action={
            canEdit ? (
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, justifyContent: 'center' }}>
                <Button variant="contained" startIcon={<AddOutlined />} onClick={() => openForm(null)}>
                  {t('add')}
                </Button>
                <Button variant="outlined" startIcon={<FileUploadOutlined />} onClick={() => setImportOpen(true)}>
                  {t('importButton')}
                </Button>
              </Stack>
            ) : undefined
          }
        />
      ) : (
        <Card variant="outlined">
          <Box sx={{ px: 2, pt: 1 }}>
            <CampaignTabs
              campaigns={campaigns}
              counts={counts}
              value={activeFilter}
              canEdit={canEdit}
              onChange={(next) => {
                setCampaignFilter(next)
                clearSelection()
                setPage(0)
              }}
              onAdd={() => openCampaign(null)}
            />
          </Box>
          <Stack spacing={1.5} sx={{ px: 2, py: 1.5 }}>
            {campaignLine}
            {statStrip}
            {selected.size > 0 ? bulk : filters_}
          </Stack>
          <Divider />
          <BookingTable
            items={shown}
            columns={columns}
            sort={sort}
            onSort={onSort}
            canEdit={canEdit}
            selected={selected}
            allSelected={allShownSelected}
            someSelected={shown.some(({ row }) => selected.has(row.id))}
            onToggleAll={toggleShown}
            cards={cards}
            maxHeight="calc(100vh - 300px)"
            onOpen={onOpen}
            onKoc={onKoc}
            onRowMenu={onRowMenu}
            onLink={onLink}
            onToggle={toggle}
          />
          {filtered.length === 0 ? (
            <Typography variant="body2" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
              {view === 'attention' ? t('nothingToDo') : t('noMatch')}
            </Typography>
          ) : null}
          {filtered.length > 25 ? (
            <TablePagination
              component="div"
              count={filtered.length}
              page={Math.min(page, lastPage)}
              onPageChange={(_event, next) => setPage(next)}
              rowsPerPage={perPage}
              rowsPerPageOptions={[25, 50, 100, 200]}
              onRowsPerPageChange={(event) => {
                setPerPage(Number(event.target.value))
                setPage(0)
              }}
              labelRowsPerPage={t('perPage')}
            />
          ) : null}
        </Card>
      )}

      {/* The page's less frequent actions. */}
      <Menu anchorEl={pageMenu} open={Boolean(pageMenu)} onClose={() => setPageMenu(null)}>
        {canEdit ? (
          <MenuItem
            onClick={() => {
              setPageMenu(null)
              setImportOpen(true)
            }}
          >
            <ListItemIcon>
              <FileUploadOutlined fontSize="small" />
            </ListItemIcon>
            {t('importButton')}
          </MenuItem>
        ) : null}
        <MenuItem
          disabled={filtered.length === 0}
          onClick={() => {
            setPageMenu(null)
            exportRows()
          }}
        >
          <ListItemIcon>
            <FileDownloadOutlined fontSize="small" />
          </ListItemIcon>
          {t('exportShown', { count: filtered.length })}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setPageMenu(null)
            template()
          }}
        >
          <ListItemIcon>
            <DescriptionOutlined fontSize="small" />
          </ListItemIcon>
          {t('template')}
        </MenuItem>
        {sync.enabled && canEdit ? (
          <MenuItem
            disabled={syncing || busy}
            onClick={() => {
              setPageMenu(null)
              startSync()
            }}
          >
            <ListItemIcon>
              <SyncOutlined fontSize="small" />
            </ListItemIcon>
            {t('sync.button')}
          </MenuItem>
        ) : null}
      </Menu>

      {/* Which columns the list shows. */}
      <Menu anchorEl={columnMenu} open={Boolean(columnMenu)} onClose={() => setColumnMenu(null)}>
        {COLUMNS.map((column) => (
          <MenuItem
            key={column}
            dense
            disabled={FIXED_COLUMNS.has(column)}
            onClick={() => setHidden((currentHidden) => (currentHidden.includes(column) ? currentHidden.filter((c) => c !== column) : [...currentHidden, column]))}
          >
            <Checkbox size="small" checked={!hidden.includes(column)} sx={{ p: 0.5, mr: 1 }} />
            <ListItemText primary={t(`column.${column}`)} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem dense disabled={hidden.length === 0} onClick={() => setHidden([])}>
          <ListItemText primary={t('columns.showAll')} />
        </MenuItem>
      </Menu>

      {/* One row's actions. */}
      <Menu anchorEl={rowMenu?.anchor} open={Boolean(rowMenu)} onClose={() => setRowMenu(null)}>
        {rowMenu
          ? [
              <MenuItem
                key="edit"
                onClick={() => {
                  openForm(rowMenu.row)
                  setRowMenu(null)
                }}
              >
                <ListItemIcon>
                  <EditOutlined fontSize="small" />
                </ListItemIcon>
                {t('edit')}
              </MenuItem>,
              rowMenu.row.status !== 'cancelled' && !rowMenu.row.videoId ? (
                <MenuItem
                  key="link"
                  onClick={() => {
                    setLinking(rowMenu)
                    setRowMenu(null)
                  }}
                >
                  <ListItemIcon>
                    <AddLinkOutlined fontSize="small" />
                  </ListItemIcon>
                  {t('addLink')}
                </MenuItem>
              ) : null,
              rowMenu.row.resultSource === 'manual' ? (
                <MenuItem
                  key="results"
                  onClick={() => {
                    const { id } = rowMenu.row
                    setRowMenu(null)
                    run(() => resumeSyncedResults(projectId, [id]), t('result.resumed'), () => {
                      if (sync.enabled) setSyncing(true)
                    })
                  }}
                >
                  <ListItemIcon>
                    <SyncOutlined fontSize="small" />
                  </ListItemIcon>
                  {t('result.useTiktok')}
                </MenuItem>
              ) : null,
              <MenuItem
                key="cancel"
                onClick={() => {
                  const { id, status } = rowMenu.row
                  setRowMenu(null)
                  run(() => setCancelled(projectId, [id], status !== 'cancelled'), status === 'cancelled' ? t('restoredDone', { count: 1 }) : t('cancelledDone', { count: 1 }))
                }}
              >
                <ListItemIcon>{rowMenu.row.status === 'cancelled' ? <RestoreOutlined fontSize="small" /> : <BlockOutlined fontSize="small" />}</ListItemIcon>
                {rowMenu.row.status === 'cancelled' ? t('restore') : t('cancelBooking')}
              </MenuItem>,
              <Divider key="divider" />,
              <MenuItem
                key="delete"
                onClick={() => {
                  setConfirmDelete([rowMenu.row.id])
                  setRowMenu(null)
                }}
                sx={{ color: 'error.main' }}
              >
                <ListItemIcon>
                  <DeleteOutlineOutlined fontSize="small" color="error" />
                </ListItemIcon>
                {t('delete')}
              </MenuItem>,
            ]
          : null}
      </Menu>

      {/* Moving the selection into a campaign. */}
      <Menu anchorEl={moveMenu} open={Boolean(moveMenu)} onClose={() => setMoveMenu(null)}>
        {campaigns.map((campaign) => (
          <MenuItem
            key={campaign.id}
            onClick={() => {
              setMoveMenu(null)
              run(() => moveBookings(projectId, chosen, campaign.id), t('moved', { count: chosen.length }), clearSelection)
            }}
          >
            {campaign.name}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            setMoveMenu(null)
            run(() => moveBookings(projectId, chosen, null), t('moved', { count: chosen.length }), clearSelection)
          }}
        >
          <em>{t('noCampaign')}</em>
        </MenuItem>
      </Menu>

      {canEdit ? (
        <>
          <VideoLinkPopover
            projectId={projectId}
            target={linking}
            onClose={() => setLinking(null)}
            onSaved={() => {
              setLinking(null)
              refresh(t('linkAdded'))
            }}
          />
          <BookingForm
            projectId={projectId}
            open={formOpen}
            editing={editing}
            campaigns={campaigns}
            defaultCampaignId={current?.id ?? null}
            presetKoc={presetKoc}
            kocs={kocs}
            products={products}
            onClose={() => setFormOpen(false)}
            onSaved={refresh}
          />
          <ImportDialog
            projectId={projectId}
            open={importOpen}
            campaigns={campaigns}
            defaultCampaignId={current?.id ?? null}
            onClose={() => setImportOpen(false)}
            onImported={refresh}
            onTemplate={template}
          />
          <CampaignForm
            projectId={projectId}
            open={campaignOpen}
            editing={editingCampaign}
            products={products}
            bookingCount={editingCampaign ? rows.filter((row) => row.campaignId === editingCampaign.id).length : 0}
            onClose={() => setCampaignOpen(false)}
            onSaved={(message, campaignId) => {
              if (campaignId) setCampaignFilter(campaignId)
              refresh(message)
            }}
          />
          <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
            <DialogTitle>{t('deleteTitle', { count: confirmDelete?.length ?? 0 })}</DialogTitle>
            <DialogContent>
              <Typography variant="body2">{t('deleteBody')}</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmDelete(null)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button
                color="error"
                variant="contained"
                disabled={busy}
                onClick={() => {
                  const ids = confirmDelete ?? []
                  setConfirmDelete(null)
                  run(() => deleteBookings(projectId, ids), t('deleted', { count: ids.length }), () =>
                    setSelected((currentSet) => new Set([...currentSet].filter((id) => !ids.includes(id)))),
                  )
                }}
              >
                {t('delete')}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      ) : null}
      <KocDrawer
        projectId={projectId}
        profile={kocOpen ? (profiles.get(kocOpen) ?? null) : null}
        campaignName={campaignName}
        canEdit={canEdit}
        onClose={() => setKocOpen(null)}
        onEditBooking={(row) => openForm(row)}
        onBookAgain={(handle) => openForm(null, handle)}
        onSaved={refresh}
      />
      <Snackbar open={toast !== null} autoHideDuration={3500} onClose={() => setToast(null)} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  )
}

/**
 * Pasting the video a booked KOC posted, right from its row. A pasted link is
 * saved as soon as it reads as a video; the booking becomes aired on the day
 * the video went up.
 */
function VideoLinkPopover({
  projectId,
  target,
  onClose,
  onSaved,
}: {
  projectId: string
  target: { anchor: HTMLElement; row: BookingListRow } | null
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('bookings')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    setValue('')
    setError(null)
  }, [target])

  function save(link: string) {
    if (!target || !link.trim()) return
    startTransition(async () => {
      const result = await attachVideo(projectId, target.row.id, link)
      if (!result.ok) {
        setError(
          result.message === 'kocMismatch'
            ? t('linkOtherKoc', { koc: result.videoKoc ?? '', booked: target.row.kocHandle })
            : t(`actionErrors.${result.message ?? 'server'}`),
        )
        return
      }
      onSaved()
    })
  }

  return (
    <Popover
      open={Boolean(target)}
      anchorEl={target?.anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { p: 2, width: 380, maxWidth: 'calc(100vw - 32px)' } } }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('addLinkTitle', { koc: target?.row.kocHandle ?? '' })}
      </Typography>
      <TextField
        fullWidth
        size="small"
        autoFocus
        placeholder="https://www.tiktok.com/@…/video/74…"
        value={value}
        disabled={pending}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onPaste={(event) => {
          // A pasted link that reads as a video saves at once: paste and done.
          const pasted = event.clipboardData.getData('text').trim()
          if (/\/video\/\d{10,}|^\d{15,20}$/.test(pasted)) {
            event.preventDefault()
            setValue(pasted)
            save(pasted)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save(value)
        }}
        error={Boolean(error)}
        helperText={error ?? t('addLinkHelp')}
      />
    </Popover>
  )
}
