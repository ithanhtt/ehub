'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import HistoryOutlined from '@mui/icons-material/HistoryOutlined'
import MarkEmailReadOutlined from '@mui/icons-material/MarkEmailReadOutlined'
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined'
import SystemUpdateAltOutlined from '@mui/icons-material/SystemUpdateAltOutlined'
import { PageHeader } from '@/components/ui/page-header'
import { MONO_STACK } from '@/theme'
import { confirmUpdate, discardUpdate, sendUpdate, suggestVersion } from '../data/actions'
import {
  UPDATE_STEPS,
  type ConfirmOutcome,
  type SendOutcome,
  type UpdateOverview,
  type UpdateRecord,
  type UpdateState,
  type UpdateStatus,
  type VersionSuggestion,
} from '../types'
import { bumpVersion, compareVersions, isVersion } from '../version'

/**
 * The System update page. On the development machine: pack & send, then the
 * confirmation code, big enough to read across a room. On the server: the
 * update waiting for that code, the run step by step with its log, and the
 * history. While an update runs the page asks for news every two seconds —
 * and keeps asking through the restart, when the server cannot answer.
 */

const ACTIVE: UpdateState[] = ['queued', 'running']

function useFormats() {
  const locale = useLocale()
  const tag = locale === 'vi' ? 'vi-VN' : 'en-GB'
  const when = new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
  const time = new Intl.DateTimeFormat(tag, { timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
  const mb = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 })
  return {
    when: (iso: string) => when.format(new Date(iso)),
    time: (iso: string) => time.format(new Date(iso)),
    size: (bytes: number) => mb.format(bytes / 1024 / 1024),
  }
}

export function UpdatePanel({ initial }: { initial: UpdateOverview }) {
  const t = useTranslations('systemUpdate')
  const [overview, setOverview] = useState(initial)
  const [offline, setOffline] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/system/updates/status', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      setOverview((await response.json()) as UpdateOverview)
      setOffline(false)
    } catch {
      // Mid-restart the server cannot answer; the page keeps asking until it does.
      setOffline(true)
    }
  }, [])

  const running = overview.status !== null && ACTIVE.includes(overview.status.state)
  useEffect(() => {
    if (!overview.receiver) return
    const timer = setInterval(() => void refresh(), running || offline ? 2000 : 15_000)
    return () => clearInterval(timer)
  }, [overview.receiver, running, offline, refresh])

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <Chip
            variant="outlined"
            label={overview.release ? t('currentRelease', { release: overview.release.id }) : t('devRelease')}
          />
        }
      />

      {!overview.sender && !overview.receiver ? (
        <Alert severity="info">
          <AlertTitle>{t('notConfiguredTitle')}</AlertTitle>
          {t('notConfiguredHint')}
        </Alert>
      ) : null}

      {overview.sender ? <SenderCard sender={overview.sender} /> : null}

      {overview.receiver ? (
        <>
          {overview.receiver.problems.map((problem) => (
            <Alert key={problem} severity="warning">
              {t(`problem.${problem}`)}
            </Alert>
          ))}
          {offline ? (
            <Alert severity="info" icon={<CircularProgress size={18} />}>
              {t('restarting')}
            </Alert>
          ) : null}
          <PendingCard overview={overview} onChange={refresh} />
          {overview.status ? <ProgressCard status={overview.status} log={overview.log} /> : null}
          <HistoryCard history={overview.history} />
        </>
      ) : null}
    </Stack>
  )
}

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
      {icon}
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
        {children}
      </Typography>
    </Stack>
  )
}

