'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  CUSTOM_LOOKBACK_DAYS,
  CUSTOM_MAX_DAYS,
  customRangeProblem,
  shiftDay,
  vnDate,
  type CustomRange,
} from '@/modules/overview/data/period'

/**
 * Picks a custom range for the overview: a quick pick for the usual asks
 * (yesterday, the last two weeks, this month, last month, the last three
 * months) applies at once;
 * otherwise any two dates, applied with a button. Ranges are held to what the
 * dashboard can read — within the last CUSTOM_LOOKBACK_DAYS days and at most
 * CUSTOM_MAX_DAYS long — with the same check the route runs, and the fields
 * themselves refuse dates outside that reach. Native date fields: the phone's
 * own calendar, and the browser's own date format.
 */
export function CustomRangePopover({
  anchor,
  value,
  onClose,
  onApply,
}: {
  anchor: HTMLElement | null
  /** The custom range in force, if any — each opening starts from it. */
  value: CustomRange | null
  onClose: () => void
  onApply: (range: CustomRange) => void
}) {
  const t = useTranslations('dashboard')
  const today = vnDate(new Date())
  const earliest = shiftDay(today, -(CUSTOM_LOOKBACK_DAYS - 1))
  const fallback = { from: shiftDay(today, -6), to: today }
  const [draft, setDraft] = useState<CustomRange>(value ?? fallback)

  useEffect(() => {
    if (anchor) setDraft(value ?? { from: shiftDay(today, -6), to: today })
  }, [anchor, value, today])

  const monthStart = `${today.slice(0, 8)}01`
  const lastMonthEnd = shiftDay(monthStart, -1)
  const quick: Array<{ key: string; label: string; range: CustomRange }> = [
    { key: 'yesterday', label: t('quickYesterday'), range: { from: shiftDay(today, -1), to: shiftDay(today, -1) } },
    { key: '14d', label: t('quick14'), range: { from: shiftDay(today, -13), to: today } },
    { key: 'month', label: t('quickThisMonth'), range: { from: monthStart, to: today } },
    { key: 'lastMonth', label: t('quickLastMonth'), range: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd } },
    { key: '90d', label: t('quick90'), range: { from: shiftDay(today, -89), to: today } },
  ]

  const problem = customRangeProblem(draft)
  const message =
    problem === 'order'
      ? t('customErrorOrder')
      : problem === 'tooLong'
        ? t('customErrorLong', { max: CUSTOM_MAX_DAYS })
        : problem === 'tooOld' || problem === 'future'
          ? t('customErrorRange', { lookback: CUSTOM_LOOKBACK_DAYS })
          : null

  return (
    <Popover
      open={anchor !== null}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      <Box sx={{ p: 2, width: 340, maxWidth: 'calc(100vw - 32px)' }}>
        <Typography variant="subtitle2">{t('customTitle')}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {t('customHint', { max: CUSTOM_MAX_DAYS, lookback: CUSTOM_LOOKBACK_DAYS })}
        </Typography>
        {/* Sapo reads every order of a day it has not seen: say so before a long range is picked. */}
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mb: 1.5 }}>
          {t('customSlowNote')}
        </Typography>

        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
          {quick.map((pick) => (
            <Chip key={pick.key} size="small" variant="outlined" label={pick.label} onClick={() => onApply(pick.range)} />
          ))}
        </Stack>

        <Stack direction="row" spacing={1.5}>
          <TextField
            type="date"
            size="small"
            fullWidth
            label={t('customFrom')}
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: earliest, max: draft.to || today } }}
          />
          <TextField
            type="date"
            size="small"
            fullWidth
            label={t('customTo')}
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: draft.from || earliest, max: today } }}
          />
        </Stack>
        {message ? (
          <Typography variant="caption" role="alert" sx={{ display: 'block', color: 'error.main', mt: 1 }}>
            {message}
          </Typography>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 2 }}>
          <Button size="small" color="inherit" onClick={onClose}>
            {t('customCancel')}
          </Button>
          <Button size="small" variant="contained" disabled={problem !== null} onClick={() => onApply(draft)}>
            {t('customApply')}
          </Button>
        </Stack>
      </Box>
    </Popover>
  )
}
