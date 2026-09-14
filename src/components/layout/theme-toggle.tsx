'use client'

import { useEffect, useState } from 'react'
import { useColorScheme } from '@mui/material/styles'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Check from '@mui/icons-material/Check'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined'
import { useTranslations } from 'next-intl'

type Mode = 'light' | 'dark' | 'system'

const OPTIONS: Array<{ value: Mode; icon: React.ReactNode }> = [
  { value: 'light', icon: <LightModeOutlined fontSize="small" /> },
  { value: 'dark', icon: <DarkModeOutlined fontSize="small" /> },
  { value: 'system', icon: <SettingsBrightnessOutlined fontSize="small" /> },
]

export function ThemeToggle({ onColor }: { onColor?: boolean } = {}) {
  const t = useTranslations('theme')
  const { mode, setMode, systemMode } = useColorScheme()
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)

  // `mode` reads the stored preference, which only exists in the browser. On
  // the server it is undefined, so rendering the real control immediately
  // would produce a hydration mismatch — a placeholder of the same size keeps
  // the toolbar from shifting while we wait.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted || !mode) {
    return <Skeleton variant="rounded" width={34} height={34} sx={{ borderRadius: 2.5 }} />
  }

  // In system mode the button shows what the system actually resolved to,
  // so the icon always matches what the user is looking at.
  const effective = mode === 'system' ? (systemMode ?? 'light') : mode

  return (
    <>
      <Tooltip title={t('label')}>
        <IconButton
          size="small"
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label={t('label')}
          aria-haspopup="menu"
          sx={onColor ? { color: 'inherit', '&:hover': { bgcolor: 'rgba(255,255,255,0.16)' } } : undefined}
        >
          {effective === 'dark' ? (
            <DarkModeOutlined fontSize="small" />
          ) : (
            <LightModeOutlined fontSize="small" />
          )}
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 190 } } }}
      >
        {OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            selected={mode === option.value}
            onClick={() => {
              setMode(option.value)
              setAnchor(null)
            }}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText slotProps={{ primary: { variant: 'body2' } }}>
              {t(option.value)}
            </ListItemText>
            {mode === option.value ? (
              <Check fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />
            ) : null}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