/** The development machine's half: pack, sign, send — then the code to type on the server. */
function SenderCard({ sender }: { sender: NonNullable<UpdateOverview['sender']> }) {
  const t = useTranslations('systemUpdate')
  const [sending, start] = useTransition()
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)
  const [asking, setAsking] = useState(false)

  const send = (version: string) => {
    setAsking(false)
    start(async () => setOutcome(await sendUpdate(version)))
  }

  return (
    <Card>
      <CardContent>
        <CardTitle icon={<CloudUploadOutlined color="primary" />}>{t('sendTitle')}</CardTitle>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('sendHint', { server: sender.server })}
        </Typography>
        {sender.problem ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t(`senderProblem.${sender.problem}`)}
          </Alert>
        ) : null}
        <Button
          variant="contained"
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <CloudUploadOutlined />}
          disabled={sending || Boolean(sender.problem)}
          onClick={() => setAsking(true)}
          sx={{ mt: 2 }}
        >
          {sending ? t('sending') : t('sendButton')}
        </Button>
        {asking ? <VersionDialog onCancel={() => setAsking(false)} onSend={send} /> : null}
        {outcome && !outcome.ok ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {t(`sendError.${outcome.reason}`, { detail: outcome.detail ?? '' })}
          </Alert>
        ) : null}
        {outcome?.ok ? <CodeBox outcome={outcome} /> : null}
      </CardContent>
    </Card>
  )
}

/**
 * Asks which version this update is. Starts one patch above what the server
 * runs (or this checkout's package.json, when that is higher or the server
 * cannot be asked); any other version may be typed or picked.
 */
