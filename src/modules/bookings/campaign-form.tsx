'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { formatMoney } from '@/core/utils/format'
import { deleteCampaign, saveCampaign } from '@/features/bookings/actions'
import type { CampaignListRow } from '@/features/bookings/queries'
import { shiftDay, vnDate } from '@/modules/analytics/period'
import { CAMPAIGN_STATUSES, normalizeCampaign, type CampaignDraft, type CampaignField, type CampaignIssue } from './campaigns'
import { parseMoney } from './fields'
import { AutoMark, QuickChips, Section } from './form-parts'

const blank = (): CampaignDraft => ({
  name: '',
  product: '',
  defaultCost: '',
  startOn: vnDate(new Date()),
  endOn: '',
  budget: '',
  targetVideos: '',
  status: 'active',
  note: '',
})

const draftOf = (row: CampaignListRow): CampaignDraft => ({
  name: row.name,
  product: row.product ?? '',
  defaultCost: row.defaultCost === null ? '' : String(row.defaultCost),
  startOn: row.startOn,
  endOn: row.endOn ?? '',
  budget: row.budget === null ? '' : String(row.budget),
  targetVideos: row.targetVideos === null ? '' : String(row.targetVideos),
  status: row.status,
  note: row.note ?? '',
})

/** The last day of the month a day falls in. */
const monthEnd = (day: string) => {
  const [year, month] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

/** A campaign form as it would be saved: surrounding spaces and a sum's spelling (50tr = 50000000) make no change. */
const draftKey = (draft: CampaignDraft) =>
  JSON.stringify(Object.entries(draft).map(([key, value]) => [key, key === 'budget' || key === 'defaultCost' ? (parseMoney(value) ?? value.trim()) : value.trim()]))

const FEES = [500_000, 1_000_000, 1_500_000, 2_000_000]
const BUDGETS = [10_000_000, 20_000_000, 50_000_000, 100_000_000]

/**
 * Creating or editing a booking campaign, every field in sight, grouped by
 * what it is for: the campaign itself; when it runs; what it fills in for
 * each booking added to it (the product, the usual fee); and what it is
 * tracked against (its budget, the videos it should put on air).
 *
 * Only the name is needed — it starts today by default — and common values
 * are a tap away: an end date a week or a month out, usual fees and budgets.
 * With a fee and a budget, the form says how many videos the budget buys, and
 * offers it as the target.
 */
export function CampaignForm({
  projectId,
  open,
  editing,
  products,
  bookingCount,
  onClose,
  onSaved,
}: {
  projectId: string
  open: boolean
  editing: CampaignListRow | null
  products: string[]
  /** Bookings in the campaign being edited, said before it is deleted. */
  bookingCount: number
  onClose: () => void
  onSaved: (message: string, campaignId: string | null) => void
}) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  const [draft, setDraft] = useState<CampaignDraft>(blank)
  const [touched, setTouched] = useState(false)
  const [serverIssues, setServerIssues] = useState<CampaignIssue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** The campaign being edited as it was opened; saving is offered once the form differs from it. */
  const [initial, setInitial] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setDraft(editing ? draftOf(editing) : blank())
    setInitial(editing ? draftKey(draftOf(editing)) : null)
    setTouched(false)
    setServerIssues([])
    setError(null)
    setConfirmDelete(false)
  }, [open, editing])

  const checked = useMemo(() => normalizeCampaign(draft), [draft])
  const dirty = !editing || draftKey(draft) !== initial
  const issues = touched ? [...checked.issues, ...serverIssues.filter((i) => i.code === 'duplicateName')] : serverIssues
  const issueOf = (field: CampaignField) => issues.find((issue) => issue.field === field)
  const set = (field: CampaignField) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    if (field === 'name') setServerIssues([])
  }

  const fee = parseMoney(draft.defaultCost)
  const budget = parseMoney(draft.budget)
  /** Videos the budget pays for at the usual fee — offered as the target. */
  const affordable = fee && budget ? Math.floor(budget / fee) : null

  const moneyHelp = (value: number | null, raw: string, help: string) => (value !== null && raw.trim() ? `= ${formatMoney(value, locale)}` : help)

  const field = (key: CampaignField, props: Partial<React.ComponentProps<typeof TextField>> = {}) => {
    const issue = issueOf(key)
    return (
      <TextField
        fullWidth
        size="small"
        label={t(`campaign.fields.${key}`)}
        value={draft[key]}
        onChange={(event) => set(key)(event.target.value)}
        error={Boolean(issue)}
        {...props}
        helperText={issue ? t(`campaignErrors.${issue.code}`) : props.helperText}
      />
    )
  }
  const moneyChips = (key: 'defaultCost' | 'budget', values: number[]) => (
    <QuickChips options={values.map((value) => ({ label: formatMoney(value, locale), value: String(value) }))} current={String(parseMoney(draft[key]) ?? '')} onPick={set(key)} />
  )

  function submit() {
    setTouched(true)
    if (!checked.value) return
    startTransition(async () => {
      const result = await saveCampaign(projectId, editing?.id ?? null, draft)
      if (!result.ok) {
        setServerIssues(result.issues ?? [])
        setError(result.message === 'validation' ? null : t(`actionErrors.${result.message ?? 'server'}`))
        return
      }
      onSaved(editing ? t('campaign.updated') : t('campaign.created'), result.campaignId ?? null)
      onClose()
    })
  }

  function remove() {
    if (!editing) return
    startTransition(async () => {
      const result = await deleteCampaign(projectId, editing.id)
      if (!result.ok) {
        setError(t(`actionErrors.${result.message ?? 'server'}`))
        return
      }
      onSaved(t('campaign.deleted'), null)
      onClose()
    })
  }

  const start = draft.startOn || vnDate(new Date())

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{editing ? t('campaign.editTitle') : t('campaign.addTitle')}</DialogTitle>
      <DialogContent
        dividers
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && dirty) submit()
        }}
      >
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Stack spacing={3}>
          <Section title={t('campaign.sectionMain')}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: editing ? 8 : 12 }}>
                {field('name', { required: true, autoFocus: true, placeholder: t('campaign.namePlaceholder') })}
              </Grid>
              {editing ? (
                <Grid size={{ xs: 12, sm: 4 }}>
                  {field('status', {
                    select: true,
                    children: CAMPAIGN_STATUSES.map((status) => (
                      <MenuItem key={status} value={status}>
                        {t(`campaign.status.${status}`)}
                      </MenuItem>
                    )),
                  })}
                </Grid>
              ) : null}
            </Grid>
          </Section>

          <Section title={t('campaign.sectionDates')}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>{field('startOn', { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } })}</Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('endOn', { type: 'date', slotProps: { inputLabel: { shrink: true } }, helperText: draft.endOn ? undefined : t('campaign.help.endOn') })}
                <QuickChips
                  options={[
                    { label: t('campaign.plus7'), value: shiftDay(start, 6) },
                    { label: t('campaign.plus30'), value: shiftDay(start, 29) },
                    { label: t('campaign.monthEnd'), value: monthEnd(start) },
                  ]}
                  current={draft.endOn}
                  onPick={set('endOn')}
                />
              </Grid>
            </Grid>
          </Section>

          <Section title={t('campaign.sectionDefaults')}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Autocomplete
                  freeSolo
                  options={products}
                  inputValue={draft.product}
                  onInputChange={(_event, value) => set('product')(value)}
                  renderInput={(params) => <TextField {...params} size="small" label={t('campaign.fields.product')} helperText={t('campaign.help.product')} />}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('defaultCost', { placeholder: '1tr5', helperText: moneyHelp(fee, draft.defaultCost, t('campaign.help.defaultCost')) })}
                {moneyChips('defaultCost', FEES)}
              </Grid>
            </Grid>
          </Section>

          <Section title={t('campaign.sectionTargets')}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('budget', { placeholder: '50tr', helperText: moneyHelp(budget, draft.budget, t('campaign.help.budget')) })}
                {moneyChips('budget', BUDGETS)}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                {field('targetVideos', {
                  inputMode: 'numeric',
                  helperText: affordable !== null ? <AutoMark>{t('campaign.affordable', { count: affordable })}</AutoMark> : t('campaign.help.targetVideos'),
                } as never)}
                {affordable ? <QuickChips options={[{ label: t('campaign.useAffordable', { count: affordable }), value: String(affordable) }]} current={draft.targetVideos} onPick={set('targetVideos')} /> : null}
              </Grid>
              <Grid size={12}>{field('note', { multiline: true, minRows: 2 })}</Grid>
            </Grid>
          </Section>
        </Stack>

        {confirmDelete ? (
          <Alert
            severity="warning"
            sx={{ mt: 2 }}
            action={
              <Button color="error" size="small" onClick={remove} disabled={pending}>
                {t('delete')}
              </Button>
            }
          >
            {t('campaign.deleteBody', { count: bookingCount })}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {editing ? (
          <Button color="error" onClick={() => setConfirmDelete(true)} disabled={pending} sx={{ mr: 'auto' }}>
            {t('campaign.delete')}
          </Button>
        ) : null}
        {editing && !dirty ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', mr: 1 }}>
            {t('noChanges')}
          </Typography>
        ) : null}
        <Button onClick={onClose} disabled={pending}>
          {dirty ? t('cancel') : t('close')}
        </Button>
        {dirty ? (
          <Button variant="contained" onClick={submit} disabled={pending}>
            {editing ? t('saveChanges') : t('campaign.create')}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
