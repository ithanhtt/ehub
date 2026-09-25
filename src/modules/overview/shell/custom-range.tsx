'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { DateField } from '@/components/ui/date-field'
import { addMonths as shiftMonth, MonthCalendar, MonthYearGrid } from '@/components/ui/month-calendar'
import {
  CUSTOM_LOOKBACK_DAYS,
  CUSTOM_MAX_DAYS,
  customRangeProblem,
  daysBetween,
  shiftDay,
  vnDate,
  type CustomRange,
} from '@/modules/overview/data/period'

/**
 * Picks a custom range, the way the ad tools people already know do it
 * (Google Ads, GA4, Meta Ads Manager): the usual ranges in a list on the
 * left, a calendar of two months beside it (one on a phone) where a click
 * sets the start and the next the end — the range shown as it is hovered —
 * the two dates also typeable, and at the foot how many days that is and the
 * period it is compared with. A preset only fills the calendar in; Apply
 * applies, so what is about to be read is always seen first.
 *
 * Ranges are held to what the page can read — within the last `lookback`
 * days and at most `maxDays` long — with the same check its route runs; the
 * calendar greys out the days out of reach, and while the end is picked, the
 * days that would make the range too long.
 */

type Preset = { key: string; range: CustomRange }

const month = (day: string) => day.slice(0, 7)

