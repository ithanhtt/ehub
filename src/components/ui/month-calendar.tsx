'use client'

import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowDropDown from '@mui/icons-material/ArrowDropDown'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { alpha } from '@mui/material/styles'

/**
 * One month of days, Monday first, the app's own in place of the browser's:
 * a day or a range marked on it (a filled start and end joined by a strip),
 * today ringed, the days that cannot be picked greyed out. Dates are
 * YYYY-MM-DD strings throughout, read as calendar days (no time zone).
 */

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return isoDay(new Date(Date.UTC(y, m - 1, d + days)))
}

export function addMonths(yearMonth: string, months: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return isoDay(new Date(Date.UTC(y, m - 1 + months, 1))).slice(0, 7)
}

/** Today on this device's calendar. */
export function localToday(): string {
  const now = new Date()
  return isoDay(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
}

/** The days of a month laid out Monday first, with blanks before the 1st. */
function monthGrid(yearMonth: string): Array<string | null> {
  const first = `${yearMonth}-01`
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const last = addDays(`${addMonths(yearMonth, 1)}-01`, -1)
  const days: string[] = []
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day)
  return [...Array<null>(lead).fill(null), ...days]
}

export function MonthCalendar({
  yearMonth,
  locale,
  selectable,
  from,
  to,
  today,
  onPick,
  onHover,
  compact = false,
  hideTitle = false,
  onTitleClick,
  titleLabel,
}: {
  /** YYYY-MM. */
  yearMonth: string
  locale: string
  selectable: (day: string) => boolean
  /** The marked range; the same day twice for a single day, empty for none. */
  from: string
  to: string
  today: string
  onPick: (day: string) => void
  onHover?: (day: string | null) => void
  /** Larger cells, for fingers. */
  compact?: boolean
  hideTitle?: boolean
  /** Given, the month's title is a button (opening the month and year grid, MonthYearGrid). */
  onTitleClick?: () => void
  /** What that button says to a screen reader. */
  titleLabel?: string
}) {
  const title = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${yearMonth}-01T00:00:00Z`))
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))))
  }, [locale])
  const full = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const size = compact ? 40 : 36

  return (
    <Box sx={{ width: size * 7 }}>
      {hideTitle ? null : onTitleClick ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
          <MonthTitleButton title={title} label={titleLabel} onClick={onTitleClick} />
        </Box>
      ) : (
        <Typography variant="subtitle2" sx={{ textAlign: 'center', fontWeight: 700, mb: 1, textTransform: 'capitalize', lineHeight: '28px' }}>
          {title}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(7, ${size}px)` }} onMouseLeave={() => onHover?.(null)}>
        {weekdays.map((name, i) => (
          <Typography key={i} variant="caption" sx={{ textAlign: 'center', color: 'text.disabled', fontWeight: 600, lineHeight: '24px' }}>
            {name}
          </Typography>
        ))}
        {monthGrid(yearMonth).map((day, i) => {
          if (!day) return <Box key={`blank-${i}`} />
          const enabled = selectable(day)
          const edge = day === from || day === to
          const inside = Boolean(from && to) && day > from && day < to
          // The strip joins the start to the end; it runs under the edge days' inner halves.
          const strip = inside || (edge && Boolean(from && to) && from !== to)
          const stripSide = day === from ? 'right' : day === to ? 'left' : 'both'
          return (
            <Box
              key={day}
              sx={{
                position: 'relative',
                height: size,
                ...(strip
                  ? {
                      '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 3,
                        bottom: 3,
                        left: stripSide === 'right' ? '50%' : 0,
                        right: stripSide === 'left' ? '50%' : 0,
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
                      },
                    }
                  : {}),
              }}
            >
              <ButtonBase
                disabled={!enabled}
                onClick={() => onPick(day)}
                onMouseEnter={() => onHover?.(day)}
                onFocus={() => onHover?.(day)}
                aria-label={full.format(new Date(`${day}T00:00:00Z`))}
                aria-pressed={edge}
                sx={{
                  position: 'relative',
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  typography: 'body2',
                  fontWeight: edge || day === today ? 700 : 400,
                  color: edge ? 'primary.contrastText' : enabled ? 'text.primary' : 'text.disabled',
                  bgcolor: edge ? 'primary.main' : 'transparent',
                  border: day === today && !edge ? 1 : 0,
                  borderColor: 'primary.main',
                  '&:hover': { bgcolor: edge ? 'primary.dark' : 'action.hover' },
                  '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid' },
                }}
              >
                {Number(day.slice(8))}
              </ButtonBase>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** A month's title as a button, with a caret: the way to the month and year grid. */
export function MonthTitleButton({ title, label, onClick, open = false }: { title: string; label?: string; onClick: () => void; open?: boolean }) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={label ? `${label}: ${title}` : undefined}
      aria-expanded={open}
      sx={{
        px: 1,
        height: 28,
        borderRadius: 999,
        typography: 'subtitle2',
        fontWeight: 700,
        textTransform: 'capitalize',
        gap: 0.25,
        '&:hover': { bgcolor: 'action.hover' },
        '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid' },
      }}
    >
      {title}
      <ArrowDropDown fontSize="small" sx={{ transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
    </ButtonBase>
  )
}

/**
 * Months at a glance, a year at a time: jump straight to a month (or, where
 * the caller says so, take all of it) instead of paging through the calendar
 * one month per click. Months outside `min`–`max` (YYYY-MM) cannot be picked;
 * `marked` tints the months the current choice touches.
 */
export function MonthYearGrid({
  value,
  min,
  max,
  locale,
  onPick,
  marked,
  labels,
}: {
  /** The month shown now (YYYY-MM): its year opens, the month outlined. */
  value: string
  min?: string
  max?: string
  locale: string
  onPick: (yearMonth: string) => void
  marked?: (yearMonth: string) => boolean
  labels: { previousYear: string; nextYear: string }
}) {
  const [year, setYear] = useState(Number(value.slice(0, 4)))
  const names = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
    return Array.from({ length: 12 }, (_, i) => format.format(new Date(Date.UTC(2024, i, 1))))
  }, [locale])
  const minYear = min ? Number(min.slice(0, 4)) : -Infinity
  const maxYear = max ? Number(max.slice(0, 4)) : Infinity
  return (
    <Box sx={{ width: 252, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <IconButton size="small" aria-label={labels.previousYear} disabled={year - 1 < minYear} onClick={() => setYear(year - 1)}>
          <ChevronLeft fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {year}
        </Typography>
        <IconButton size="small" aria-label={labels.nextYear} disabled={year + 1 > maxYear} onClick={() => setYear(year + 1)}>
          <ChevronRight fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        {names.map((name, i) => {
          const yearMonth = `${year}-${String(i + 1).padStart(2, '0')}`
          const enabled = (!min || yearMonth >= min) && (!max || yearMonth <= max)
          const current = yearMonth === value
          const tinted = enabled && Boolean(marked?.(yearMonth))
          return (
            <ButtonBase
              key={yearMonth}
              disabled={!enabled}
              onClick={() => onPick(yearMonth)}
              sx={{
                height: 40,
                borderRadius: 2,
                typography: 'body2',
                fontWeight: current ? 700 : 500,
                textTransform: 'capitalize',
                color: enabled ? 'text.primary' : 'text.disabled',
                border: 1,
                borderColor: current ? 'primary.main' : 'transparent',
                bgcolor: tinted ? (theme) => alpha(theme.palette.primary.main, 0.14) : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
                '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid' },
              }}
            >
              {name}
            </ButtonBase>
          )
        })}
      </Box>
    </Box>
  )
}
