'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import TextField, { type TextFieldProps } from '@mui/material/TextField'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { addMonths, localToday, MonthCalendar, MonthTitleButton, MonthYearGrid } from './month-calendar'

/**
 * A date field in the app's own look, in place of the browser's (which
 * differs from one browser to the next and ignores the theme): typed as
 * dd/mm/yyyy — the slashes put in as the digits come — and, unless the field
 * sits next to a calendar already, a calendar button beside it. The value is
 * YYYY-MM-DD, or '' for none.
 *
 * A date is passed on once all eight digits make a real day; one left
 * half-typed goes back to the last good one when the field is left, and a
 * field emptied is passed on as ''.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

const shown = (value: string) => {
  const match = ISO.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

/** The digits typed, with their slashes. */
const masked = (text: string) => {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/')
}

/** The typed day as YYYY-MM-DD, when it is a real one. */
const parsed = (text: string): string | null => {
  const digits = text.replace(/\D/g, '')
  if (digits.length !== 8) return null
  const iso = `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? iso : null
}

export type DateFieldProps = Omit<TextFieldProps, 'value' | 'onChange' | 'type' | 'defaultValue'> & {
  value: string
  onChange: (value: string) => void
  /** YYYY-MM-DD bounds for the calendar. */
  min?: string
  max?: string
  /** Leave the calendar button out (the field sits by a calendar of its own). */
  noCalendar?: boolean
}

export function DateField({ value, onChange, min, max, noCalendar = false, onFocus, onBlur, slotProps, ...rest }: DateFieldProps) {
  const t = useTranslations('common')
  const locale = useLocale()
  const [text, setText] = useState(shown(value))
  const focused = useRef(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const today = localToday()
  const [view, setView] = useState((value || max || today).slice(0, 7))
  // The month and year grid in place of the days, opened from the month's title.
  const [monthGrid, setMonthGrid] = useState(false)

  // The value set from outside (a calendar, a chip) shows unless the field is being typed in.
  useEffect(() => {
    if (!focused.current) setText(shown(value))
  }, [value])

  const openCalendar = (element: HTMLElement) => {
    setView((value || (max && max < today ? max : today)).slice(0, 7))
    setMonthGrid(false)
    setAnchor(element)
  }
  const selectable = (day: string) => (!min || day >= min) && (!max || day <= max)
  const inputSlot = (slotProps?.input ?? {}) as Record<string, unknown>
  const htmlInputSlot = (slotProps?.htmlInput ?? {}) as Record<string, unknown>

  return (
    <>
      <TextField
        {...rest}
        value={text}
        placeholder="dd/mm/yyyy"
        onFocus={(event) => {
          focused.current = true
          onFocus?.(event)
        }}
        onBlur={(event) => {
          focused.current = false
          if (text === '') {
            if (value !== '') onChange('')
          } else if (!parsed(text)) {
            setText(shown(value))
          }
          onBlur?.(event)
        }}
        onChange={(event) => {
          const next = masked(event.target.value)
          setText(next)
          const day = parsed(next)
          if (day) onChange(day)
          else if (next === '') onChange('')
        }}
        slotProps={{
          ...slotProps,
          inputLabel: { shrink: true, ...((slotProps?.inputLabel ?? {}) as object) },
          htmlInput: { inputMode: 'numeric', autoComplete: 'off', maxLength: 10, ...htmlInputSlot },
          input: {
            ...inputSlot,
            endAdornment: noCalendar ? (inputSlot.endAdornment as React.ReactNode) : (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  edge="end"
                  aria-label={t('pickDate')}
                  disabled={rest.disabled}
                  onClick={(event) => openCalendar(event.currentTarget)}
                >
                  <CalendarMonthOutlined sx={{ fontSize: 18 }} />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      {noCalendar ? null : (
        <Popover
          open={anchor !== null}
          anchorEl={anchor}
          onClose={() => setAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Box sx={{ p: 1.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <IconButton
                size="small"
                aria-label={t('previousMonth')}
                disabled={Boolean(min) && view <= (min ?? '').slice(0, 7)}
                onClick={() => {
                  setView(addMonths(view, -1))
                  setMonthGrid(false)
                }}
              >
                <ChevronLeft fontSize="small" />
              </IconButton>
              <MonthTitleButton
                title={new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${view}-01T00:00:00Z`))}
                label={t('pickMonth')}
                open={monthGrid}
                onClick={() => setMonthGrid(!monthGrid)}
              />
              <IconButton
                size="small"
                aria-label={t('nextMonth')}
                disabled={Boolean(max) && view >= (max ?? '').slice(0, 7)}
                onClick={() => {
                  setView(addMonths(view, 1))
                  setMonthGrid(false)
                }}
              >
                <ChevronRight fontSize="small" />
              </IconButton>
            </Stack>
            {monthGrid ? (
              <MonthYearGrid
                value={view}
                min={min?.slice(0, 7)}
                max={max?.slice(0, 7)}
                locale={locale}
                onPick={(yearMonth) => {
                  setView(yearMonth)
                  setMonthGrid(false)
                }}
                marked={(yearMonth) => Boolean(value) && value.startsWith(yearMonth)}
                labels={{ previousYear: t('previousYear'), nextYear: t('nextYear') }}
              />
            ) : (
              <MonthCalendar
                yearMonth={view}
                locale={locale}
                selectable={selectable}
                from={value}
                to={value}
                today={today}
                hideTitle
                onPick={(day) => {
                  onChange(day)
                  setText(shown(day))
                  setAnchor(null)
                }}
              />
            )}
            <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}>
              <Button
                size="small"
                disabled={!selectable(today)}
                onClick={() => {
                  onChange(today)
                  setText(shown(today))
                  setAnchor(null)
                }}
              >
                {t('today')}
              </Button>
              {value && !rest.required ? (
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    onChange('')
                    setText('')
                    setAnchor(null)
                  }}
                >
                  {t('clear')}
                </Button>
              ) : null}
            </Stack>
          </Box>
        </Popover>
      )}
    </>
  )
}
