'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import AutoDeleteOutlined from '@mui/icons-material/AutoDeleteOutlined'
import BackupOutlined from '@mui/icons-material/BackupOutlined'
import CleaningServicesOutlined from '@mui/icons-material/CleaningServicesOutlined'
import CompressOutlined from '@mui/icons-material/CompressOutlined'
import DeveloperBoardOutlined from '@mui/icons-material/DeveloperBoardOutlined'
import DnsOutlined from '@mui/icons-material/DnsOutlined'
import MemoryOutlined from '@mui/icons-material/MemoryOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import RouterOutlined from '@mui/icons-material/RouterOutlined'
import SaveOutlined from '@mui/icons-material/SaveOutlined'
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import TuneOutlined from '@mui/icons-material/TuneOutlined'
import { PageHeader } from '@/components/ui/page-header'
import { formatBytes, formatDateTime, formatNumber } from '@/core/utils/format'
import { MONO_STACK } from '@/theme'
import { clearMemoryCache, createSnapshot, runCleanupNow, vacuumDatabase } from '../data/actions'
import type { HousekeepingSummary, LiveSample, Outcome, SystemSnapshot } from '../types'
import { CardTitle, ConfirmDialog, KeyValues, Meter, Spark, useDuration, useToast } from './parts'

/**
 * The System page. The server renders it once with everything; then the page
 * asks for the live part every five seconds (keeping the last sixty for the
 * sparklines — five minutes) and for everything once a minute. The
 * maintenance buttons run server actions, each confirmed first where it
 * deletes or locks, each ending in a toast.
 */

const LIVE_MS = 5_000
const FULL_MS = 60_000
const KEEP_SAMPLES = 60
const DISK_WARN = 85

type ActionKey = 'cleanup' | 'vacuum' | 'cache' | 'snapshot'

export function SystemPanel({ initial }: { initial: SystemSnapshot }) {
  const t = useTranslations('system')
  const locale = useLocale()
  const [snapshot, setSnapshot] = useState(initial)
  const [samples, setSamples] = useState<LiveSample[]>([initial.live])
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const toast = useToast()

  const push = useCallback((sample: LiveSample) => setSamples((list) => [...list, sample].slice(-KEEP_SAMPLES)), [])

  const refreshFull = useCallback(async () => {
    setRefreshing(true)
    try {
      const response = await fetch('/api/system/metrics?full=1', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const next = (await response.json()) as SystemSnapshot
      setSnapshot(next)
      push(next.live)
      setOffline(false)
    } catch {
      setOffline(true)
    } finally {
      setRefreshing(false)
    }
  }, [push])

  // One request at a time: a slow answer is not stacked on by the next tick.
  const inFlight = useRef(false)
  useEffect(() => {
    const live = setInterval(async () => {
      if (inFlight.current || document.hidden) return
      inFlight.current = true
      try {
        const response = await fetch('/api/system/metrics', { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        push((await response.json()) as LiveSample)
        setOffline(false)
      } catch {
        setOffline(true)
      } finally {
        inFlight.current = false
      }
    }, LIVE_MS)
    const full = setInterval(() => {
      if (!document.hidden) void refreshFull()
    }, FULL_MS)
    return () => {
      clearInterval(live)
      clearInterval(full)
    }
  }, [push, refreshFull])

  const live = samples[samples.length - 1] ?? snapshot.live

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip size="small" variant="outlined" color={offline ? 'warning' : 'success'} label={offline ? t('offline') : t('live')} />
            <Button
              size="small"
              startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshOutlined />}
              onClick={() => void refreshFull()}
              disabled={refreshing}
            >
              {t('refresh')}
            </Button>
          </Stack>
        }
      />

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
        <CpuCard snapshot={snapshot} live={live} samples={samples} />
        <MemoryCard live={live} samples={samples} />
        <DiskCard snapshot={snapshot} />
        <HostCard snapshot={snapshot} live={live} />
        <JobsCard snapshot={snapshot} />
        <ActionsCard snapshot={snapshot} onDone={refreshFull} toast={toast.show} />
        <DatabaseCard snapshot={snapshot} />
        <NetworkCard snapshot={snapshot} live={live} />
        <SnapshotsCard snapshot={snapshot} />
      </Box>
      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
        {t('collectedAt', { time: formatDateTime(snapshot.collectedAt, locale) })}
      </Typography>
      {toast.element}
    </Stack>
  )
}

