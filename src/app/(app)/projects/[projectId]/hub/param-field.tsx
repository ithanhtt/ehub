'use client'

import { useLocale, useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ParamSpec } from '@/core/plugins/types'
import type { Locale } from '@/i18n/config'
import { DateField } from '@/components/ui/date-field'
import { MONO_STACK } from '@/theme'

/**
 * Renders one form control from a ParamSpec.
 *
 * Values are held as strings and only coerced at submit time by the shared
 * params module, so the browser form and the server executor agree on how
 * "1", "true" and a comma-separated list become real values.
 */

/** MUI v9 removed `inputProps`; native attributes go through this slot. */
const MONO_INPUT = { htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } } as const

/** Picker options drawn from the connection, and what a blank value resolves to. */
export type ParamChoices = {
  options: Array<{ value: string; label: string }>
  auto?: { value: string; label: string }
}

export function ParamField({
  spec,
  value,
  onChange,
  choices,
}: {
  spec: ParamSpec
  value: string
  onChange: (next: string) => void
  choices?: ParamChoices
}) {
  const tc = useTranslations('common')
  const th = useTranslations('hub')
  const locale = useLocale() as Locale

  const helper = spec.help?.[locale]

  const label = (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
      <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
        {spec.label[locale]}
      </Typography>
      <Typography
        variant="caption"
        component="code"
        sx={{ fontFamily: MONO_STACK, color: 'text.disabled' }}
      >
        {spec.key}
      </Typography>
      {spec.in !== 'query' ? (
        <Chip size="small" variant="outlined" label={spec.in} sx={{ height: 17, fontSize: 9.5 }} />
      ) : null}
      {!spec.required ? (
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          ({tc('optional')})
        </Typography>
      ) : null}
      {/* Tells the user the server fills this in when left blank. */}
      {spec.satisfiedByConnection ? (
        <Chip
          size="small"
          variant="outlined"
          color="primary"
          label="auto"
          sx={{ height: 17, fontSize: 9.5 }}
        />
      ) : null}
    </Stack>
  )

  if (spec.type === 'boolean') {
    return (
      <Box>
        {label}
        <FormControlLabel
          sx={{ mt: 0.25 }}
          control={
            <Switch
              size="small"
              checked={value === 'true'}
              onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {value === 'true' ? 'true' : 'false'}
            </Typography>
          }
        />
        {helper ? (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {helper}
          </Typography>
        ) : null}
      </Box>
    )
  }

  const common = {
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
    helperText: helper,
  }

  function control() {
    // Only a single value comes from a picker; lists and JSON stay free-form.
    if (choices && (spec.type === 'string' || spec.type === 'number')) {
      const known = choices.options.some((option) => option.value === value)
      return (
        <TextField select {...common} slotProps={{ select: { displayEmpty: true } }}>
          <MenuItem value="">
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {choices.auto ? th('autoValue', { value: `${choices.auto.label} · ${choices.auto.value}` }) : '—'}
            </Typography>
          </MenuItem>
          {/* A value typed or saved earlier stays selectable even if the list lacks it. */}
          {value && !known ? (
            <MenuItem value={value} sx={{ fontFamily: MONO_STACK, fontSize: 13 }}>
              {value}
            </MenuItem>
          ) : null}
          {choices.options.map((option) => (
            <MenuItem key={option.value} value={option.value} sx={{ fontSize: 13 }}>
              {option.label}
              <Box
                component="span"
                sx={{ ml: 1, fontFamily: MONO_STACK, fontSize: 11.5, color: 'text.disabled' }}
              >
                {option.value}
              </Box>
            </MenuItem>
          ))}
        </TextField>
      )
    }

    switch (spec.type) {
      case 'enum':
        return (
          <TextField select {...common}>
            <MenuItem value="">
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                —
              </Typography>
            </MenuItem>
            {spec.options?.map((option) => (
              <MenuItem key={option.value} value={option.value} sx={{ fontSize: 13 }}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        )

      case 'string[]':
      case 'json':
        return (
          <TextField
            {...common}
            multiline
            rows={3}
            spellCheck={false}
            placeholder={spec.placeholder ?? (spec.type === 'json' ? '{ }' : 'value_1\nvalue_2')}
            slotProps={MONO_INPUT}
          />
        )

      case 'number':
        return (
          <TextField
            {...common}
            type="number"
            placeholder={spec.placeholder}
            slotProps={{ htmlInput: { ...MONO_INPUT.htmlInput, inputMode: 'numeric' } }}
          />
        )

      case 'date':
        return <DateField value={value} onChange={onChange} helperText={helper} slotProps={MONO_INPUT} />

      default:
        return <TextField {...common} placeholder={spec.placeholder} slotProps={MONO_INPUT} />
    }
  }

  return (
    <Box>
      {label}
      <Box sx={{ mt: 0.75 }}>{control()}</Box>
    </Box>
  )
}

/** Turns a ParamSpec default into the string the controls above expect. */
export function stringifyDefault(spec: ParamSpec): string {
  const value = spec.defaultValue
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join('\n')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
