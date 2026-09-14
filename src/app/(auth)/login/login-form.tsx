'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import MuiLink from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import LoginOutlined from '@mui/icons-material/LoginOutlined'
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined'
import { authClient } from '@/core/auth/client'

export function LoginForm({ freshInstall }: { freshInstall: boolean }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const searchParams = useSearchParams()
  // "/" reopens the overview of the project this browser was in last (see app/page.tsx).
  const redirectTo = searchParams.get('next') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const { error: authError } = await authClient.signIn.email({ email, password })

    if (authError) {
      /*
       * Only a real credential rejection gets the credential message.
       *
       * The old code returned it for *every* failure, so an unreachable
       * database or a 500 looked exactly like a typo — the one situation
       * where the message actively misleads. 401 is the provider's answer for
       * "these credentials do not work", and it stays deliberately vague about
       * whether the account exists so it cannot be used to enumerate users.
       */
      setError(authError.status === 401 ? t('invalidCredentials') : t('signInUnavailable'))
      setPending(false)
      return
    }

    router.push(redirectTo)
    router.refresh()
  }

  return (
    <Card sx={{ boxShadow: '0 12px 32px -18px rgb(0 0 0 / 0.28)' }}>
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Typography variant="h3" component="h1">
          {t('loginTitle')}
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
          {t('loginSubtitle')}
        </Typography>

        {/*
          An empty database is the one case where correct credentials still
          fail, so it has to be said out loud — otherwise the only feedback is
          "wrong password" for an account that was never there.
        */}
        {freshInstall ? (
          <Alert
            severity="info"
            sx={{ mt: 3 }}
            action={
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                href="/register"
                startIcon={<PersonAddAltOutlined sx={{ fontSize: 16 }} />}
              >
                {t('signUp')}
              </Button>
            }
          >
            <AlertTitle sx={{ fontSize: '0.8125rem', mb: 0.25 }}>{t('noAccountsTitle')}</AlertTitle>
            {t('noAccountsBody')}
          </Alert>
        ) : null}

        <Stack component="form" onSubmit={handleSubmit} spacing={2.5} sx={{ mt: 3.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}

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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={pending}
            startIcon={pending ? <CircularProgress size={16} color="inherit" /> : <LoginOutlined />}
          >
            {pending ? t('signingIn') : t('signIn')}
          </Button>
        </Stack>

        <Typography variant="body2" sx={{ mt: 3, textAlign: 'center', color: 'text.secondary' }}>
          {t('noAccount')}{' '}
          <MuiLink component={Link} href="/register" sx={{ fontWeight: 600 }} underline="hover">
            {t('signUp')}
          </MuiLink>
        </Typography>
      </CardContent>
    </Card>
  )
}