function Big({ children, suffix }: { children: React.ReactNode; suffix?: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
      <Typography variant="h4" component="p" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {children}
      </Typography>
      {suffix ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {suffix}
        </Typography>
      ) : null}
    </Stack>
  )
}

function CpuCard({ snapshot, live, samples }: { snapshot: SystemSnapshot; live: LiveSample; samples: LiveSample[] }) {
  const t = useTranslations('system')
  const { host } = snapshot
  const load = live.cpu.loadavg
  return (
    <Card>
      <CardContent>
        <CardTitle icon={<DeveloperBoardOutlined color="primary" />}>{t('cpu.title')}</CardTitle>
        <Big suffix={t('cpu.usage')}>{live.cpu.percent === null ? '—' : `${live.cpu.percent.toFixed(1)}%`}</Big>
        <Meter percent={live.cpu.percent} />
        <Spark values={samples.map((s) => s.cpu.percent ?? 0)} label={t('cpu.chart')} />
        <Divider sx={{ my: 1.5 }} />
        <KeyValues
          rows={[
            [t('cpu.process'), `${live.cpu.processPercent.toFixed(1)}%`],
            [t('cpu.model'), host.cpuModel],
            [t('cpu.cores'), t('cpu.coresValue', { n: host.cores, mhz: host.speedMhz })],
            ...(load ? [[t('cpu.load'), load.map((v) => v.toFixed(2)).join(' · ')] as [string, string]] : []),
          ]}
        />
      </CardContent>
    </Card>
  )
}

function MemoryCard({ live, samples }: { live: LiveSample; samples: LiveSample[] }) {
  const t = useTranslations('system')
  const { memory } = live
  const percent = memory.total > 0 ? (memory.used / memory.total) * 100 : null
  return (
    <Card>
      <CardContent>
        <CardTitle icon={<MemoryOutlined color="primary" />}>{t('memory.title')}</CardTitle>
        <Big suffix={t('memory.of', { total: formatBytes(memory.total) })}>{formatBytes(memory.used)}</Big>
        <Meter percent={percent} warnAt={80} dangerAt={92} />
        <Spark values={samples.map((s) => (s.memory.total > 0 ? (s.memory.used / s.memory.total) * 100 : 0))} label={t('memory.chart')} />
        <Divider sx={{ my: 1.5 }} />
        <KeyValues
          rows={[
            [t('memory.free'), formatBytes(memory.free)],
            [t('memory.rss'), formatBytes(memory.process.rss)],
            [t('memory.heap'), `${formatBytes(memory.process.heapUsed)} / ${formatBytes(memory.process.heapTotal)}`],
            [t('memory.external'), formatBytes(memory.process.external)],
          ]}
        />
      </CardContent>
    </Card>
  )
}

