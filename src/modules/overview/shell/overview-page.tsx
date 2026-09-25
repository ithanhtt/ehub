'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import PowerOutlined from '@mui/icons-material/PowerOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import TuneOutlined from '@mui/icons-material/TuneOutlined'
import { AppLink } from '@/components/ui/app-link'
import { EmptyState } from '@/components/ui/page-header'
import { useHydrated, usePreference } from '@/components/ui/use-preference'
import { OverviewProvider, type OverviewContextValue } from '../context'
import { customRangeProblem, type CustomRange } from '../data/period'
import { DASHBOARD_RANGES, type DashboardData, type DashboardRange } from '../data/types'
import { OVERVIEW_SOURCES } from '../sources'
import type { WidgetBand } from '../types'
import { OVERVIEW_WIDGETS } from '../widgets'
import { fillBand } from './band-layout'
import { CustomRangePopover } from './custom-range'
import { DashboardSourcesDialog } from './sources-dialog'
import { SourceLine, StatusBadge } from './status-badge'
import { WidgetBoundary } from './widget-boundary'

/**
 * The overview page's frame, live.
 *
 * On top, the one filter row — the period — which scopes every figure below
 * it, the source picker, and the "live" badge that says how fresh the numbers
 * are and, behind it, each source's state. Below, the widgets (see
 * widgets/index.ts), band by band: notices, the headline numbers, the trends,
 * then the smaller cards. The frame knows nothing of what a widget shows: it
 * places the ones whose sources are connected, hands them the period's answer
 * through the page's context, and keeps a failing one from taking the rest
 * down (WidgetBoundary).
 *
 * The page asks for fresh numbers every fifteen seconds while the tab is
 * visible; numbers count up and marks ease to their new values. Nothing is
 * extrapolated between updates — every figure is one the server confirmed.
 */

/**
 * How often the page asks for fresh numbers. The server decides how often it
 * actually goes to each provider (see data/), so a short interval here costs
 * one cheap read, and new orders show within seconds.
 */
const LIVE_MS = 15_000
/** …and while Sapo days are still coming in, so the progress moves as they land. */
const SYNCING_MS = 4_000
/** How long a load may take before the page gives up on it and says so. */
const LOAD_TIMEOUT_MS = 90_000

/** Past this, the "live" badge stops pulsing: something is holding the updates up. */
const STALE_MS = 60_000

/** The bands, top to bottom, and the gap between the widgets in each. */
const BANDS: ReadonlyArray<{ band: WidgetBand; spacing: number }> = [
  { band: 'notice', spacing: 2 },
  // Each source's numbers a section of its own, with air between them.
  { band: 'headline', spacing: 3.5 },
  { band: 'trend', spacing: 2.5 },
  { band: 'ads', spacing: 2.5 },
  { band: 'insight', spacing: 2.5 },
]

/*
 * The period is remembered in this browser (see usePreference), so a reload
 * or a later visit opens as the viewer left it — with the dates of the last
 * custom range. Each widget remembers its own choices the same way.
 */
type PeriodChoice = { range: DashboardRange; custom: CustomRange | null }
const PERIOD_DEFAULT: PeriodChoice = { range: 'today', custom: null }

function acceptPeriod(value: unknown): PeriodChoice | null {
  if (!value || typeof value !== 'object') return null
  const { range, custom } = value as Record<string, unknown>
  const dates = custom && typeof custom === 'object' ? (custom as Record<string, unknown>) : null
  // Saved dates can age out of what the page offers (it reaches back about six months).
  const kept =
    dates && typeof dates.from === 'string' && typeof dates.to === 'string' && !customRangeProblem({ from: dates.from, to: dates.to })
      ? { from: dates.from, to: dates.to }
      : null
  if (range === 'custom') return kept ? { range, custom: kept } : PERIOD_DEFAULT
  return (DASHBOARD_RANGES as readonly unknown[]).includes(range) ? { range: range as DashboardRange, custom: kept } : null
}

