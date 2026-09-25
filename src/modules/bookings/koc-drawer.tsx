'use client'

import { useEffect, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddOutlined from '@mui/icons-material/AddOutlined'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined'
import { formatCompact, formatMoney, initialsOf } from '@/core/utils/format'
import { updateKoc } from '@/features/bookings/actions'
import type { BookingListRow } from '@/features/bookings/queries'
import { KOC_TIER_RANGES, KOC_TIERS } from './fields'
import { Section } from './form-parts'

/** A KOC as the booking data knows them: their details and every booking of theirs, newest first. */
export type KocProfile = {
  handle: string
  name: string
  contact: string
  /** Their size class, from their latest booking that has one. */
  tier: string
  rows: BookingListRow[]
  /** Not cancelled. */
  bookings: number
  aired: number
  pending: number
  spent: number
  lastOn: string | null
}

/** Every KOC in the booking data, by handle; rows come newest booking first, and so do each KOC's. */
export function kocProfiles(rows: BookingListRow[]): Map<string, KocProfile> {
  const out = new Map<string, KocProfile>()
  for (const row of rows) {
    let own = out.get(row.kocHandle)
    if (!own) out.set(row.kocHandle, (own = { handle: row.kocHandle, name: '', contact: '', tier: '', rows: [], bookings: 0, aired: 0, pending: 0, spent: 0, lastOn: null }))
    own.rows.push(row)
    own.name ||= row.kocName ?? ''
    own.contact ||= row.kocContact ?? ''
    own.tier ||= row.kocTier ?? ''
    if (row.status === 'cancelled') continue
    own.bookings += 1
    own.spent += row.cost
    own.lastOn ??= row.bookedOn
    if (row.status === 'aired') own.aired += 1
    else own.pending += 1
  }
  return out
}

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
const STATUS_COLOR = { pending: 'warning', aired: 'success', cancelled: 'default' } as const

/**
 * One KOC at a glance, beside the list: who they are and how to reach them,
 * what they have been booked for and paid, and each of their bookings — a
 * click away from editing it, or booking them again.
 *
 * Name, contact and size class (tier) belong to the KOC, not to one booking:
 * correcting them here corrects every booking of theirs. Saving is offered
 * only once they differ from what is stored.
 */
export function KocDrawer({
  projectId,
  profile,
  campaignName,
  canEdit,
  onClose,
  onEditBooking,
  onBookAgain,
  onSaved,
}: {
  projectId: string
  profile: KocProfile | null
  campaignName: Map<string, string>
  canEdit: boolean
  onClose: () => void
  onEditBooking: (row: BookingListRow) => void
  onBookAgain: (handle: string) => void
  onSaved: (message: string) => void
}) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [tier, setTier] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    setName(profile?.name ?? '')
    setContact(profile?.contact ?? '')
    setTier(profile?.tier ?? '')
    setError(null)
  }, [profile?.handle, profile?.name, profile?.contact, profile?.tier])

  const dirty = Boolean(profile) && (name.trim() !== profile!.name || contact.trim() !== profile!.contact || tier.trim() !== profile!.tier)

  function save() {
    if (!profile || !dirty) return
    startTransition(async () => {
      const result = await updateKoc(projectId, profile.handle, { name, contact, tier })
      if (!result.ok) {
        setError(t(`actionErrors.${result.message ?? 'server'}`))
        return
      }
      onSaved(t('koc.saved', { count: profile.rows.length }))
    })
  }

  const average = profile && profile.bookings > 0 ? Math.round(profile.spent / profile.bookings) : 0
  const stats = profile
    ? [
        { label: t('koc.bookings'), value: String(profile.bookings) },
        { label: t('koc.aired'), value: String(profile.aired) },
        { label: t('koc.pending'), value: String(profile.pending) },
        { label: t('koc.spent'), value: formatCompact(profile.spent, locale) },
        { label: t('koc.average'), value: formatCompact(average, locale) },
        { label: t('koc.last'), value: profile.lastOn ? dmy(profile.lastOn) : '—' },
      ]
    : []

  return (
    <Drawer anchor="right" open={Boolean(profile)} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } } } }}>
      {profile ? (
        <Stack sx={{ height: '100%' }}>
          <Stack direction="row" spacing={1.5} sx={{ p: 2, alignItems: 'center' }}>
            <Avatar sx={{ width: 48, height: 48, bgcolor: 'primary.main' }}>{initialsOf(profile.name || profile.handle)}</Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="h6" noWrap>
                {profile.name || `@${profile.handle}`}
              </Typography>
              <Link href={`https://www.tiktok.com/@${profile.handle}`} target="_blank" rel="noreferrer" underline="hover" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                @{profile.handle}
                <OpenInNewOutlined sx={{ fontSize: 14 }} />
              </Link>
            </Box>
            <IconButton aria-label={t('close')} onClick={onClose}>
              <CloseOutlined />
            </IconButton>
          </Stack>
          <Divider />

          <Stack spacing={3} sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
            <Section title={t('koc.details')}>
              {error ? (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                  {error}
                </Alert>
              ) : null}
              <Stack spacing={1.5}>
                <TextField size="small" fullWidth label={t('fields.kocName')} value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} />
                <TextField
                  size="small"
                  fullWidth
                  label={t('fields.kocContact')}
                  placeholder="0912 345 678"
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  disabled={!canEdit}
                  slotProps={{
                    input: {
                      endAdornment: profile.contact ? (
                        <Tooltip title={copied ? t('koc.copied') : t('koc.copy')}>
                          <IconButton
                            size="small"
                            onClick={() => {
                              void navigator.clipboard.writeText(profile.contact)
                              setCopied(true)
                              setTimeout(() => setCopied(false), 1500)
                            }}
                          >
                            <ContentCopyOutlined sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      ) : undefined,
                    },
                  }}
                />
                <Autocomplete
                  freeSolo
                  disabled={!canEdit}
                  options={[...KOC_TIERS] as string[]}
                  inputValue={tier}
                  onInputChange={(_event, value) => setTier(value)}
                  renderOption={(props, option) => (
                    <li {...props} key={option}>
                      {option}
                      <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                        {t('tier.followers', { range: KOC_TIER_RANGES[option as (typeof KOC_TIERS)[number]] ?? '' })}
                      </Typography>
                    </li>
                  )}
                  renderInput={(params) => <TextField {...params} size="small" label={t('fields.kocTier')} placeholder={t('tier.placeholder')} />}
                />
                {canEdit && dirty ? (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
                      {t('koc.appliesToAll', { count: profile.rows.length })}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => {
                        setName(profile.name)
                        setContact(profile.contact)
                        setTier(profile.tier)
                      }}
                      disabled={pending}
                    >
                      {t('cancel')}
                    </Button>
                    <Button size="small" variant="contained" onClick={save} disabled={pending}>
                      {t('saveChanges')}
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            </Section>

            <Section title={t('koc.overview')}>
              <Grid container spacing={1}>
                {stats.map((stat) => (
                  <Grid key={stat.label} size={4}>
                    <Box sx={{ p: 1.25, borderRadius: 1, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} noWrap>
                        {stat.label}
                      </Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {stat.value}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Section>

            <Section title={t('koc.history', { count: profile.rows.length })}>
              <List disablePadding sx={{ mx: -1 }}>
                {profile.rows.map((row) => (
                  <ListItemButton key={row.id} disabled={!canEdit} onClick={() => onEditBooking(row)} sx={{ borderRadius: 1, px: 1, opacity: row.status === 'cancelled' ? 0.55 : 1 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {`${row.code} · ${row.campaignId ? campaignName.get(row.campaignId) : t('noCampaign')}`}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {[t('bookedOnShort', { date: dmy(row.bookedOn) }), row.airedOn ? t('airedShort', { date: dmy(row.airedOn) }) : null, row.product].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                    <Stack spacing={0.5} sx={{ alignItems: 'flex-end', ml: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(row.cost, locale)}
                      </Typography>
                      <Chip size="small" variant="outlined" color={STATUS_COLOR[row.status]} label={t(`status.${row.status}`)} />
                    </Stack>
                  </ListItemButton>
                ))}
              </List>
            </Section>
          </Stack>

          {canEdit ? (
            <>
              <Divider />
              <Box sx={{ p: 2 }}>
                <Button fullWidth variant="contained" startIcon={<AddOutlined />} onClick={() => onBookAgain(profile.handle)}>
                  {t('koc.bookAgain')}
                </Button>
              </Box>
            </>
          ) : null}
        </Stack>
      ) : null}
    </Drawer>
  )
}
