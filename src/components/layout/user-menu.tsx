'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import DnsOutlined from '@mui/icons-material/DnsOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import SystemUpdateAltOutlined from '@mui/icons-material/SystemUpdateAltOutlined'
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined'
import { authClient } from '@/core/auth/client'
import { initialsOf } from '@/core/utils/format'

export function UserMenu({
  name,
  email,
  isAdmin,
  onColor,
}: {
  name: string
  email: string
  isAdmin: boolean
  /** Placement on the green header: the monogram inverts to stay legible. */
  onColor?: boolean
}) {
  const t = useTranslations('common')
  const router = useRouter()
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await authClient.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        sx={{
          gap: 1,
          pl: 0.5,
          pr: { xs: 0.5, sm: 1 },
          py: 0.5,
          borderRadius: 2,
          color: 'inherit',
          '&:hover': { bgcolor: onColor ? 'rgba(255,255,255,0.16)' : 'action.hover' },
        }}
      >
        <Avatar
          sx={{
            width: 26,
            height: 26,
            fontSize: 11,
            fontWeight: 700,
            ...(onColor
              ? { bgcolor: 'common.white', color: 'primary.dark' }
              : { bgcolor: 'primary.main', color: 'primary.contrastText' }),
          }}
        >
          {initialsOf(name)}
        </Avatar>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, maxWidth: 140, display: { xs: 'none', sm: 'block' } }}
          noWrap
        >
          {name}
        </Typography>
      </ButtonBase>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 250 } } }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} noWrap>
            {email}
          </Typography>
          {isAdmin ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              icon={<VerifiedUserOutlined sx={{ fontSize: 14 }} />}
              label="Administrator"
              sx={{ mt: 1 }}
            />
          ) : null}
        </Box>

        <Divider />

        {isAdmin ? (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              router.push('/admin/system')
            }}
            sx={{ mt: 0.5 }}
          >
            <ListItemIcon>
              <DnsOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { variant: 'body2' } }}>{t('systemInfo')}</ListItemText>
          </MenuItem>
        ) : null}

        {isAdmin ? (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              router.push('/admin/database')
            }}
          >
            <ListItemIcon>
              <StorageOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { variant: 'body2' } }}>{t('database')}</ListItemText>
          </MenuItem>
        ) : null}

        {isAdmin ? (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              router.push('/admin/updates')
            }}
          >
            <ListItemIcon>
              <SystemUpdateAltOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { variant: 'body2' } }}>{t('systemUpdate')}</ListItemText>
          </MenuItem>
        ) : null}

        <MenuItem onClick={handleSignOut} disabled={signingOut} sx={{ mt: isAdmin ? 0 : 0.5 }}>
          <ListItemIcon>
            {signingOut ? <CircularProgress size={16} /> : <LogoutOutlined fontSize="small" />}
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { variant: 'body2' } }}>{t('logout')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
