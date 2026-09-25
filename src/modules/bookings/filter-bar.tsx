'use client'

import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import { DateField } from '@/components/ui/date-field'
import { dmy } from './booking-table'
import { KOC_TIER_RANGES, type KOC_TIERS } from './fields'
import { hasFilters, NO_TIER, SEARCH_MAX, type ListFilters } from './list'
import type { AirState } from './triage'

/** 2026-09 → 09/2026. */
const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`

/**
 * The list's filters in one bar: the quick views and a search on the first
 * line; the month, air state, KOC tier and booking dates on the second — each
 * menu offering only what the rows hold — and the filters in force as chips,
 * each removable, with "Xoá lọc" to drop them all.
 */
export function FilterBar({
  filters,
  onChange,
  query,
  onQuery,
  options,
  views,
  columnsButton,
}: {
  filters: ListFilters
  onChange: (next: ListFilters) => void
  /** The search as typed; saved into `filters` by the page a moment later. */
  query: string
  onQuery: (q: string) => void
  options: { months: string[]; tiers: string[]; air: AirState[] }
  /** The quick views (all, needs a hand, …), leading the first line. */
  views: React.ReactNode
  /** The column chooser, closing the second line. */
  columnsButton: React.ReactNode
}) {
  const t = useTranslations('bookings')
  const set = (part: Partial<ListFilters>) => onChange({ ...filters, ...part })
  const tierLabel = (tier: string) => (tier === NO_TIER ? t('filter.noTier') : tier)
  const airLabel = (state: AirState) => t(`airFilter.${state}`)

  /** A multi-choice menu: its options ticked, its box saying how many are chosen. */
  const multi = <T extends string>(label: string, chosen: readonly T[], all: readonly T[], labelOf: (value: T) => string, onPick: (next: T[]) => void, width: number, hint?: (value: T) => string) => (
    <TextField
      select
      size="small"
      label={label}
      value={chosen as T[]}
      onChange={(event) => onPick(event.target.value as unknown as T[])}
      disabled={all.length === 0}
      sx={{ width }}
      slotProps={{
        select: {
          multiple: true,
          renderValue: (value) => {
            const picked = value as T[]
            return picked.length === 1 ? labelOf(picked[0]) : t('filter.chosen', { count: picked.length })
          },
          MenuProps: { slotProps: { paper: { sx: { maxHeight: 360 } } } },
        },
      }}
    >
      {all.map((value) => (
        <MenuItem key={value} value={value} dense>
          <Checkbox size="small" checked={chosen.includes(value)} sx={{ p: 0.5, mr: 1 }} />
          <ListItemText primary={labelOf(value)} secondary={hint?.(value)} />
        </MenuItem>
      ))}
    </TextField>
  )

  const chips: Array<{ key: string; label: string; remove: () => void }> = [
    ...(filters.q.trim()
      ? [
          {
            key: 'q',
            label: `“${filters.q.trim()}”`,
            remove: () => {
              onQuery('')
              set({ q: '' })
            },
          },
        ]
      : []),
    ...filters.months.map((month) => ({ key: `m${month}`, label: monthLabel(month), remove: () => set({ months: filters.months.filter((m) => m !== month) }) })),
    ...filters.air.map((state) => ({ key: `a${state}`, label: airLabel(state), remove: () => set({ air: filters.air.filter((s) => s !== state) }) })),
    ...filters.tiers.map((tier) => ({ key: `t${tier}`, label: tierLabel(tier), remove: () => set({ tiers: filters.tiers.filter((s) => s !== tier) }) })),
    ...(filters.from || filters.to
      ? [{ key: 'dates', label: t('filter.bookedRange', { from: filters.from ? dmy(filters.from) : '…', to: filters.to ? dmy(filters.to) : '…' }), remove: () => set({ from: '', to: '' }) }]
      : []),
  ]

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {views}
        <Box sx={{ flexGrow: 1 }} />
        <TextField
          size="small"
          placeholder={t('search')}
          value={query}
          onChange={(event) => onQuery(event.target.value.slice(0, SEARCH_MAX))}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: { xs: '100%', sm: 300 } }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {multi(t('filter.month'), filters.months, options.months, monthLabel, (months) => set({ months }), 130)}
        {multi(t('column.airStatus'), filters.air, options.air, airLabel, (air) => set({ air }), 170)}
        {multi(t('column.tier'), filters.tiers, options.tiers, tierLabel, (tiers) => set({ tiers }), 150, (tier) =>
          tier in KOC_TIER_RANGES ? t('tier.followers', { range: KOC_TIER_RANGES[tier as (typeof KOC_TIERS)[number]] }) : '',
        )}
        <DateField size="small" label={t('filter.bookedFrom')} value={filters.from} max={filters.to || undefined} onChange={(from) => set({ from })} sx={{ width: 170 }} />
        <DateField size="small" label={t('filter.bookedTo')} value={filters.to} min={filters.from || undefined} onChange={(to) => set({ to })} sx={{ width: 170 }} />
        <Box sx={{ flexGrow: 1 }} />
        {columnsButton}
      </Stack>
      {hasFilters(filters) ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
          {chips.map((chip) => (
            <Chip key={chip.key} size="small" label={chip.label} onDelete={chip.remove} />
          ))}
          <Button
            size="small"
            onClick={() => {
              onQuery('')
              onChange({ q: '', months: [], air: [], tiers: [], from: '', to: '' })
            }}
          >
            {t('filter.clear')}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  )
}
