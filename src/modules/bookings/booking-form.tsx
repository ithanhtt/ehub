'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import { formatMoney, formatNumber } from '@/core/utils/format'
import { TableScroll } from '@/components/ui/table-scroll'
import { importBookings, saveBooking } from '@/features/bookings/actions'
import type { BookingListRow, CampaignListRow } from '@/features/bookings/queries'
import { shiftDay, vnDate } from '@/modules/analytics/period'
import { videoKey } from '@/modules/analytics/shared/keys'
import { campaignKey } from './campaigns'
import { BOOKING_STATUSES, KOC_TIER_RANGES, KOC_TIERS, normalizeBooking, parseMoney, postedOnOfVideo, withCampaignDefaults, type BookingField, type RawBooking } from './fields'
import { AutoMark, QuickChips, Section } from './form-parts'
import { DateField } from '@/components/ui/date-field'
import { parseQuickLines, repeatedVideos } from './quick-entry'

/** A KOC already booked: filled in when booked again, with what they were paid last. */
export type KocSuggestion = { handle: string; name: string; contact: string; tier: string; lastCost: number | null; lastOn: string | null }

/** Fees one tap away, after the campaign's usual fee and the KOC's last one. */
const QUICK_COSTS = [500_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000]

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** What was typed in the form's own fields; blank means "work it out" where the form can. */
type Details = {
  koc: string
  kocName: string
  kocContact: string
  kocTier: string
  product: string
  bookedOn: string
  plannedAirOn: string
  airedOn: string
  status: string
  note: string
  /** Results typed by the booker; blank leaves them to the sync. */
  resultOrders: string
  resultRevenue: string
}

/** The form's fields together, to tell an edited booking from the one that was opened. */
type Snapshot = { target: string; campaign: string; cost: string; details: Details }

/** Fields compared as they would be saved: surrounding spaces and a cost's spelling (1tr5 = 1500000) make no change. */
const snapshotKey = ({ target, campaign, cost, details }: Snapshot) =>
  JSON.stringify([target.trim(), campaign.trim(), parseMoney(cost) ?? cost.trim(), Object.entries(details).map(([key, value]) => [key, value.trim()])])

const noDetails = (): Details => ({
  koc: '',
  kocName: '',
  kocContact: '',
  kocTier: '',
  product: '',
  bookedOn: '',
  plannedAirOn: '',
  airedOn: '',
  status: '',
  note: '',
  resultOrders: '',
  resultRevenue: '',
})

/**
 * Adding bookings, or editing one — every field in sight, grouped as a booker
 * thinks of them (the KOC; the booking; its dates and status), and filled in
 * wherever the form can work the value out:
 *
 *   - a video link gives the KOC and the day it aired (fields.ts), and the
 *     booking date follows the air date, or today while it has not aired;
 *   - a KOC booked before brings their name, contact, tier and last fee;
 *   - the campaign brings its product and usual fee.
 *
 * A worked-out value shows in its field, marked as automatic, and typing over
 * it is all it takes to change it; clearing the field hands it back to the
 * form. Several lines pasted into the link box add one booking per line, the
 * fields then applying to them all. Every row is checked against the standard
 * as it is typed, and the server checks it again.
 *
 * The results (orders, revenue) are left blank to be synced from TikTok Shop
 * — the synced figures show beside the fields; typing a figure makes it the
 * booker's own, which no sync overwrites, and clearing it hands it back.
 */