export function OverviewDashboard({
  projectId,
  connected,
  hidden,
  canConfigure,
}: {
  projectId: string
  /** The connector plugins the project has usable connections for. */
  connected: string[]
  /** Of those, the ones the project has left off its overview (the sources dialog brings them back). */
  hidden: string[]
  /** May change which shops and channels the dashboard counts. */
  canConfigure: boolean
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const [period, setPeriod] = usePreference<PeriodChoice>('adshub.dashboard.period', PERIOD_DEFAULT, acceptPeriod)
  const { range, custom } = period
  const setRange = (next: DashboardRange) => setPeriod((current) => ({ ...current, range: next }))
  // Where the custom range's picker is anchored while open.
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  // The query `data` answers, so a change of period is told apart from a refresh.
  const [dataQuery, setDataQuery] = useState<string | null>(null)
  const dataQueryRef = useRef<string | null>(null)
  dataQueryRef.current = dataQuery
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  // Refreshes failed in a row: the first is let pass quietly while there are figures on screen.
  const failedInRow = useRef(0)
  const query = range === 'custom' && custom ? `custom&from=${custom.from}&to=${custom.to}` : range

  /*
   * The request out now: a timed refresh never stacks a second one on it.
   * Nothing is ever cancelled (no AbortController): a reply that is no longer
   * wanted — a newer question was asked — is simply not used (`latest`), and
   * a reply too slow is no longer waited for. Cancelling bought nothing (the
   * server finishes the read anyway, and keeps it for the next ask), while an
   * aborted fetch surfaces as an uncaught AbortError through browser
   * extensions that wrap fetch.
   */
  const inFlight = useRef<{ q: string } | null>(null)

  const load = useCallback(
    async (q: string, { poll = false }: { poll?: boolean } = {}) => {
      if (poll && inFlight.current?.q === q) return
      const own = { q }
      inFlight.current = own
      // A reply that never comes must not leave the page loading for good: past the limit it is given up on.
      let timedOut = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(new Error('timeout'))
        }, LOAD_TIMEOUT_MS)
      })
      const id = ++latest.current
      setLoading(true)
      try {
        const reply = (async () => {
          const response = await fetch(`/api/projects/${projectId}/dashboard?range=${q}`, { cache: 'no-store' })
          if (!response.ok) throw new Error(response.status === 403 ? t('forbidden') : `HTTP ${response.status}`)
          return (await response.json()) as DashboardData
        })()
        // A reply that lands after the deadline is dropped quietly.
        reply.catch(() => {})
        const next = await Promise.race([reply, deadline])
        if (id === latest.current) {
          setData(next)
          setDataQuery(q)
          setError(null)
          failedInRow.current = 0
        }
      } catch (reason) {
        if (id === latest.current) {
          failedInRow.current += 1
          // A timed refresh of the figures already shown may fail once without a word; the next one tries again.
          const quiet = poll && failedInRow.current < 2 && dataQueryRef.current === q
          if (!quiet) setError(timedOut ? t('loadTimeout') : reason instanceof Error ? reason.message : String(reason))
        }
      } finally {
        clearTimeout(timer)
        if (inFlight.current === own) inFlight.current = null
        if (id === latest.current) setLoading(false)
      }
    },
    [projectId, t],
  )

  // The saved period is known only once hydrated: the first load waits for it
  // rather than fetching the default period first.
  const hydrated = useHydrated()
  useEffect(() => {
    if (hydrated) void load(query)
  }, [load, query, hydrated])

  // Live updates while the tab is visible; coming back to it fetches at once
  // instead of showing numbers that went stale in the background.
  const sync = data?.sapo?.sync
  const syncing =
    Boolean(sync && (sync.current > 0 || sync.previous > 0 || sync.returns > 0 || sync.catchingUp || (data?.sapo?.products.pendingDays ?? 0) > 0)) ||
    // Products, or TikTok Shop days, still on their way are asked for again soon.
    Boolean(data?.gmvMax?.products.pending) ||
    (data?.gmvMax?.pendingDays ?? 0) > 0 ||
    (data?.tiktokShop?.pendingDays ?? 0) > 0
  useEffect(() => {
    if (!hydrated) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(query, { poll: true })
    }, syncing ? SYNCING_MS : LIVE_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(query, { poll: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, query, hydrated, syncing])

  // A one-second clock for "updated N seconds ago" and the widgets that count time.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // The sources this project has connected and shows; the page and its widgets read only these.
  const sources = OVERVIEW_SOURCES.filter((source) => connected.includes(source.pluginId) && !hidden.includes(source.pluginId))
  const sourcesDialog = (
    <DashboardSourcesDialog
      projectId={projectId}
      open={sourcesOpen}
      canConfigure={canConfigure}
      onClose={() => setSourcesOpen(false)}
      onSaved={() => {
        setSourcesOpen(false)
        // What is shown comes with the page (hidden sources): read it again, then the numbers.
        router.refresh()
        void load(query)
      }}
    />
  )

  // Every connected source hidden: the way back to them, not an invitation to connect.
  if (sources.length === 0 && OVERVIEW_SOURCES.some((source) => connected.includes(source.pluginId))) {
    return (
      <>
        <EmptyState
          icon={<TuneOutlined sx={{ fontSize: 32 }} />}
          title={t('allHidden')}
          description={t('allHiddenHint')}
          action={
            <Button variant="contained" onClick={() => setSourcesOpen(true)}>
              {t('chooseSources')}
            </Button>
          }
        />
        {sourcesDialog}
      </>
    )
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        icon={<PowerOutlined sx={{ fontSize: 32 }} />}
        title={t('noSources')}
        description={t('noSourcesHint')}
        action={
          <Button variant="contained" component={AppLink} href={`/projects/${projectId}/settings/connections`}>
            {t('connect')}
          </Button>
        }
      />
    )
  }

  const shown = data?.range ?? range
  const isToday = shown === 'today'
  const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
  // "hôm nay", "7 ngày qua", or the chosen dates.
  const periodLabel = t(`periodIn.${shown}`, {
    from: dayMonth(data?.period.start ?? ''),
    to: dayMonth(data?.period.end ?? ''),
  })
  const vsLabel = t(`vs.${shown}`, { days: data?.period.days ?? 0 })
  const updated = data
    ? new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
        timeStyle: 'medium',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(data.generatedAt))
    : null
  const age = data ? now - Date.parse(data.generatedAt) : null
  // Background refreshes update the numbers in place; only a change of
  // period dims the page, since then everything on it is about to change.
  const switching = loading && dataQuery !== query

  const failures = data ? sources.flatMap((source) => source.slice(data)?.failures ?? []) : []
  const lines = OVERVIEW_SOURCES.map((source) => ({
    source,
    on: sources.includes(source),
    status: source.status(data, isToday),
  }))
  const sourceIssue = lines.some((line) => line.on && !line.status.ok)
  // Says what the numbers cover, so a filtered dashboard is never mistaken for the whole business.
  const scopeText =
    (data ? sources.flatMap((source) => source.scope(data) ?? []) : [])
      .map((scope) => t(scope.message, scope.values))
      .join(' · ') || t('scopeAll')

  const context: OverviewContextValue | null = data
    ? { projectId, data, range: shown, isToday, periodLabel, vsLabel, now }
    : null
  // The widgets with something to show: their sources answered, and they have their say (see OverviewWidget).
  const answered = new Set(data ? sources.filter((source) => source.slice(data) !== null).map((source) => source.id) : [])
  const widgets = context
    ? OVERVIEW_WIDGETS.filter((widget) => widget.sources.every((id) => answered.has(id)) && (widget.when?.(context) ?? true))
    : []

  return (
    <Stack spacing={2.5}>
      {/* The one filter row: it scopes every number below it. */}
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={range}
            onChange={(_event, next: DashboardRange | null) => {
              // "Custom" opens the date picker; the range changes once dates are applied.
              if (next && next !== 'custom') setRange(next)
            }}
            aria-label={t('period')}
          >
            {DASHBOARD_RANGES.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: { xs: 1.25, sm: 2 }, textTransform: 'none', fontWeight: 600 }}>
                {t(`ranges.${option}`)}
              </ToggleButton>
            ))}
            <ToggleButton
              value="custom"
              aria-haspopup="dialog"
              onClick={(event) => setPickerAnchor(event.currentTarget)}
              sx={{ px: 1.5, gap: 0.75, textTransform: 'none', fontWeight: 600 }}
            >
              <CalendarMonthOutlined sx={{ fontSize: 16 }} />
              {range === 'custom' && custom ? `${dayMonth(custom.from)} – ${dayMonth(custom.to)}` : t('ranges.custom')}
            </ToggleButton>
          </ToggleButtonGroup>
          <CustomRangePopover
            anchor={pickerAnchor}
            value={custom}
            onClose={() => setPickerAnchor(null)}
            onApply={(next) => {
              setPeriod({ range: 'custom', custom: next })
              setPickerAnchor(null)
            }}
          />
          {/* Every connected source can be shown or hidden, and most have more to choose. */}
          {OVERVIEW_SOURCES.some((source) => connected.includes(source.pluginId)) ? (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<TuneOutlined sx={{ fontSize: 16 }} />}
              onClick={() => setSourcesOpen(true)}
            >
              {t('chooseSources')}
            </Button>
          ) : null}
          {data ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {scopeText}
            </Typography>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {switching ? <CircularProgress size={14} sx={{ mr: 0.5 }} /> : null}
          <StatusBadge
            stale={age === null || Boolean(error) || age > STALE_MS}
            warn={sourceIssue}
            warnLabel={t('sourcesIssue')}
            label={t('live')}
            detail={
              age === null
                ? t('loading')
                : age < 3000
                  ? t('updatedJustNow')
                  : t('updatedAgo', { seconds: Math.round(age / 1000) })
            }
            title={updated ? t('updatedAt', { time: updated }) : undefined}
          >
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              {t('sourcesTitle')}
            </Typography>
            <Stack spacing={1.5}>
              {lines.map(({ source, on, status }) => (
                <SourceLine
                  key={source.id}
                  name={source.name}
                  ok={on && status.ok}
                  detail={on ? t(status.message, status.values) : t('notConnected')}
                />
              ))}
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                {t('autoRefresh')}
              </Typography>
              <AppLink
                href={`/projects/${projectId}/settings/connections`}
                variant="caption"
                underline="hover"
                sx={{ fontWeight: 600 }}
              >
                {t('manageConnections')}
              </AppLink>
            </Stack>
          </StatusBadge>
          <Tooltip title={t('refresh')}>
            <span>
              {/* Held only while another period loads: the background refreshes every few seconds and would make it flicker. */}
              <IconButton size="small" onClick={() => void load(query)} disabled={switching} aria-label={t('refresh')}>
                <RefreshOutlined fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {error ? <Alert severity="error">{t('loadError', { message: error })}</Alert> : null}

      {!data || !context ? (
        <Grid container spacing={2}>
          {/* The shape of what comes: the scorecard's four tiles, then the charts — so nothing jumps when it lands. */}
          {Array.from({ length: 4 }, (_, i) => (
            <Grid key={i} size={{ xs: 6, md: 3 }}>
              <Skeleton variant="rounded" height={132} />
            </Grid>
          ))}
          {Array.from({ length: 2 }, (_, i) => (
            <Grid key={`chart-${i}`} size={{ xs: 12, lg: 6 }}>
              <Skeleton variant="rounded" height={320} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <OverviewProvider value={context}>
          <Box sx={{ opacity: switching ? 0.6 : 1, transition: 'opacity .2s' }}>
            <Stack spacing={2.5}>
              {failures.length > 0 ? (
                <Alert severity="warning">
                  {t('partial', { sources: [...new Set(failures.map((f) => f.source))].join(', ') })}
                </Alert>
              ) : null}

              {BANDS.map(({ band, spacing }) => {
                const row = widgets.filter((widget) => widget.band === band).sort((a, b) => a.order - b.order)
                if (row.length === 0) return null
                // Each widget's own width, then every row widened to the full width: a band that
                // lost a widget (taken away, or its source not connected) leaves no gap (band-layout.ts).
                const sizes = fillBand(row.map((widget) => (typeof widget.size === 'function' ? widget.size({ count: row.length }) : widget.size)))
                return (
                  <Grid key={band} container spacing={spacing}>
                    {row.map((widget, i) => (
                      <Grid key={widget.id} size={sizes[i]}>
                        <WidgetBoundary id={widget.id} resetKey={data.generatedAt}>
                          <widget.Component />
                        </WidgetBoundary>
                      </Grid>
                    ))}
                  </Grid>
                )
              })}
            </Stack>
          </Box>
        </OverviewProvider>
      )}

      {sourcesDialog}
    </Stack>
  )
}
