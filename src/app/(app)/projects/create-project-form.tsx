'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { createProject, type ActionState } from '@/features/projects/actions'

const initialState: ActionState = { ok: false }

export function CreateProjectForm({ fullWidth }: { fullWidth?: boolean }) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createProject, initialState)

  return (
    <>
      <Button
        variant="contained"
        startIcon={<AddOutlined />}
        onClick={() => setOpen(true)}
        fullWidth={fullWidth}
      >
        {t('create')}
      </Button>

      <Dialog open={open} onClose={() => (pending ? null : setOpen(false))}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{t('createTitle')}</DialogTitle>

        {/*
          The form element wraps content and actions so the submit button is
          inside it and Enter submits from any field.
        */}
        <form action={formAction}>
          <DialogContent dividers>
            <Stack spacing={2.5}>
              {state.message ? (
                <Alert severity="error">
                  {state.message === 'validation' ? t('nameRequired') : te('serverError')}
                </Alert>
              ) : null}

              <TextField
                name="name"
                label={tc('name')}
                required
                autoFocus
                slotProps={{ htmlInput: { maxLength: 120 } }}
                placeholder={t('namePlaceholder')}
              />

              <TextField
                name="description"
                label={`${tc('description')} (${tc('optional')})`}
                multiline
                rows={3}
                slotProps={{ htmlInput: { maxLength: 500 } }}
                placeholder={t('descriptionPlaceholder')}
              />
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setOpen(false)} disabled={pending} color="inherit">
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={pending}
              startIcon={pending ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {pending ? tc('saving') : tc('create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}
