'use client'

import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'

/** The pieces the booking and campaign forms share, so both read the same way. */

/** A heading over one group of fields. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="overline" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.5, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

/** Chips that set a field to one value each; the one it holds shows as chosen. */
export function QuickChips({ options, current, onPick }: { options: Array<{ label: string; value: string }>; current: string; onPick: (value: string) => void }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
      {options.map((option) => (
        <Chip
          key={`${option.label}:${option.value}`}
          size="small"
          label={option.label}
          variant={option.value === current ? 'filled' : 'outlined'}
          color={option.value === current ? 'primary' : 'default'}
          onClick={() => onPick(option.value)}
        />
      ))}
    </Stack>
  )
}

/** A helper text saying the value was worked out, not typed. */
export function AutoMark({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <AutoAwesomeOutlined sx={{ fontSize: 13 }} />
      {children}
    </Box>
  )
}
