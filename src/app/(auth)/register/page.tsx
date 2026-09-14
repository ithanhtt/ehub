'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import MuiLink from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined'
import { authClient } from '@/core/auth/client'

export default function RegisterPage() {
  const t = useTranslations('auth')
  const router = useRouter()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== password

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError(t('passwordMismatch'))
      return
    }

    setPending(true)
    const { error: authError } = await authClient.signUp.email({ name, email, password })

    if (authError) {
      const message = authError.message ?? ''
      setError(/exist|taken|unique/i.test(message) ? t('emailTaken') : message || t('signUp'))
      setPending(false)
      return
    }

    router.push('/projects')
    router.refresh()
  }

  return (
    <Card sx={{ boxShadow: '0 12px 32px -18px rgb(0 0 0 / 0.28)' }}>
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Typography variant="h3" component="h1">
          {t('registerTitle')}
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
          {t('registerSubtitle')}
        </Typography>

        <Stack component="form" onSubmit={handleSubmit} spacing={2.5} sx={{ mt: 3.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <TextField
            label={t('name')}
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <TextField
            label={t('email')}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@congty.vn"
          />

          <TextField
            label={t('password')}
            type="password"
            autoComplete="new-password"
            required
            slotProps={{ htmlInput: { minLength: 8 } }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText={t('passwordHint')}
          />

          <TextField
            label={t('confirmPassword')}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch}
            helperText={mismatch ? t('passwordMismatch') : ' '}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={pending || mismatch}
            startIcon={
              pending ? <CircularProgress size={16} color="inherit" /> : <PersonAddAltOutlined />
            }
          >
            {pending ? t('signingUp') : t('signUp')}
          </Button>
        </Stack>

        <Typography variant="body2" sx={{ mt: 3, textAlign: 'center', color: 'text.secondary' }}>
          {t('hasAccount')}{' '}
          <MuiLink component={Link} href="/login" sx={{ fontWeight: 600 }} underline="hover">
            {t('signIn')}
          </MuiLink>
        </Typography>
      </CardContent>
    </Card>
  )
}
