'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import TuneOutlined from '@mui/icons-material/TuneOutlined'
import { PageHeader } from '@/components/ui/page-header'
import { DateField } from '@/components/ui/date-field'
import { localToday } from '@/components/ui/month-calendar'
import { formatMoney } from '@/core/utils/format'
import { daysBetween, shiftDay } from '@/modules/overview/data/period'
import { CardTitle, ConfirmDialog, useToast } from '@/modules/system-admin/ui/parts'
import { deleteAdjustment, saveAdjustment } from '../data/actions'
import { ADJUSTMENT_METRICS, amountsByDay } from '../spread'
import type { AdjustmentInput, AdjustmentMetric, AdjustmentRow, AdjustmentSpread, AdjustmentsOverview } from '../types'

/**
 * Metric adjustments — platform Administrators only: amounts added to (or
 * taken off) a project's overview figures over a day, a month, a year or any
 * span, from sources the connectors do not read. The dashboard shows the
 * figures with them folded in, worded exactly as before.
 */

type PeriodKind = 'day' | 'month' | 'year' | 'range'

interface Draft {
  id?: string
  projectId: string
  metric: AdjustmentMetric
  sign: 1 | -1
  /** Digits only. */
  amount: string
  spread: AdjustmentSpread
  kind: PeriodKind
  day: string
  month: string
  year: string
  from: string
  to: string
  note: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function lastDayOf(year: number, month: number) {
  return `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
}

/** The draft's days, or null while they are incomplete or out of order. */
function spanOf(draft: Draft): { startOn: string; endOn: string } | null {
  const year = Number(draft.year)
  switch (draft.kind) {
    case 'day':
      return draft.day ? { startOn: draft.day, endOn: draft.day } : null
    case 'month': {
      const month = Number(draft.month)
      if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12)) return null
      return { startOn: `${year}-${pad(month)}-01`, endOn: lastDayOf(year, month) }
    }
    case 'year':
      return year >= 2000 && year <= 2100 ? { startOn: `${year}-01-01`, endOn: `${year}-12-31` } : null
    case 'range':
      return draft.from && draft.to && draft.from <= draft.to ? { startOn: draft.from, endOn: draft.to } : null
  }
}

/** How an existing adjustment's days read back into the form: a whole month or year as such. */
function kindOf(row: AdjustmentRow): Pick<Draft, 'kind' | 'day' | 'month' | 'year' | 'from' | 'to'> {
  const [y, m] = row.startOn.split('-').map(Number)
  const base = { day: row.startOn, month: String(m), year: String(y), from: row.startOn, to: row.endOn }
  if (row.startOn === row.endOn) return { ...base, kind: 'day' }
  if (row.startOn === `${y}-01-01` && row.endOn === `${y}-12-31`) return { ...base, kind: 'year' }
  if (row.startOn.endsWith('-01') && row.endOn === lastDayOf(y, m)) return { ...base, kind: 'month' }
  return { ...base, kind: 'range' }
}

function blankDraft(projectId: string): Draft {
  const today = localToday()
  const [y, m] = today.split('-')
  return {
    projectId,
    metric: 'sapoRevenue',
    sign: 1,
    amount: '',
    spread: 'total',
    kind: 'month',
    day: today,
    month: String(Number(m)),
    year: y,
    from: shiftDay(today, -6),
    to: today,
    note: '',
  }
}

export function AdjustmentsPanel({ initial }: { initial: AdjustmentsOverview }) {
  const t = useTranslations('adjustments')
  const locale = useLocale()
  const router = useRouter()
  const toast = useToast()
  const [filter, setFilter] = useState<string>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<AdjustmentRow | null>(null)
  const [busy, startBusy] = useTransition()

  const projectName = useMemo(() => new Map(initial.projects.map((p) => [p.id, p.name])), [initial.projects])
  const rows = filter === 'all' ? initial.adjustments : initial.adjustments.filter((r) => r.projectId === filter)
  const money = (value: number) => formatMoney(value, locale)
  const signed = (value: number) => `${value > 0 ? '+' : '−'}${money(Math.abs(value))}`
  const dayLabel = (day: string) => day.split('-').reverse().join('/')

  const failed = (message: string) => toast.show('error', t(`errors.${message}`))

  const save = (input: AdjustmentInput) =>
    startBusy(async () => {
      const outcome = await saveAdjustment(input)
      if (!outcome.ok) return failed(outcome.message)
      setDraft(null)
      toast.show('success', t('saved'))
      router.refresh()
    })

  const remove = (row: AdjustmentRow) =>
    startBusy(async () => {
      const outcome = await deleteAdjustment(row.id)
      if (!outcome.ok) return failed(outcome.message)
      setRemoving(null)
      toast.show('success', t('deleted'))
      router.refresh()
    })

  const edit = (row: AdjustmentRow) =>
    setDraft({
      id: row.id,
      projectId: row.projectId,
      metric: row.metric,
      sign: row.amount < 0 ? -1 : 1,
      amount: String(Math.abs(row.amount)),
      spread: row.spread,
      note: row.note ?? '',
      ...kindOf(row),
    })

  const noProjects = initial.projects.length === 0

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            disabled={noProjects}
            onClick={() => setDraft(blankDraft(filter !== 'all' ? filter : (initial.projects[0]?.id ?? '')))}
          >
            {t('add')}
          </Button>
        }
      />

      <Card>
        <CardContent>
          <CardTitle
            icon={<TuneOutlined fontSize="small" color="primary" />}
            action={
              <TextField select size="small" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 200 }} label={t('project')}>
                <MenuItem value="all">{t('allProjects')}</MenuItem>
                {initial.projects.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
            }
          >
            {t('listTitle', { count: rows.length })}
          </CardTitle>

          {rows.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {noProjects ? t('noProjects') : t('empty')}
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 820 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('project')}</TableCell>
                    <TableCell>{t('metric')}</TableCell>
                    <TableCell align="right">{t('amount')}</TableCell>
                    <TableCell>{t('period')}</TableCell>
                    <TableCell align="right">{t('perDay')}</TableCell>
                    <TableCell>{t('note')}</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const days = daysBetween(row.startOn, row.endOn).length
                    const daily = row.spread === 'daily' ? row.amount : row.amount / days
                    return (
                      <TableRow key={row.id} hover>
                        <TableCell>{projectName.get(row.projectId) ?? row.projectId}</TableCell>
                        <TableCell>{t(`metrics.${row.metric}`)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          <Typography component="span" variant="body2" sx={{ fontWeight: 600, color: row.amount < 0 ? 'error.main' : 'success.main' }}>
                            {signed(row.amount)}
                          </Typography>
                          <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                            {row.spread === 'daily' ? t('spreadDailyShort') : t('spreadTotalShort')}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {row.startOn === row.endOn ? dayLabel(row.startOn) : `${dayLabel(row.startOn)} – ${dayLabel(row.endOn)}`}
                          <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                            {t('days', { count: days })}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {signed(Math.round(daily))}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 260 }}>
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                            {row.note || '—'}
                          </Typography>
                          {row.createdBy ? (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {row.createdBy}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Tooltip title={t('edit')}>
                            <IconButton size="small" onClick={() => edit(row)} aria-label={t('edit')}>
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('delete')}>
                            <IconButton size="small" color="error" onClick={() => setRemoving(row)} aria-label={t('delete')}>
                              <DeleteOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>

      {draft ? (
        <AdjustmentDialog
          draft={draft}
          projects={initial.projects}
          busy={busy}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={t('deleteTitle')}
        confirmLabel={t('delete')}
        danger
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove(removing)}
      >
        {removing ? (
          <Typography variant="body2">
            {t('deleteBody', {
              metric: t(`metrics.${removing.metric}`),
              amount: signed(removing.amount),
              project: projectName.get(removing.projectId) ?? removing.projectId,
            })}
          </Typography>
        ) : null}
      </ConfirmDialog>
      {toast.element}
    </Stack>
  )
}

function AdjustmentDialog({
  draft,
  projects,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft
  projects: AdjustmentsOverview['projects']
  busy: boolean
  onChange: (draft: Draft) => void
  onCancel: () => void
  onSave: (input: AdjustmentInput) => void
}) {
  const t = useTranslations('adjustments')
  const tc = useTranslations('common')
  const locale = useLocale()
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value })

  const span = spanOf(draft)
  const amount = Number(draft.amount || 0)
  const days = span ? daysBetween(span.startOn, span.endOn).length : 0
  const spread: AdjustmentSpread = days === 1 ? 'total' : draft.spread
  const valid = Boolean(draft.projectId && span && amount > 0)
  const byDay = valid && span ? amountsByDay({ metric: draft.metric, amount: draft.sign * amount, spread, startOn: span.startOn, endOn: span.endOn }) : null
  const total = byDay ? [...byDay.values()].reduce((a, b) => a + b, 0) : 0
  const first = byDay ? (byDay.values().next().value ?? 0) : 0
  const money = (value: number) => `${value < 0 ? '−' : '+'}${formatMoney(Math.abs(value), locale)}`
  const grouped = draft.amount ? new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(amount) : ''

  const submit = () => {
    if (!valid || !span) return
    onSave({
      id: draft.id,
      projectId: draft.projectId,
      metric: draft.metric,
      amount: draft.sign * amount,
      spread,
      startOn: span.startOn,
      endOn: span.endOn,
      note: draft.note.trim() || null,
    })
  }

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{draft.id ? t('editTitle') : t('addTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 1 }}>
          <TextField select label={t('project')} value={draft.projectId} onChange={(e) => set('projectId', e.target.value)} fullWidth>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField select label={t('metric')} value={draft.metric} onChange={(e) => set('metric', e.target.value as AdjustmentMetric)} fullWidth>
            {ADJUSTMENT_METRICS.map((m) => (
              <MenuItem key={m} value={m}>
                {t(`metrics.${m}`)}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <ToggleButtonGroup exclusive size="small" color={draft.sign > 0 ? 'success' : 'error'} value={draft.sign} onChange={(_e, v) => v && set('sign', v)}>
              <ToggleButton value={1} sx={{ px: 2 }}>
                {t('plus')}
              </ToggleButton>
              <ToggleButton value={-1} sx={{ px: 2 }}>
                {t('minus')}
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              label={t('amount')}
              value={grouped}
              onChange={(e) => set('amount', e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 15))}
              fullWidth
              slotProps={{
                htmlInput: { inputMode: 'numeric' },
                input: { endAdornment: <InputAdornment position="end">₫</InputAdornment> },
              }}
            />
          </Stack>

          <Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              {t('periodLabel')}
            </Typography>
            <ToggleButtonGroup exclusive size="small" value={draft.kind} onChange={(_e, v) => v && set('kind', v)} sx={{ flexWrap: 'wrap', mb: 1.5 }}>
              {(['day', 'month', 'year', 'range'] as const).map((kind) => (
                <ToggleButton key={kind} value={kind} sx={{ px: 2 }}>
                  {t(`kinds.${kind}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {draft.kind === 'day' ? <DateField label={t('day')} value={draft.day} onChange={(v) => set('day', v)} fullWidth /> : null}
            {draft.kind === 'month' ? (
              <Stack direction="row" spacing={1.5}>
                <TextField select label={t('month')} value={draft.month} onChange={(e) => set('month', e.target.value)} sx={{ flex: 1 }}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <MenuItem key={i + 1} value={String(i + 1)}>
                      {t('monthName', { n: i + 1 })}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label={t('year')}
                  value={draft.year}
                  onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                  sx={{ flex: 1 }}
                />
              </Stack>
            ) : null}
            {draft.kind === 'year' ? (
              <TextField
                label={t('year')}
                value={draft.year}
                onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                fullWidth
              />
            ) : null}
            {draft.kind === 'range' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <DateField label={t('from')} value={draft.from} onChange={(v) => set('from', v)} max={draft.to || undefined} fullWidth />
                <DateField label={t('to')} value={draft.to} onChange={(v) => set('to', v)} min={draft.from || undefined} fullWidth />
              </Stack>
            ) : null}
          </Box>

          {days > 1 ? (
            <Box>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                {t('spreadLabel')}
              </Typography>
              <ToggleButtonGroup exclusive size="small" value={draft.spread} onChange={(_e, v) => v && set('spread', v)} sx={{ flexWrap: 'wrap' }}>
                <ToggleButton value="total" sx={{ px: 2 }}>
                  {t('spreadTotal')}
                </ToggleButton>
                <ToggleButton value="daily" sx={{ px: 2 }}>
                  {t('spreadDaily')}
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          ) : null}

          <TextField
            label={t('note')}
            placeholder={t('notePlaceholder')}
            value={draft.note}
            onChange={(e) => set('note', e.target.value.slice(0, 500))}
            fullWidth
            multiline
            minRows={2}
          />

          {byDay && span ? (
            <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1 }}>
                <Chip size="small" color={draft.sign > 0 ? 'success' : 'error'} label={money(total)} />
                <Typography variant="body2">
                  {t('preview', {
                    days,
                    perDay: money(days > 1 && spread === 'total' ? Math.round(total / days) : first),
                    metric: t(`metrics.${draft.metric}`),
                  })}
                </Typography>
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          {tc('cancel')}
        </Button>
        <Button variant="contained" onClick={submit} disabled={!valid || busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {tc('save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