function VersionDialog({ onCancel, onSend }: { onCancel: () => void; onSend: (version: string) => void }) {
  const t = useTranslations('systemUpdate')
  const tc = useTranslations('common')
  const [suggestion, setSuggestion] = useState<VersionSuggestion | null>(null)
  const [version, setVersion] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void suggestVersion()
      .catch(() => null)
      .then((result) => {
        if (!live) return
        setSuggestion(result)
        setVersion((current) => current || (result?.suggested ?? '0.0.1'))
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [])

  const value = version.trim()
  const valid = isVersion(value)
  const base = compareVersions(suggestion?.server, suggestion?.local) >= 0 ? suggestion?.server : suggestion?.local
  const notHigher = valid && suggestion?.server ? compareVersions(value, suggestion.server) <= 0 : false
  const submit = () => {
    if (valid && !loading) onSend(value)
  }

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{t('versionTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {loading ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <CircularProgress size={16} />
              <Typography variant="body2">{t('versionLoading')}</Typography>
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {suggestion?.server ? t('versionServer', { version: suggestion.server }) : t('versionServerUnknown')}
              {suggestion?.local ? ` · ${t('versionLocal', { version: suggestion.local })}` : null}
            </Typography>
          )}
          <TextField
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            label={t('versionLabel')}
            placeholder="1.2.3"
            autoFocus
            autoComplete="off"
            disabled={loading}
            error={value.length > 0 && !valid}
            helperText={value.length > 0 && !valid ? t('versionInvalid') : t('versionHint')}
            slotProps={{ htmlInput: { spellCheck: false, maxLength: 48, style: { fontFamily: MONO_STACK } } }}
          />
          {!loading ? (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {(['patch', 'minor', 'major'] as const).map((kind) => {
                const next = bumpVersion(base, kind)
                return (
                  <Chip
                    key={kind}
                    size="small"
                    variant={next === value ? 'filled' : 'outlined'}
                    color={next === value ? 'primary' : 'default'}
                    label={t(`versionBump.${kind}`, { version: next })}
                    onClick={() => setVersion(next)}
                  />
                )
              })}
            </Stack>
          ) : null}
          {notHigher ? <Alert severity="warning">{t('versionNotHigher', { version: suggestion?.server ?? '' })}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onCancel} color="inherit">
          {tc('cancel')}
        </Button>
        <Button variant="contained" startIcon={<CloudUploadOutlined />} disabled={loading || !valid} onClick={submit}>
          {t('sendButton')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function CodeBox({ outcome }: { outcome: Extract<SendOutcome, { ok: true }> }) {
  const t = useTranslations('systemUpdate')
  const format = useFormats()
  const [copied, setCopied] = useState(false)
  return (
    <Box sx={{ mt: 2.5, p: { xs: 2, sm: 3 }, borderRadius: 3, bgcolor: 'var(--adshub-surface-inset)', textAlign: 'center' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        {t('codeLabel')}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', alignItems: 'center' }}>
        <Typography
          component="p"
          aria-live="polite"
          sx={{ fontFamily: MONO_STACK, fontSize: { xs: 30, sm: 42 }, fontWeight: 700, letterSpacing: '0.14em' }}
        >
          {outcome.code}
        </Typography>
        <Tooltip title={copied ? t('copied') : t('copyCode')}>
          <IconButton
            aria-label={t('copyCode')}
            onClick={() => void navigator.clipboard.writeText(outcome.code).then(() => setCopied(true))}
          >
            <ContentCopyOutlined />
          </IconButton>
        </Tooltip>
      </Stack>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {t('codeHint', { server: outcome.server, time: format.time(outcome.expiresAt) })}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        {t('sentDetail', { version: outcome.version, files: outcome.files, size: format.size(outcome.bytes) })}
      </Typography>
    </Box>
  )
}

/** "K7Q29XMP" → "K7Q2-9XMP", as it is typed. */
const formatCode = (value: string) => {
  const plain = value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8)
  return plain.length > 4 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : plain
}

/** The server's half: the update waiting for its code. */
function PendingCard({ overview, onChange }: { overview: UpdateOverview; onChange: () => Promise<void> }) {
  const t = useTranslations('systemUpdate')
  const format = useFormats()
  const [code, setCode] = useState('')
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null)
  const [working, start] = useTransition()
  const pending = overview.pending
  const blocked = (overview.receiver?.problems.length ?? 0) > 0
  const busy = overview.status !== null && ACTIVE.includes(overview.status.state)

  const confirm = () =>
    start(async () => {
      if (!pending) return
      const result = await confirmUpdate(pending.id, code)
      setOutcome(result)
      if (result.ok) setCode('')
      await onChange()
    })
  const discard = () =>
    start(async () => {
      if (!pending) return
      await discardUpdate(pending.id)
      setOutcome(null)
      await onChange()
    })

  return (
    <Card>
      <CardContent>
        <CardTitle icon={<MarkEmailReadOutlined color="primary" />}>{t('pendingTitle')}</CardTitle>
        {!pending ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('pendingNone')}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {pending.label}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {t('pendingInfo', {
                time: format.when(pending.createdAt),
                source: pending.source,
                files: pending.files,
                size: format.size(pending.bytes),
              })}
              {' · '}
              {t('pendingExpires', { time: format.time(pending.expiresAt) })}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', fontFamily: MONO_STACK, mt: 0.5 }}>
              SHA-256 {pending.sha256.slice(0, 16)}…
            </Typography>

            {pending.confirmedAt ? (
              <Chip color="primary" variant="outlined" label={t('pendingApplying')} sx={{ mt: 2 }} />
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2, alignItems: { sm: 'flex-start' } }}>
                <TextField
                  value={code}
                  onChange={(event) => setCode(formatCode(event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && code.length === 9) confirm()
                  }}
                  label={t('codeInput')}
                  helperText={t('codeInputHint')}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  disabled={working || blocked || busy}
                  slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO_STACK, letterSpacing: '0.14em' } } }}
                  sx={{ width: { sm: 260 } }}
                />
                <Button
                  variant="contained"
                  startIcon={working ? <CircularProgress size={16} color="inherit" /> : <SystemUpdateAltOutlined />}
                  disabled={working || blocked || busy || code.length !== 9}
                  onClick={confirm}
                  sx={{ height: 40 }}
                >
                  {t('confirmButton')}
                </Button>
                <Button color="inherit" disabled={working || busy} onClick={discard} sx={{ height: 40 }}>
                  {t('discardButton')}
                </Button>
              </Stack>
            )}
          </>
        )}
        {outcome && !outcome.ok ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {t(`confirmError.${outcome.reason}`, { count: outcome.remaining ?? 0 })}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

const STATE_SEVERITY: Record<UpdateState, 'info' | 'success' | 'warning' | 'error'> = {
  queued: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  'rolled-back': 'warning',
  interrupted: 'warning',
}

/** The run, step by step, with its log. */
function ProgressCard({ status, log }: { status: UpdateStatus; log: string[] }) {
  const t = useTranslations('systemUpdate')
  const [showLog, setShowLog] = useState(status.state === 'failed' || status.state === 'rolled-back')
  const active = ACTIVE.includes(status.state)

  return (
    <Card>
      <CardContent>
        <CardTitle icon={<SystemUpdateAltOutlined color="primary" />}>{t('progressTitle')}</CardTitle>
        <Alert severity={STATE_SEVERITY[status.state]} icon={active ? <CircularProgress size={18} /> : undefined}>
          {t(`state.${status.state}`, { label: status.label, release: status.release ?? '' })}
          {status.error ? (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontFamily: MONO_STACK, wordBreak: 'break-word' }}>
              {status.error}
            </Typography>
          ) : null}
        </Alert>

        <Stack component="ol" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0, mt: 2 }}>
          {UPDATE_STEPS.map((key) => {
            const step = status.steps.find((entry) => entry.key === key)
            const state = step?.state ?? 'pending'
            const took =
              step?.startedAt && step.endedAt
                ? Math.max(0, Math.round((Date.parse(step.endedAt) - Date.parse(step.startedAt)) / 1000))
                : null
            return (
              <Stack key={key} component="li" direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                {state === 'done' ? (
                  <CheckCircleOutlined sx={{ fontSize: 20, color: 'success.main' }} />
                ) : state === 'running' ? (
                  <CircularProgress size={18} sx={{ m: '1px' }} />
                ) : state === 'failed' ? (
                  <ErrorOutlineOutlined sx={{ fontSize: 20, color: 'error.main' }} />
                ) : (
                  <RadioButtonUncheckedOutlined sx={{ fontSize: 20, color: 'text.disabled' }} />
                )}
                <Typography
                  variant="body2"
                  sx={{ fontWeight: state === 'running' ? 700 : 400, color: state === 'pending' ? 'text.secondary' : 'text.primary' }}
                >
                  {t(`step.${key}`)}
                </Typography>
                {took !== null ? (
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    {t('stepTook', { seconds: took })}
                  </Typography>
                ) : null}
              </Stack>
            )
          })}
        </Stack>

        {status.backup ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary', wordBreak: 'break-all' }}>
            {t('backupAt', { file: status.backup })}
          </Typography>
        ) : null}

        <Button size="small" onClick={() => setShowLog((value) => !value)} sx={{ mt: 1.5 }}>
          {showLog ? t('hideLog') : t('showLog')}
        </Button>
        <Collapse in={showLog}>
          <Box
            component="pre"
            sx={{
              m: 0,
              mt: 1,
              p: 1.5,
              maxHeight: 360,
              overflow: 'auto',
              borderRadius: 2,
              bgcolor: 'var(--adshub-surface-inset)',
              fontFamily: MONO_STACK,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {log.length > 0 ? log.join('\n') : t('noLog')}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  )
}

const RESULT_COLOR: Record<UpdateState, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  queued: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  'rolled-back': 'warning',
  interrupted: 'warning',
}

function HistoryCard({ history }: { history: UpdateRecord[] }) {
  const t = useTranslations('systemUpdate')
  const format = useFormats()
  return (
    <Card>
      <CardContent>
        <CardTitle icon={<HistoryOutlined color="primary" />}>{t('historyTitle')}</CardTitle>
        {history.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('historyEmpty')}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('colTime')}</TableCell>
                  <TableCell>{t('colVersion')}</TableCell>
                  <TableCell>{t('colResult')}</TableCell>
                  <TableCell>{t('colBy')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{format.when(record.endedAt ?? record.startedAt)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{record.label}</Typography>
                      {record.release ? (
                        <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: MONO_STACK }}>
                          {record.release}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={record.error ?? ''}>
                        <Chip size="small" variant="outlined" color={RESULT_COLOR[record.state]} label={t(`result.${record.state}`)} />
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{record.confirmedBy ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