export function CustomRangePopover({
  anchor,
  value,
  onClose,
  onApply,
  limits,
  compare = true,
}: {
  anchor: HTMLElement | null
  /** The custom range in force, if any — each opening starts from it. */
  value: CustomRange | null
  onClose: () => void
  onApply: (range: CustomRange) => void
  /** Another page's reach (the reports look further back): its limits and the check its route runs. */
  limits?: { lookback: number; maxDays: number; problem: (range: CustomRange) => string | null }
  /** Whether the page sets the range against the one before it (the overview does, the reports do not). */
  compare?: boolean
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const twoMonths = useMediaQuery(theme.breakpoints.up('md'))
  const lookback = limits?.lookback ?? CUSTOM_LOOKBACK_DAYS
  const maxDays = limits?.maxDays ?? CUSTOM_MAX_DAYS
  const today = vnDate(new Date())
  const earliest = shiftDay(today, -(lookback - 1))
  const open = anchor !== null

  const [draft, setDraft] = useState<CustomRange>(value ?? { from: shiftDay(today, -6), to: today })
  // After a first click, the next one sets the end.
  const [picking, setPicking] = useState<'from' | 'to'>('from')
  const [hover, setHover] = useState<string | null>(null)
  // The month on the right (the only one on a phone).
  const [view, setView] = useState(month(today))
  // The month and year grid, opened from a month's title, in place of the days.
  const [monthGrid, setMonthGrid] = useState(false)

  useEffect(() => {
    if (!open) return
    const start = value ?? { from: shiftDay(today, -6), to: today }
    setDraft(start)
    setPicking('from')
    setHover(null)
    setView(month(start.to))
    setMonthGrid(false)
  }, [open, value, today])

  const check = (range: CustomRange) => (limits ? limits.problem(range) : customRangeProblem(range))

  const presets = useMemo(() => {
    const monday = shiftDay(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
    const monthStart = `${today.slice(0, 8)}01`
    const lastMonthEnd = shiftDay(monthStart, -1)
    const last = (days: number) => ({ from: shiftDay(today, -(days - 1)), to: today })
    const all: Preset[] = [
      { key: 'quickYesterday', range: { from: shiftDay(today, -1), to: shiftDay(today, -1) } },
      { key: 'quick7', range: last(7) },
      { key: 'quick14', range: last(14) },
      { key: 'quick30', range: last(30) },
      { key: 'quickThisWeek', range: { from: monday, to: today } },
      { key: 'quickLastWeek', range: { from: shiftDay(monday, -7), to: shiftDay(monday, -1) } },
      { key: 'quickThisMonth', range: { from: monthStart, to: today } },
      { key: 'quickLastMonth', range: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd } },
      { key: 'quick90', range: last(90) },
      { key: 'quick180', range: last(180) },
    ]
    return all.filter((preset) => (limits ? limits.problem(preset.range) : customRangeProblem(preset.range)) === null)
  }, [today, limits])

  // While the end is picked, the range follows the pointer.
  const shown: CustomRange = picking === 'to' && hover && hover >= draft.from ? { from: draft.from, to: hover } : draft
  const complete = picking === 'from'
  const problem = check(draft)
  const message = !complete
    ? null
    : problem === 'order'
      ? t('customErrorOrder')
      : problem === 'tooLong'
        ? t('customErrorLong', { max: maxDays })
        : problem === 'tooOld' || problem === 'future'
          ? t('customErrorRange', { lookback })
          : problem
            ? t('customErrorInvalid')
            : null

  const selectable = (day: string) => {
    if (day < earliest || day > today) return false
    if (picking === 'to' && day >= draft.from) return daysBetween(draft.from, day).length <= maxDays
    return true
  }
  const pick = (day: string) => {
    if (picking === 'from' || day < draft.from) {
      setDraft({ from: day, to: day })
      setPicking('to')
    } else {
      setDraft({ from: draft.from, to: day })
      setPicking('from')
    }
  }
  const choosePreset = (range: CustomRange) => {
    setDraft(range)
    setPicking('from')
    setView(month(range.to))
  }
  const typed = (key: 'from' | 'to', day: string) => {
    const next = { ...draft, [key]: day }
    setDraft(next)
    setPicking('from')
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) setView(month(key === 'to' ? day : next.to >= day ? next.to : day))
  }

  const date = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
  const label = (range: CustomRange) =>
    range.from === range.to
      ? date.format(new Date(`${range.from}T00:00:00Z`))
      : `${date.format(new Date(`${range.from}T00:00:00Z`))} – ${date.format(new Date(`${range.to}T00:00:00Z`))}`
  const length = problem === null || problem === 'tooLong' ? daysBetween(shown.from, shown.to).length : 0
  const previous = { from: shiftDay(draft.from, -length), to: shiftDay(draft.from, -1) }
  const activePreset = presets.find((preset) => preset.range.from === draft.from && preset.range.to === draft.to)?.key

  /**
   * A month from the grid: the whole of it as the range — cut to what can be
   * read (not before the earliest day, not past today, at most maxDays) — and
   * the calendar turned to it, the days there to adjust.
   */
  const pickMonth = (yearMonth: string) => {
    const first = `${yearMonth}-01`
    const last = shiftDay(`${shiftMonth(yearMonth, 1)}-01`, -1)
    const to = last < today ? last : today
    let from = first > earliest ? first : earliest
    if (daysBetween(from, to).length > maxDays) from = shiftDay(to, -(maxDays - 1))
    setDraft({ from, to })
    setPicking('from')
    setView(twoMonths && yearMonth < month(today) ? shiftMonth(yearMonth, 1) : yearMonth)
    setMonthGrid(false)
  }
  const months = twoMonths ? [shiftMonth(view, -1), view] : [view]
  const canBack = months[0] > month(earliest)
  const canForward = view < month(today)

  const presetList = phone ? (
    <Stack direction="row" sx={{ gap: 0.75, overflowX: 'auto', pb: 1, px: 2, scrollbarWidth: 'none' }}>
      {presets.map((preset) => (
        <Chip
          key={preset.key}
          label={t(preset.key)}
          color={activePreset === preset.key ? 'primary' : 'default'}
          variant={activePreset === preset.key ? 'filled' : 'outlined'}
          onClick={() => choosePreset(preset.range)}
          sx={{ flexShrink: 0 }}
        />
      ))}
    </Stack>
  ) : (
    <List dense disablePadding sx={{ width: 168, flexShrink: 0, py: 1, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
      {presets.map((preset) => (
        <ListItemButton
          key={preset.key}
          selected={activePreset === preset.key}
          onClick={() => choosePreset(preset.range)}
          sx={{ px: 2, borderRadius: 0, '&.Mui-selected': { fontWeight: 700, color: 'primary.main' } }}
        >
          <Typography variant="body2" sx={{ fontWeight: 'inherit' }}>
            {t(preset.key)}
          </Typography>
        </ListItemButton>
      ))}
    </List>
  )

  const body = (
    <Stack sx={{ maxHeight: phone ? '100%' : 'calc(100vh - 96px)' }}>
      <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {t('customTitle')}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {t('customHint', { max: maxDays, lookback })}
        </Typography>
      </Box>
      {phone ? presetList : null}
      <Divider />
      <Stack direction="row" sx={{ minHeight: 0, flex: 1 }}>
        {phone ? null : presetList}
        <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
            <DateField
              size="small"
              fullWidth
              noCalendar
              label={t('customFrom')}
              value={draft.from}
              onChange={(day) => typed('from', day)}
              onFocus={() => setPicking('from')}
              focused={picking === 'from' ? undefined : false}
            />
            <DateField
              size="small"
              fullWidth
              noCalendar
              label={t('customTo')}
              value={draft.to}
              onChange={(day) => typed('to', day)}
              onFocus={() => setPicking('to')}
              focused={picking === 'to' ? true : undefined}
              helperText={picking === 'to' ? t('customPickEnd') : undefined}
            />
          </Stack>

          {monthGrid ? (
            <Box>
              <MonthYearGrid
                value={view}
                min={month(earliest)}
                max={month(today)}
                locale={locale}
                onPick={pickMonth}
                marked={(m) => m >= month(draft.from) && m <= month(draft.to)}
                labels={{ previousYear: t('customPrevYear'), nextYear: t('customNextYear') }}
              />
              <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: 'text.secondary', mt: 1.5 }}>
                {t('customMonthHint')}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                <Button size="small" onClick={() => setMonthGrid(false)}>
                  {t('customBackToDays')}
                </Button>
              </Box>
            </Box>
          ) : (
          <Box sx={{ position: 'relative' }}>
            <IconButton
              size="small"
              aria-label={t('customPrevMonth')}
              disabled={!canBack}
              onClick={() => setView(shiftMonth(view, -1))}
              sx={{ position: 'absolute', left: 0, top: -2 }}
            >
              <ChevronLeft fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={t('customNextMonth')}
              disabled={!canForward}
              onClick={() => setView(shiftMonth(view, 1))}
              sx={{ position: 'absolute', right: 0, top: -2 }}
            >
              <ChevronRight fontSize="small" />
            </IconButton>
            <Stack direction="row" spacing={3} sx={{ justifyContent: 'center' }}>
              {months.map((m) => (
                <MonthCalendar
                  key={m}
                  yearMonth={m}
                  locale={locale}
                  selectable={selectable}
                  from={shown.from}
                  to={shown.to}
                  today={today}
                  onPick={pick}
                  onHover={setHover}
                  compact={phone}
                  onTitleClick={() => setMonthGrid(true)}
                  titleLabel={t('customPickMonth')}
                />
              ))}
            </Stack>
          </Box>
          )}
        </Box>
      </Stack>
      <Divider />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ px: 2, py: 1.5, alignItems: { xs: 'stretch', sm: 'center' } }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {message ? (
            <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
              {message}
            </Typography>
          ) : (
            <>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {label(shown)}
                {length > 0 ? (
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                    {' · '}
                    {t('customDays', { count: length })}
                  </Box>
                ) : null}
              </Typography>
              {compare && complete && length > 0 ? (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {t('customCompare', { range: label(previous) })}
                </Typography>
              ) : null}
            </>
          )}
          {/* Sapo reads every order of a day it has not seen: say so before a long range is picked. */}
          {length > 31 ? (
            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
              {t('customSlowNote')}
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexShrink: 0 }}>
          <Button color="inherit" onClick={onClose}>
            {t('customCancel')}
          </Button>
          <Button variant="contained" disabled={!complete || problem !== null} onClick={() => onApply(draft)}>
            {t('customApply')}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  )

  if (phone) {
    return (
      <Dialog open={open} onClose={onClose} fullScreen>
        {body}
      </Dialog>
    )
  }
  return (
    <Popover
      open={open}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { maxWidth: 'calc(100vw - 32px)' } } }}
    >
      {body}
    </Popover>
  )
}
