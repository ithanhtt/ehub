'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined'
import { acceptInvitation } from '@/features/projects/actions'

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('members')
  const te = useTranslations('errors')
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Button
        variant="contained"
        size="large"
        disabled={pending}
        startIcon={
          pending ? <CircularProgress size={16} color="inherit" /> : <PersonAddAltOutlined />
        }
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const outcome = await acceptInvitation(token)
            if (!outcome.ok) {
              setError(
                outcome.message === 'inviteWrongEmail'
                  ? t('inviteWrongEmail')
                  : outcome.message === 'inviteInvalid'
                    ? t('inviteInvalid')
                    : te('serverError'),
              )
              return
            }
            const projectId = outcome.data?.projectId as string | undefined
            router.push(projectId ? `/projects/${projectId}` : '/projects')
            router.refresh()
          })
        }}
      >
        {t('acceptButton')}
      </Button>
    </Stack>
  )
}
