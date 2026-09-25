'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { AppLink } from '@/components/ui/app-link'
import { SyncNotice } from '@/components/ui/sync-notice'
import { EmptyState, PageHeader } from '@/components/ui/page-header'
import { useHydrated, usePreference } from '@/components/ui/use-preference'
import { CustomRangePopover } from '@/modules/overview/shell/custom-range'
import { SourceLine, StatusBadge } from '@/modules/overview/shell/status-badge'
import { WidgetBoundary } from '@/modules/overview/shell/widget-boundary'
import { ReportProvider, type ReportContextValue } from '../context'
import {
  GRANULARITIES,
  REPORT_LOOKBACK_DAYS,
  REPORT_MAX_DAYS,
  REPORT_RANGES,
  reportRangeProblem,
  type CustomRange,
  type Granularity,
  type ReportRange,
} from '../period'
import { sourceOn, type ReportBand, type ReportEnvelope, type ReportSource, type ReportWidget } from '../types'

/**
 * The frame every report module's page sits in.
 *
 * On top, the one filter row: the period and whether figures are grouped by
 * day or by month — both scope every widget below, and both are remembered in
 * this browser, shared by the four reports so moving between them keeps the
 * question the same. Beside them, how each source stands. Below, the module's
 * widgets band by band, each shown while the sources it needs are connected,
 * each kept from taking the page down when it fails (WidgetBoundary).
 *
 * These figures move by the hour at most, so the page refreshes every few
 * minutes — and every few seconds while a source is still reading the days
 * the period needs, so the figures fill in as they land.
 */

const REFRESH_MS = 5 * 60_000
/**
 * The last answer each report page had, by project and module, kept for as
 * long as the tab lives: coming back to a report shows it at once — then the
 * page asks again and replaces it — instead of an empty page while it loads.
 * In memory only; a reload starts afresh (and a first render on the server
 * never sees it, so nothing differs at hydration).
 */
const lastReports = new Map<string, { query: string; report: ReportEnvelope<unknown> }>()
const SYNCING_MS = 6_000
const STALE_MS = 15 * 60_000

const BANDS: ReadonlyArray<{ band: ReportBand; spacing: number }> = [
  { band: 'notice', spacing: 2 },
  { band: 'headline', spacing: 2 },
  { band: 'trend', spacing: 2.5 },
  { band: 'insight', spacing: 2.5 },
  { band: 'table', spacing: 2.5 },
]

type PeriodChoice = { range: ReportRange; granularity: Granularity; custom: CustomRange | null }
const PERIOD_DEFAULT: PeriodChoice = { range: '30d', granularity: 'day', custom: null }

function acceptPeriod(value: unknown): PeriodChoice | null {
  if (!value || typeof value !== 'object') return null
  const { range, granularity, custom } = value as Record<string, unknown>
  const dates = custom && typeof custom === 'object' ? (custom as Record<string, unknown>) : null
  const kept =
    dates && typeof dates.from === 'string' && typeof dates.to === 'string' && !reportRangeProblem({ from: dates.from, to: dates.to })
      ? { from: dates.from, to: dates.to }
      : null
  const grouping: Granularity = granularity === 'month' ? 'month' : 'day'
  if (range === 'custom') return kept ? { range, granularity: grouping, custom: kept } : { ...PERIOD_DEFAULT, granularity: grouping }
  return (REPORT_RANGES as readonly unknown[]).includes(range) ? { range: range as ReportRange, granularity: grouping, custom: kept } : null
}