export function BookingForm({
  projectId,
  open,
  editing,
  campaigns,
  defaultCampaignId,
  presetKoc = null,
  kocs,
  products,
  onClose,
  onSaved,
}: {
  projectId: string
  open: boolean
  /** The booking being edited; null to add. */
  editing: BookingListRow | null
  campaigns: CampaignListRow[]
  /** The campaign the page is showing: new bookings go into it. */
  defaultCampaignId: string | null
  /** A KOC to book again: their handle starts the form, and their details and last fee follow. */
  presetKoc?: string | null
  kocs: KocSuggestion[]
  products: string[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  const today = vnDate(new Date())
  const [target, setTarget] = useState('')
  const [campaign, setCampaign] = useState('')
  const [cost, setCost] = useState('')
  const [details, setDetails] = useState<Details>(noDetails)
  /** Fees changed on one line of a pasted list. */
  const [fees, setFees] = useState<Record<number, string>>({})
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const targetInput = useRef<HTMLInputElement>(null)
  /** The booking being edited as it was opened; saving is offered once the form differs from it. */
  const [initial, setInitial] = useState<string | null>(null)

  const campaignByName = (name: string) => campaigns.find((c) => campaignKey(c.name) === campaignKey(name)) ?? null

  useEffect(() => {
    if (!open) return
    if (editing) {
      const manual = editing.resultSource === 'manual'
      const start: Snapshot = {
        target: editing.videoUrl ?? '',
        campaign: campaigns.find((c) => c.id === editing.campaignId)?.name ?? '',
        cost: String(editing.cost),
        details: {
          koc: editing.kocHandle,
          kocName: editing.kocName ?? '',
          kocContact: editing.kocContact ?? '',
          kocTier: editing.kocTier ?? '',
          product: editing.product ?? '',
          bookedOn: editing.bookedOn,
          plannedAirOn: editing.plannedAirOn ?? '',
          airedOn: editing.airedOn ?? '',
          status: editing.status,
          note: editing.note ?? '',
          resultOrders: manual && editing.resultOrders !== null ? String(editing.resultOrders) : '',
          resultRevenue: manual && editing.resultRevenue !== null ? String(editing.resultRevenue) : '',
        },
      }
      setTarget(start.target)
      setCampaign(start.campaign)
      setCost(start.cost)
      setDetails(start.details)
      setInitial(snapshotKey(start))
    } else {
      setInitial(null)
      const own = campaigns.find((c) => c.id === defaultCampaignId) ?? null
      setTarget('')
      setCampaign(own?.name ?? '')
      setCost(own?.defaultCost ? String(own.defaultCost) : '')
      setDetails({ ...noDetails(), koc: presetKoc ?? '', product: own?.product ?? '' })
    }
    setFees({})
    setTouched(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the dialog opens, not on every list change
  }, [open, editing, defaultCampaignId, presetKoc])

  const dirty = !editing || snapshotKey({ target, campaign, cost, details }) !== initial

  const chosen = campaignByName(campaign)
  const isNewCampaign = Boolean(campaign.trim()) && !chosen
  const lines = useMemo(() => parseQuickLines(target), [target])
  const many = !editing && lines.length > 1

  /* ---------------------------------------------- what the form works out --- */

  const line = many ? undefined : lines[0]
  const video = line?.raw.videoUrl ? videoKey(line.raw.videoUrl) : ''
  const auto = {
    koc: line?.raw.koc ? String(line.raw.koc) : '',
    airedOn: postedOnOfVideo(video) ?? '',
  }
  const kocShown = details.koc || auto.koc
  const airedShown = details.airedOn || auto.airedOn
  const bookedShown = details.bookedOn || airedShown || today

  /** One booking of a pasted list: the line's own KOC, video and fee; the shared fields for the rest. */
  const listRow = (own: (typeof lines)[number]): RawBooking => {
    const posted = postedOnOfVideo(own.raw.videoUrl ? videoKey(own.raw.videoUrl) : '')
    return withCampaignDefaults(
      {
        campaign,
        product: details.product,
        bookedOn: details.bookedOn || posted || today,
        ...own.raw,
        cost: fees[own.line] ?? own.raw.cost ?? cost,
      },
      chosen,
    )
  }

  const single: RawBooking | null = many
    ? null
    : withCampaignDefaults(
        {
          campaign,
          koc: kocShown,
          kocName: details.kocName,
          kocContact: details.kocContact,
          kocTier: details.kocTier,
          videoUrl: line?.raw.videoUrl ?? '',
          product: details.product,
          cost: cost || line?.raw.cost,
          bookedOn: bookedShown,
          plannedAirOn: details.plannedAirOn,
          airedOn: details.airedOn,
          status: details.status,
          note: details.note,
          resultOrders: details.resultOrders,
          resultRevenue: details.resultRevenue,
        },
        chosen,
      )
  const singleCheck = single ? normalizeBooking(single) : null
  const singleValue = singleCheck?.value ?? null
  const issueOf = (field: BookingField) => (touched ? singleCheck?.issues.find((issue) => issue.field === field) : undefined)
  const issueText = (field: BookingField) => {
    const issue = issueOf(field)
    return issue ? t(`errors.${issue.code}`) : undefined
  }

  const repeated = useMemo(() => repeatedVideos(lines), [lines])
  const list = many
    ? lines.map((own) => {
        const raw = listRow(own)
        return { line: own, raw, ...normalizeBooking(raw), repeated: repeated.has(own.line) }
      })
    : []
  const ready = list.filter((row) => row.value && !row.repeated)

  // A KOC seen before brings their name, contact and last fee to fields still blank.
  const known = kocs.find((k) => k.handle === kocShown.replace(/^@/, '').toLowerCase()) ?? null
  useEffect(() => {
    if (editing || many || !known) return
    setDetails((current) => ({ ...current, kocName: current.kocName || known.name, kocContact: current.kocContact || known.contact, kocTier: current.kocTier || known.tier }))
    if (!cost && known.lastCost) setCost(String(known.lastCost))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the KOC changes
  }, [known?.handle])

  function pickCampaign(name: string) {
    const previous = chosen
    const next = campaignByName(name)
    setCampaign(name)
    // The old campaign's fee and product give way to the new one's; anything typed stays.
    if (!cost || cost === String(previous?.defaultCost ?? '')) setCost(next?.defaultCost ? String(next.defaultCost) : '')
    if (!details.product || details.product === previous?.product) setDetails((d) => ({ ...d, product: next?.product ?? '' }))
  }

  const set = (key: keyof Details) => (value: string) => setDetails((d) => ({ ...d, [key]: value }))

  function submit(another: boolean) {
    setTouched(true)
    if (many) {
      if (ready.length === 0) return
      startTransition(async () => {
        const result = await importBookings(projectId, ready.map((row) => row.raw), campaign.trim() || null)
        if (!result.ok) {
          setError(t(`actionErrors.${result.message ?? 'server'}`))
          return
        }
        onSaved(t('import.done', { inserted: result.inserted, updated: result.updated }))
        onClose()
      })
      return
    }
    if (!single || !singleValue) return
    startTransition(async () => {
      const result = await saveBooking(projectId, editing?.id ?? null, single)
      if (!result.ok) {
        setError(t(`actionErrors.${result.message ?? 'server'}`))
        return
      }
      onSaved(editing ? t('updated') : t('added'))
      if (another) {
        // The next booking is most likely for the same campaign, fee and product.
        setTarget('')
        setDetails((d) => ({ ...noDetails(), product: d.product }))
        setFees({})
        setTouched(false)
        targetInput.current?.focus()
      } else onClose()
    })
  }

  /* --------------------------------------------------------------- parts --- */

  const parsedCost = parseMoney(cost)
  const costChips = [
    ...(chosen?.defaultCost ? [chosen.defaultCost] : []),
    ...(known?.lastCost && known.lastCost !== chosen?.defaultCost ? [known.lastCost] : []),
    ...QUICK_COSTS,
  ]
    .filter((value, i, all) => all.indexOf(value) === i)
    .map((value) => ({ label: formatMoney(value, locale), value: String(value) }))
  const dayChips = [
    { label: t('form.today'), value: today },
    { label: t('form.yesterday'), value: shiftDay(today, -1) },
  ]
  const autoMark = (text: string) => <AutoMark>{text}</AutoMark>

  const text = (key: keyof Details & BookingField, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField
      fullWidth
      size="small"
      label={t(`fields.${key}`)}
      value={details[key]}
      onChange={(event) => set(key)(event.target.value)}
      error={Boolean(issueOf(key))}
      {...props}
      helperText={issueText(key) ?? props.helperText}
    />
  )

  const costField = (
    <Box>
      <TextField
        fullWidth
        size="small"
        required={!many}
        label={many ? t('form.sharedCost') : t('fields.cost')}
        placeholder="1tr5"
        value={cost}
        onChange={(event) => setCost(event.target.value)}
        error={Boolean(issueOf('cost'))}
        helperText={
          issueText('cost') ??
          (parsedCost !== null && cost.trim()
            ? `= ${formatMoney(parsedCost, locale)}`
            : many
              ? t('form.sharedCostHelp')
              : known?.lastCost
                ? t('form.lastBooked', { cost: formatMoney(known.lastCost, locale), date: known.lastOn ? dmy(known.lastOn) : '' })
                : t('help.cost'))
        }
      />
      <QuickChips options={costChips} current={parsedCost !== null ? String(parsedCost) : ''} onPick={setCost} />
    </Box>
  )

  const campaignField = (
    <Autocomplete
      freeSolo
      options={campaigns.filter((c) => c.status === 'active' || c.name === campaign).map((c) => c.name)}
      inputValue={campaign}
      onInputChange={(_event, value) => pickCampaign(value)}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={t('fields.campaign')}
          placeholder={t('form.campaignPlaceholder')}
          helperText={isNewCampaign ? t('form.newCampaign', { name: campaign.trim() }) : t('form.campaignHelp')}
        />
      )}
    />
  )

  const productField = (
    <Autocomplete
      freeSolo
      options={products}
      inputValue={details.product}
      onInputChange={(_event, value) => set('product')(value)}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={t('fields.product')}
          error={Boolean(issueOf('product'))}
          helperText={issueText('product') ?? (chosen?.product && details.product === chosen.product ? autoMark(t('form.fromCampaign')) : t('help.product'))}
        />
      )}
    />
  )

  const bookedField = (
    <Box>
      <DateField
        fullWidth
        size="small"
        
        required={!many}
        label={t('fields.bookedOn')}
        value={many ? details.bookedOn : bookedShown}
        onChange={set('bookedOn')}
        error={Boolean(issueOf('bookedOn'))}
        helperText={issueText('bookedOn') ?? (details.bookedOn ? undefined : autoMark(many ? t('form.bookedOnMany') : airedShown ? t('form.bookedOnAired') : t('form.bookedOnToday')))}
      />
      <QuickChips options={dayChips} current={details.bookedOn} onPick={set('bookedOn')} />
    </Box>
  )

  const tierField = (
    <Autocomplete
      freeSolo
      options={[...KOC_TIERS] as string[]}
      inputValue={details.kocTier}
      onInputChange={(_event, value) => set('kocTier')(value)}
      renderOption={(props, option) => (
        <li {...props} key={option}>
          {option}
          <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
            {t('tier.followers', { range: KOC_TIER_RANGES[option as (typeof KOC_TIERS)[number]] ?? '' })}
          </Typography>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={t('fields.kocTier')}
          placeholder={t('tier.placeholder')}
          error={Boolean(issueOf('kocTier'))}
          helperText={issueText('kocTier') ?? (known?.tier && details.kocTier === known.tier ? autoMark(t('form.tierKnown')) : t('help.kocTier'))}
        />
      )}
    />
  )

  /** What the sync holds for the booking being edited, shown beside its empty result fields. */
  const synced = editing && editing.resultSource === 'tiktok' ? editing : null
  const parsedRevenue = parseMoney(details.resultRevenue)
  const resultFields = (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        {text('resultOrders', {
          placeholder: synced?.resultOrders != null ? String(synced.resultOrders) : undefined,
          slotProps: { htmlInput: { inputMode: 'numeric' } },
          helperText: details.resultOrders.trim()
            ? t('form.resultManual')
            : synced
              ? autoMark(t('form.resultSynced', { value: synced.resultOrders != null ? formatNumber(synced.resultOrders, locale) : '—' }))
              : t('help.resultOrders'),
        })}
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        {text('resultRevenue', {
          placeholder: synced?.resultRevenue != null ? String(synced.resultRevenue) : undefined,
          helperText: details.resultRevenue.trim()
            ? parsedRevenue !== null
              ? `= ${formatMoney(parsedRevenue, locale)} · ${t('form.resultManual')}`
              : undefined
            : synced
              ? autoMark(t('form.resultSynced', { value: synced.resultRevenue != null ? formatMoney(synced.resultRevenue, locale) : '—' }))
              : t('help.resultRevenue'),
        })}
      </Grid>
    </Grid>
  )

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} maxWidth="md" fullWidth>
      <Box
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && dirty) submit(!editing)
        }}
      >
        <DialogTitle>{editing ? `${t('editTitle')} · ${editing.code}` : t('addTitle')}</DialogTitle>
        <DialogContent dividers>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Stack spacing={3}>
            <TextField
              fullWidth
              multiline={!editing}
              minRows={1}
              maxRows={8}
              autoFocus={!editing && !presetKoc}
              inputRef={targetInput}
              label={editing ? t('fields.videoUrl') : t('form.target')}
              placeholder={editing ? 'https://www.tiktok.com/@…/video/74…' : t('form.targetPlaceholder')}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              error={Boolean(issueOf('videoUrl'))}
              helperText={issueText('videoUrl') ?? (many ? t('form.manyHint', { count: lines.length }) : editing ? t('form.videoEditHelp') : t('form.targetHelp'))}
            />

            {many ? (
              <>
                <Section title={t('form.sectionShared')}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>{campaignField}</Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>{productField}</Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>{costField}</Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>{bookedField}</Grid>
                  </Grid>
                </Section>
                <Section title={t('form.sectionList', { count: lines.length })}>
                  <TableScroll maxHeight={280}>
                    <Table size="small">
                      <TableBody>
                        {list.map((row) => (
                          <TableRow key={row.line.line} sx={row.value && !row.repeated ? undefined : { bgcolor: 'action.hover' }}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {row.value ? `@${row.value.kocHandle}` : String(row.raw.koc ?? row.line.text).slice(0, 40)}
                              </Typography>
                              <Typography variant="caption" sx={{ color: row.value && !row.repeated ? 'text.secondary' : 'error.main' }}>
                                {row.repeated
                                  ? t('form.repeated')
                                  : row.value
                                    ? row.value.airedOn
                                      ? t('form.airedOn', { date: dmy(row.value.airedOn) })
                                      : t('status.pending')
                                    : row.issues.map((issue) => `${t(`fields.${issue.field}`)}: ${t(`errors.${issue.code}`)}`).join('; ')}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ width: 150 }}>
                              <TextField
                                size="small"
                                variant="standard"
                                value={fees[row.line.line] ?? String(row.raw.cost ?? '')}
                                onChange={(event) => setFees((current) => ({ ...current, [row.line.line]: event.target.value }))}
                                helperText={row.value ? formatMoney(row.value.cost, locale) : undefined}
                              />
                            </TableCell>
                            <TableCell padding="checkbox">
                              <IconButton
                                size="small"
                                aria-label={t('delete')}
                                onClick={() => setTarget((current) => current.split(/\r?\n/).filter((_l, i) => i + 1 !== row.line.line).join('\n'))}
                              >
                                <CloseOutlined fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableScroll>
                </Section>
              </>
            ) : (
              <>
                <Section title={t('form.sectionKoc')}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Autocomplete
                        freeSolo
                        options={kocs}
                        filterOptions={(options, state) => {
                          const needle = state.inputValue.replace(/^@/, '').toLowerCase()
                          return options.filter((k) => k.handle.includes(needle) || k.name.toLowerCase().includes(needle)).slice(0, 50)
                        }}
                        getOptionLabel={(option) => (typeof option === 'string' ? option : option.handle)}
                        renderOption={(props, option) => (
                          <li {...props} key={option.handle}>
                            <Box>
                              <Typography variant="body2">
                                @{option.handle}
                                {option.name ? <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{` · ${option.name}`}</Typography> : null}
                              </Typography>
                              {option.lastCost ? (
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  {t('form.lastBooked', { cost: formatMoney(option.lastCost, locale), date: option.lastOn ? dmy(option.lastOn) : '' })}
                                </Typography>
                              ) : null}
                            </Box>
                          </li>
                        )}
                        inputValue={kocShown}
                        onInputChange={(_event, value, reason) => {
                          if (reason === 'input' || reason === 'clear') set('koc')(value)
                        }}
                        onChange={(_event, value) => set('koc')(typeof value === 'string' ? value : (value?.handle ?? ''))}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            size="small"
                            required
                            label={t('fields.koc')}
                            error={Boolean(issueOf('koc'))}
                            helperText={issueText('koc') ?? (!details.koc && auto.koc ? autoMark(t('form.fromLink')) : known ? t('form.knownKoc') : t('help.koc'))}
                          />
                        )}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>{text('kocName')}</Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>{text('kocContact', { placeholder: '0912 345 678' })}</Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>{tierField}</Grid>
                  </Grid>
                </Section>

                <Section title={t('form.sectionBooking')}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>{campaignField}</Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>{productField}</Grid>
                    <Grid size={12}>{costField}</Grid>
                  </Grid>
                </Section>

                <Section title={t('form.sectionDates')}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>{bookedField}</Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <DateField
                        fullWidth
                        size="small"
                        label={t('fields.plannedAirOn')}
                        value={details.plannedAirOn}
                        onChange={set('plannedAirOn')}
                        error={Boolean(issueOf('plannedAirOn'))}
                        helperText={issueText('plannedAirOn') ?? t('help.plannedAirOn')}
                      />
                      <QuickChips
                        options={[
                          { label: t('form.inDays', { days: 3 }), value: shiftDay(bookedShown, 3) },
                          { label: t('form.inDays', { days: 7 }), value: shiftDay(bookedShown, 7) },
                        ]}
                        current={details.plannedAirOn}
                        onPick={set('plannedAirOn')}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <DateField
                        fullWidth
                        size="small"
                        
                        label={t('fields.airedOn')}
                        value={airedShown}
                        onChange={set('airedOn')}
                        error={Boolean(issueOf('airedOn'))}
                        helperText={issueText('airedOn') ?? (details.airedOn ? undefined : auto.airedOn ? autoMark(t('form.airedFromVideo')) : t('help.airedOn'))}
                      />
                      <QuickChips options={dayChips} current={details.airedOn} onPick={set('airedOn')} />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      {text('status', {
                        select: true,
                        helperText: details.status ? undefined : autoMark(t('form.statusFollows')),
                        slotProps: { select: { displayEmpty: true }, inputLabel: { shrink: true } },
                        children: [
                          <MenuItem key="" value="">
                            {t('form.statusAuto', { status: t(`status.${singleValue?.status ?? (airedShown ? 'aired' : 'pending')}`) })}
                          </MenuItem>,
                          ...BOOKING_STATUSES.map((status) => (
                            <MenuItem key={status} value={status}>
                              {t(`status.${status}`)}
                            </MenuItem>
                          )),
                        ],
                      })}
                    </Grid>
                    <Grid size={12}>{text('note', { multiline: true, minRows: 2 })}</Grid>
                  </Grid>
                </Section>

                <Section title={t('form.sectionResults')}>{resultFields}</Section>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Typography variant="caption" sx={{ mr: 'auto', color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            {many
              ? t('form.manySummary', { ready: ready.length, total: formatMoney(ready.reduce((s, r) => s + (r.value?.cost ?? 0), 0), locale), skipped: list.length - ready.length })
              : dirty
                ? t('shortcut')
                : t('noChanges')}
          </Typography>
          <Button onClick={onClose} disabled={pending}>
            {dirty ? t('cancel') : t('close')}
          </Button>
          {editing || many ? null : (
            <Button variant="outlined" onClick={() => submit(true)} disabled={pending}>
              {t('saveAndAdd')}
            </Button>
          )}
          {dirty ? (
            <Button variant="contained" onClick={() => submit(false)} disabled={pending || (many && ready.length === 0)}>
              {many ? t('form.addMany', { count: ready.length }) : editing ? t('saveChanges') : t('save')}
            </Button>
          ) : null}
        </DialogActions>
      </Box>
    </Dialog>
  )
}