function DiskCard({ snapshot }: { snapshot: SystemSnapshot }) {
  const t = useTranslations('system')
  const [main] = snapshot.disks
  return (
    <Card>
      <CardContent>
        <CardTitle icon={<StorageOutlined color="primary" />}>{t('disk.title')}</CardTitle>
        {main ? (
          <>
            <Big suffix={t('disk.freeOf', { free: formatBytes(main.free), total: formatBytes(main.total) })}>{`${main.percent.toFixed(1)}%`}</Big>
            <Meter percent={main.percent} warnAt={DISK_WARN} dangerAt={DISK_WARN} />
            {main.percent >= DISK_WARN ? (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {t('disk.warn')}
              </Alert>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('disk.unavailable')}
          </Typography>
        )}
        {snapshot.disks.length > 0 ? (
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t('disk.path')}</TableCell>
                <TableCell align="right">{t('disk.used')}</TableCell>
                <TableCell align="right">{t('disk.free')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {snapshot.disks.map((disk) => (
                <TableRow key={disk.path}>
                  <TableCell sx={{ fontFamily: MONO_STACK, fontSize: 12, wordBreak: 'break-all' }}>{disk.path}</TableCell>
                  <TableCell align="right" sx={{ color: disk.percent >= DISK_WARN ? 'error.main' : undefined, whiteSpace: 'nowrap' }}>
                    {`${disk.percent.toFixed(1)}%`}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {formatBytes(disk.free)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <Typography variant="subtitle2" sx={{ mt: 2 }}>
          {t('disk.folders')}
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('disk.folder')}</TableCell>
              <TableCell align="right">{t('disk.files')}</TableCell>
              <TableCell align="right">{t('disk.size')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {snapshot.folders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ color: 'text.secondary' }}>
                  {t('disk.noFolders')}
                </TableCell>
              </TableRow>
            ) : (
              snapshot.folders.map((folder) => (
                <TableRow key={folder.name || '-'}>
                  <TableCell sx={{ fontFamily: folder.name ? MONO_STACK : undefined, fontSize: 12, wordBreak: 'break-all' }}>
                    {!folder.name ? t('disk.loose') : /[\\/]/.test(folder.name) ? folder.name : `.data/${folder.name}`}
                  </TableCell>
                  <TableCell align="right">{folder.files.toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {formatBytes(folder.bytes)}
                    {folder.truncated ? ` (${t('disk.truncated')})` : ''}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function HostCard({ snapshot, live }: { snapshot: SystemSnapshot; live: LiveSample }) {
  const t = useTranslations('system')
  const duration = useDuration()
  const { host } = snapshot
  return (
    <Card>
      <CardContent>
        <CardTitle icon={<DnsOutlined color="primary" />}>{t('host.title')}</CardTitle>
        <KeyValues
          rows={[
            [t('host.hostname'), host.hostname],
            [t('host.os'), `${host.osType} ${host.osRelease} (${host.platform})`],
            [t('host.arch'), host.arch],
            [t('host.node'), host.nodeVersion],
            [t('host.app'), host.appVersion ?? '—'],
            [t('host.release'), host.release ?? t('host.dev')],
            [t('host.env'), host.nodeEnv],
            [t('host.timezone'), host.timezone],
            [t('host.osUptime'), duration(live.uptime.os)],
            [t('host.processUptime'), duration(live.uptime.process)],
          ]}
        />
      </CardContent>
    </Card>
  )
}

function DatabaseCard({ snapshot }: { snapshot: SystemSnapshot }) {
  const t = useTranslations('system')
  const locale = useLocale()
  const { database } = snapshot
  return (
    <Card sx={{ gridColumn: { md: 'span 2', lg: 'span 2' } }}>
      <CardContent>
        <CardTitle icon={<StorageOutlined color="primary" />}>{t('database.title')}</CardTitle>
        <KeyValues
          rows={[
            [t('database.kind'), database.kind === 'embedded' ? t('database.embedded') : t('database.postgres')],
            [t('database.location'), <Box key="l" component="span" sx={{ fontFamily: MONO_STACK, fontSize: 12 }}>{database.location}</Box>],
            [t('database.version'), database.version ?? '—'],
            [t('database.size'), database.bytes === null ? '—' : formatBytes(database.bytes)],
            ...(database.connections !== null ? [[t('database.connections'), String(database.connections)] as [string, string]] : []),
          ]}
        />
        {database.error ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {database.error}
          </Alert>
        ) : null}
        <Box sx={{ mt: 2, maxHeight: 360, overflow: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('database.table')}</TableCell>
                <TableCell align="right">{t('database.rows')}</TableCell>
                <TableCell align="right">{t('database.bytes')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {database.tables.map((table) => (
                <TableRow key={table.name} hover>
                  <TableCell sx={{ fontFamily: MONO_STACK, fontSize: 12 }}>{table.name}</TableCell>
                  <TableCell align="right">{`${table.exact ? '' : '≈ '}${formatNumber(table.rows, locale)}`}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {formatBytes(table.bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </CardContent>
    </Card>
  )
}

function NetworkCard({ snapshot, live }: { snapshot: SystemSnapshot; live: LiveSample }) {
  const t = useTranslations('system')
  return (
    <Card sx={{ gridColumn: { md: '1 / -1', lg: 'span 3' } }}>
      <CardContent>
        <CardTitle icon={<RouterOutlined color="primary" />}>{t('network.title')}</CardTitle>
        {live.network ? (
          <Stack direction="row" spacing={4} sx={{ mb: 1.5 }}>
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('network.rx')}
              </Typography>
              <Typography variant="h6">{`${formatBytes(Math.round(live.network.rxPerSec))}/s`}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('network.tx')}
              </Typography>
              <Typography variant="h6">{`${formatBytes(Math.round(live.network.txPerSec))}/s`}</Typography>
            </Box>
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            {t('network.unavailable')}
          </Typography>
        )}
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('network.interface')}</TableCell>
                <TableCell>{t('network.family')}</TableCell>
                <TableCell>{t('network.address')}</TableCell>
                <TableCell>{t('network.mac')}</TableCell>
                <TableCell>{t('network.kind')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {snapshot.interfaces.map((item) => (
                <TableRow key={`${item.name}-${item.address}`}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.family}</TableCell>
                  <TableCell sx={{ fontFamily: MONO_STACK, fontSize: 12, wordBreak: 'break-all' }}>{item.cidr ?? item.address}</TableCell>
                  <TableCell sx={{ fontFamily: MONO_STACK, fontSize: 12 }}>{item.mac}</TableCell>
                  <TableCell>{item.internal ? t('network.internal') : t('network.external')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </CardContent>
    </Card>
  )
}

function OnOff({ on }: { on: boolean }) {
  const t = useTranslations('system')
  return <Chip size="small" color={on ? 'success' : 'default'} variant="outlined" label={on ? t('jobs.on') : t('jobs.off')} />
}

function useReportText() {
  const t = useTranslations('system')
  return (report: HousekeepingSummary) =>
    t('jobs.report', {
      callLogs: report.callLogs,
      auditLogs: report.auditLogs,
      sessions: report.sessions,
      cacheFiles: report.cacheFiles,
      cacheBytes: formatBytes(report.cacheBytes),
    })
}

function JobsCard({ snapshot }: { snapshot: SystemSnapshot }) {
  const t = useTranslations('system')
  const locale = useLocale()
  const reportText = useReportText()
  const { jobs } = snapshot
  const last = jobs.housekeeping
  return (
    <Card>
      <CardContent>
        <CardTitle icon={<ScheduleOutlined color="primary" />}>{t('jobs.title')}</CardTitle>
        <KeyValues
          rows={[
            [t('jobs.backgroundSync'), <OnOff key="b" on={jobs.backgroundSync} />],
            [t('jobs.bookingAutoSync'), <OnOff key="a" on={jobs.bookingAutoSync} />],
            [t('jobs.housekeeping'), last.running ? t('jobs.running') : <OnOff key="h" on={last.scheduled} />],
            [t('jobs.lastRun'), last.lastAt ? `${formatDateTime(last.lastAt, locale)}${last.lastMs !== null ? ` · ${(last.lastMs / 1000).toFixed(1)} s` : ''}` : t('jobs.never')],
            [t('jobs.memo'), t('jobs.entries', { n: jobs.memoEntries })],
          ]}
        />
        {last.report ? (
          <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>
            {reportText(last.report)}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SnapshotsCard({ snapshot }: { snapshot: SystemSnapshot }) {
  const t = useTranslations('system')
  const locale = useLocale()
  return (
    <Card sx={{ gridColumn: { md: '1 / -1', lg: 'span 1' } }}>
      <CardContent>
        <CardTitle icon={<BackupOutlined color="primary" />}>{t('snapshots.title')}</CardTitle>
        {!snapshot.canSnapshot ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('snapshots.postgresHint')}
          </Typography>
        ) : snapshot.snapshots.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('snapshots.none')}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('snapshots.time')}</TableCell>
                <TableCell align="right">{t('snapshots.size')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {snapshot.snapshots.map((item) => (
                <TableRow key={item.name}>
                  <TableCell title={item.name}>{formatDateTime(item.at, locale)}</TableCell>
                  <TableCell align="right">{formatBytes(item.bytes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {snapshot.canSnapshot ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.secondary' }}>
            {t('snapshots.restoreHint')}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ActionsCard({
  snapshot,
  onDone,
  toast,
}: {
  snapshot: SystemSnapshot
  onDone: () => Promise<void>
  toast: (severity: 'success' | 'error' | 'info' | 'warning', message: string) => void
}) {
  const t = useTranslations('system')
  const reportText = useReportText()
  const [asking, setAsking] = useState<ActionKey | null>(null)
  const [busy, setBusy] = useState<ActionKey | null>(null)

  const failure = (outcome: Extract<Outcome<unknown>, { ok: false }>) =>
    outcome.reason === 'forbidden'
      ? t('actions.forbidden')
      : outcome.reason === 'unavailable'
        ? t('actions.unavailable')
        : t('actions.failed', { detail: outcome.detail ?? '' })

  async function run(key: ActionKey) {
    setBusy(key)
    try {
      if (key === 'cleanup') {
        const outcome = await runCleanupNow()
        if (outcome.ok) toast('success', `${t('actions.cleanup.done')}\n${reportText(outcome.data)}`)
        else toast(outcome.reason === 'unavailable' ? 'info' : 'error', outcome.reason === 'unavailable' ? t('actions.cleanup.busy') : failure(outcome))
      } else if (key === 'vacuum') {
        const outcome = await vacuumDatabase()
        if (outcome.ok) {
          const { before, after, ms } = outcome.data
          toast(
            'success',
            t('actions.vacuum.done', {
              seconds: (ms / 1000).toFixed(1),
              before: before === null ? '—' : formatBytes(before),
              after: after === null ? '—' : formatBytes(after),
            }),
          )
        } else toast('error', failure(outcome))
      } else if (key === 'cache') {
        const outcome = await clearMemoryCache()
        if (outcome.ok) toast('success', t('actions.cache.done', { n: outcome.data.entries }))
        else toast('error', failure(outcome))
      } else {
        const outcome = await createSnapshot()
        if (outcome.ok) toast('success', t('actions.snapshot.done', { name: outcome.data.name, size: formatBytes(outcome.data.bytes) }))
        else toast('error', failure(outcome))
      }
    } catch (error) {
      toast('error', t('actions.failed', { detail: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(null)
      setAsking(null)
      void onDone()
    }
  }

  const items: Array<{ key: ActionKey; icon: React.ReactNode; confirm: boolean; hidden?: boolean }> = [
    { key: 'cleanup', icon: <AutoDeleteOutlined fontSize="small" />, confirm: true },
    { key: 'vacuum', icon: <CompressOutlined fontSize="small" />, confirm: true },
    { key: 'cache', icon: <CleaningServicesOutlined fontSize="small" />, confirm: true },
    { key: 'snapshot', icon: <SaveOutlined fontSize="small" />, confirm: false, hidden: !snapshot.canSnapshot },
  ]

  const label = (key: ActionKey, part: 'title' | 'hint' | 'button' | 'confirmTitle' | 'confirmBody') => {
    switch (key) {
      case 'cleanup':
        return part === 'title' ? t('actions.cleanup.title') : part === 'hint' ? t('actions.cleanup.hint') : part === 'button' ? t('actions.cleanup.button') : part === 'confirmTitle' ? t('actions.cleanup.confirmTitle') : t('actions.cleanup.confirmBody')
      case 'vacuum':
        return part === 'title' ? t('actions.vacuum.title') : part === 'hint' ? t('actions.vacuum.hint') : part === 'button' ? t('actions.vacuum.button') : part === 'confirmTitle' ? t('actions.vacuum.confirmTitle') : t('actions.vacuum.confirmBody')
      case 'cache':
        return part === 'title' ? t('actions.cache.title') : part === 'hint' ? t('actions.cache.hint') : part === 'button' ? t('actions.cache.button') : part === 'confirmTitle' ? t('actions.cache.confirmTitle') : t('actions.cache.confirmBody')
      default:
        return part === 'title' ? t('actions.snapshot.title') : part === 'hint' ? t('actions.snapshot.hint') : t('actions.snapshot.button')
    }
  }

  return (
    <Card>
      <CardContent>
        <CardTitle icon={<TuneOutlined color="primary" />}>{t('actions.title')}</CardTitle>
        <Stack divider={<Divider flexItem />} spacing={1.5}>
          {items
            .filter((item) => !item.hidden)
            .map((item) => (
              <Stack key={item.key} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="subtitle2">{label(item.key, 'title')}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {label(item.key, 'hint')}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={busy === item.key ? <CircularProgress size={14} /> : item.icon}
                  disabled={busy !== null}
                  onClick={() => (item.confirm ? setAsking(item.key) : void run(item.key))}
                  sx={{ flexShrink: 0 }}
                >
                  {label(item.key, 'button')}
                </Button>
              </Stack>
            ))}
          {!snapshot.canSnapshot ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('snapshots.postgresHint')}
            </Typography>
          ) : null}
        </Stack>
        {asking ? (
          <ConfirmDialog
            open
            title={label(asking, 'confirmTitle')}
            confirmLabel={label(asking, 'button')}
            danger={asking === 'cleanup'}
            busy={busy === asking}
            onCancel={() => setAsking(null)}
            onConfirm={() => void run(asking)}
          >
            <Typography variant="body2">{label(asking, 'confirmBody')}</Typography>
          </ConfirmDialog>
        ) : null}
      </CardContent>
    </Card>
  )
}