export function ReportPage({
  projectId,
  moduleId,
  title,
  description,
  sources,
  connected,
  widgets,
}: {
  projectId: string
  moduleId: string
  title: string
  description: string
  /** The sources this module reads. */
  sources: ReportSource[]
  /** The connector plugins the project has usable connections for. */
  connected: string[]
  widgets: ReportWidget[]
}) {
  const t = useTranslations('reports')
  const locale = useLocale()
  const [period, setPeriod] = usePreference<PeriodChoice>('adshub.reports.period', PERIOD_DEFAULT, acceptPeriod)
  const { range, granularity, custom } = period
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const cacheKey = `${projectId}:${moduleId}`
  const [report, setReport] = useState<ReportEnvelope<unknown> | null>(() => lastReports.get(cacheKey)?.report ?? null)
  const [reportQuery, setReportQuery] = useState<string | null>(() => lastReports.get(cacheKey)?.query ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  // A load under way: the timer waits for it rather than stacking another behind it.
  const inFlight = useRef(false)
  const query = `range=${range}&granularity=${granularity}${range === 'custom' && custom ? `&from=${custom.from}&to=${custom.to}` : ''}`

  const load = useCallback(
    async (q: string) => {
      const id = ++latest.current
      inFlight.current = true
      setLoading(true)
      try {
        const response = await fetch(`/api/projects/${projectId}/reports/${moduleId}?${q}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(response.status === 403 ? t('forbidden') : `HTTP ${response.status}`)
        const next = (await response.json()) as ReportEnvelope<unknown>
        if (id === latest.current) {
          setReport(next)
          setReportQuery(q)
          setError(null)
          lastReports.set(`${projectId}:${moduleId}`, { query: q, report: next })
        }
      } catch (reason) {
        if (id === latest.current) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (id === latest.current) {
          setLoading(false)
          inFlight.current = false
        }
      }
    },
    [projectId, moduleId, t],
  )

  const hydrated = useHydrated()
  useEffect(() => {
    if (hydrated) void load(query)
  }, [load, query, hydrated])

  // Fast polling only while a source that reads fine still has days coming; a failing one waits for the slow refresh.
  const syncing = report ? Object.values(report.sources).some((source) => source.connected && source.ok && source.pendingDays > 0) : false
  useEffect(() => {
    if (!hydrated) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !inFlight.current) void load(query)
    }, syncing ? SYNCING_MS : REFRESH_MS)
    return () => clearInterval(timer)
  }, [load, query, hydrated, syncing])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const on = new Set(sources.filter((source) => sourceOn(source, connected)))
  const sourceName = (source: ReportSource) => t(`sources.${source}`)

  if (on.size === 0) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <EmptyState
          icon={<PowerOutlined sx={{ fontSize: 32 }} />}
          title={t('noSources')}
          description={t('noSourcesHint', { sources: sources.map(sourceName).join(', ') })}
          action={
            <Button variant="contained" component={AppLink} href={`/projects/${projectId}/settings/connections`}>
              {t('connect')}
            </Button>
          }
        />
      </>
    )
  }

  const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
  const shownRange = report?.period.range ?? range
  const periodLabel = t(`periodIn.${shownRange}`, {
    from: dayMonth(report?.period.start ?? ''),
    to: dayMonth(report?.period.end ?? ''),
  })
  const switching = loading && reportQuery !== query
  const age = report ? now - Date.parse(report.generatedAt) : null
  const updated = report
    ? new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(
        new Date(report.generatedAt),
      )
    : null
  const missing = sources.filter((source) => !on.has(source))
  const sourceIssue = report ? sources.some((source) => on.has(source) && !report.sources[source]?.ok) : false

  const context: ReportContextValue | null = report
    ? { projectId, report, granularity: report.period.granularity, periodLabel, connected: on }
    : null
  const shown = widgets.filter((widget) => widget.sources.every((source) => on.has(source)))

  return (
    <Stack spacing={2.5}>
      <PageHeader title={title} description={description} />

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={range}
            onChange={(_event, next: ReportRange | null) => {
              if (next && next !== 'custom') setPeriod((current) => ({ ...current, range: next }))
            }}
            aria-label={t('period')}
          >
            {REPORT_RANGES.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: 2, textTransform: 'none', fontWeight: 600 }}>
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
            limits={{ lookback: REPORT_LOOKBACK_DAYS, maxDays: REPORT_MAX_DAYS, problem: (value) => reportRangeProblem(value) }}
            compare={false}
            onClose={() => setPickerAnchor(null)}
            onApply={(next) => {
              setPeriod((current) => ({ ...current, range: 'custom', custom: next }))
              setPickerAnchor(null)
            }}
          />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={granularity}
            onChange={(_event, next: Granularity | null) => {
              if (next) setPeriod((current) => ({ ...current, granularity: next }))
            }}
            aria-label={t('grouping')}
          >
            {GRANULARITIES.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: 1.75, textTransform: 'none', fontWeight: 600 }}>
                {t(`granularity.${option}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {switching ? <CircularProgress size={14} sx={{ mr: 0.5 }} /> : null}
          <StatusBadge
            stale={age === null || Boolean(error) || age > STALE_MS || syncing}
            warn={sourceIssue}
            warnLabel={t('sourcesIssue')}
            label={syncing ? t('statusSyncing') : t('statusLabel')}
            detail={updated ? t('updatedAt', { time: updated }) : t('loading')}
          >
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              {t('sourcesTitle')}
            </Typography>
            <Stack spacing={1.5}>
              {sources.map((source) => {
                const state = report?.sources[source]
                const detail = !on.has(source)
                  ? t('notConnected')
                  : !state
                    ? t('loading')
                    : state.pendingDays > 0
                      ? t('sourcePending', { count: state.pendingDays })
                      : state.note
                        ? t(state.note.key, state.note.values)
                        : state.ok
                          ? t('sourceOk')
                          : t('sourceError')
                return <SourceLine key={source} name={sourceName(source)} ok={on.has(source) && Boolean(state?.ok) && !state?.pendingDays} detail={detail} />
              })}
              <AppLink href={`/projects/${projectId}/settings/connections`} variant="caption" underline="hover" sx={{ fontWeight: 600 }}>
                {t('manageConnections')}
              </AppLink>
            </Stack>
          </StatusBadge>
          <Tooltip title={t('refresh')}>
            <span>
              <IconButton size="small" onClick={() => void load(query)} disabled={loading} aria-label={t('refresh')}>
                <RefreshOutlined fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {missing.length > 0 ? (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" component={AppLink} href={`/projects/${projectId}/settings/connections`} sx={{ whiteSpace: 'nowrap' }}>
              {t('connect')}
            </Button>
          }
        >
          {t('missingSources', { sources: missing.map(sourceName).join(', ') })}
        </Alert>
      ) : null}
      {error ? <Alert severity="error">{t('loadError', { message: error })}</Alert> : null}
      {report ? (
        <SyncNotice
          severity="warning"
          title={t('syncTitle')}
          lines={sources
            .filter((source) => on.has(source) && (report.sources[source]?.pendingDays ?? 0) > 0)
            .map((source) => t('syncSourceLine', { source: sourceName(source), count: report.sources[source].pendingDays }))}
          footer={t('syncAutoUpdate')}
        />
      ) : null}
      {report && report.failures.length > 0 ? (
        <Alert severity="warning">
          {t('partial', { sources: [...new Set(report.failures.map((f) => f.source))].join(', ') })}
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {report.failures.slice(0, 4).map((failure, i) => (
              <Typography key={i} component="li" variant="caption" sx={{ display: 'list-item', wordBreak: 'break-word' }}>
                {`${failure.source}: ${failure.message}`}
              </Typography>
            ))}
          </Box>
        </Alert>
      ) : null}

      {!report || !context ? (
        <Grid container spacing={2}>
          {Array.from({ length: 4 }, (_, i) => (
            <Grid key={i} size={{ xs: 6, md: 3 }}>
              <Skeleton variant="rounded" height={104} />
            </Grid>
          ))}
          {Array.from({ length: 2 }, (_, i) => (
            <Grid key={`chart-${i}`} size={{ xs: 12, lg: 6 }}>
              <Skeleton variant="rounded" height={300} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <ReportProvider value={context}>
          <Box sx={{ opacity: switching ? 0.6 : 1, transition: 'opacity .2s' }}>
            <Stack spacing={2.5}>
              {BANDS.map(({ band, spacing }) => {
                const row = shown.filter((widget) => widget.band === band).sort((a, b) => a.order - b.order)
                if (row.length === 0) return null
                return (
                  <Grid key={band} container spacing={spacing}>
                    {row.map((widget) => (
                      <Grid key={widget.id} size={typeof widget.size === 'function' ? widget.size({ count: row.length }) : widget.size}>
                        <WidgetBoundary id={widget.id} resetKey={report.generatedAt}>
                          <widget.Component />
                        </WidgetBoundary>
                      </Grid>
                    ))}
                  </Grid>
                )
              })}
            </Stack>
          </Box>
        </ReportProvider>
      )}
    </Stack>
  )
}
