'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
import { signInAction, type SignInState } from './actions'

const INITIAL: SignInState = { error: null, email: '' }

/**
 * Posts to a server action (./actions): the form signs in the moment it is on
 * screen, JavaScript or not — on a slow phone a tap no longer just reloads the
 * page. Once the page runs, the same action is called without a reload, and
 * its answer (an error, or the redirect) comes back the same way.
 */
export function LoginForm({ freshInstall }: { freshInstall: boolean }) {
  const t = useTranslations('auth')
  const searchParams = useSearchParams()
  // "/" reopens the overview of the project this browser was in last (see app/page.tsx); the server keeps it on this site.
  const redirectTo = searchParams.get('next') ?? '/'

  const [state, formAction, pending] = useActionState(signInAction, INITIAL)
  // Held by the page once it runs, so a failed try keeps the address typed (a form action resets uncontrolled fields).
  const [email, setEmail] = useState(state.email)
  // Each answer brings back the address it was given (a page rendered without JavaScript starts from it too).
  useEffect(() => {
    if (state.email) setEmail(state.email)
  }, [state])
  const [password, setPassword] = useState('')

  /*
   * Only a real credential rejection gets the credential message: an
   * unreachable database or a 500 must not look like a typo. The credential
   * message stays vague about whether the account exists, so it cannot be
   * used to find out who has one.
   */
  const error =
    state.error === 'invalid'
      ? t('invalidCredentials')
      : state.error === 'tooMany'
        ? t('tooManyAttempts')
        : state.error === 'insecure'
          ? t('signInInsecure', { url: state.url ?? '' })
          : state.error === 'unavailable'
            ? t('signInUnavailable')
            : null

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

        <Stack component="form" action={formAction} spacing={2.5} sx={{ mt: 3.5 }}>
          {error ? (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <input type="hidden" name="next" value={redirectTo} />

          <TextField
            label={t('email')}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@congty.vn"
          />

          <TextField
            label={t('password')}
            type="password"
            name="password"
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
