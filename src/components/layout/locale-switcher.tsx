'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Check from '@mui/icons-material/Check'
import TranslateOutlined from '@mui/icons-material/TranslateOutlined'
import { setLocale } from '@/i18n/actions'
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/config'

export function LocaleSwitcher({ onColor }: { onColor?: boolean } = {}) {
  const t = useTranslations('common')
  const locale = useLocale() as Locale
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <Tooltip title={t('language')}>
        <IconButton
          size="small"
          disabled={pending}
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label={t('language')}
          aria-haspopup="menu"
          sx={onColor ? { color: 'inherit', '&:hover': { bgcolor: 'rgba(255,255,255,0.16)' } } : undefined}
        >
          <TranslateOutlined fontSize="small" />
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
        {LOCALES.map((value) => (
          <MenuItem
            key={value}
            selected={value === locale}
            onClick={() => {
              setAnchor(null)
              // A locale change invalidates every rendered string, so the
              // action revalidates the whole layout rather than this subtree.
              startTransition(() => {
                void setLocale(value)
              })
            }}
          >
            <ListItemIcon sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>
              {value.toUpperCase()}
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { variant: 'body2' } }}>
              {LOCALE_LABELS[value]}
            </ListItemText>
            {value === locale ? (
              <Check fontSize="small" sx={{ ml: 1, color: 'primary.main' }} />
            ) : null}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
