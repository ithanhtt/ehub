'use client'

import { useActionState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import { deleteProject, updateProject, type ActionState } from '@/features/projects/actions'
import { MONO_STACK } from '@/theme'

const initialState: ActionState = { ok: false }

export function GeneralForm({
  projectId,
  project,
  canUpdate,
  canDelete,
}: {
  projectId: string
  project: {
    name: string
    description: string | null
    timezone: string
    currency: string
    slug: string
  }
  canUpdate: boolean
  canDelete: boolean
}) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction, pending] = useActionState(
    updateProject.bind(null, projectId),
    initialState,
  )
  const [deleting, startDeleting] = useTransition()

  const monoInput = { htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 760 }}>
      <Card>
        <CardHeader title={tc('settings')} />
        <form action={formAction}>
          <CardContent>
            <Stack spacing={2.5}>
              {state.message ? (
                <Alert severity="error">
                  {state.message === 'validation' ? te('validation') : te('forbidden')}
                </Alert>
              ) : null}
              {state.ok ? <Alert severity="success">{tc('save')}</Alert> : null}

              <TextField
                name="name"
                label={tc('name')}
                required
                defaultValue={project.name}
                disabled={!canUpdate}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />

              <TextField
                name="description"
                label={`${tc('description')} (${tc('optional')})`}
                multiline
                rows={3}
                defaultValue={project.description ?? ''}
                disabled={!canUpdate}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5}>
                <TextField
                  name="timezone"
                  label={t('timezone')}
                  defaultValue={project.timezone}
                  disabled={!canUpdate}
                  slotProps={monoInput}
                />
                <TextField
                  name="currency"
                  label={t('currency')}
                  defaultValue={project.currency}
                  disabled={!canUpdate}
                  slotProps={{ htmlInput: { ...monoInput.htmlInput, maxLength: 8 } }}
                />
              </Stack>

              {/* Read-only: the slug is derived from the name at creation and
                  changing it later would break links people have saved. */}
              <TextField
                label="slug"
                value={project.slug}
                slotProps={{ htmlInput: { readOnly: true, ...monoInput.htmlInput } }}
              />
            </Stack>
          </CardContent>

          {canUpdate ? (
            <>
              <Divider />
              <Stack direction="row" sx={{ px: 2.5, py: 2, justifyContent: 'flex-end' }}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={pending}
                  startIcon={pending ? <CircularProgress size={16} color="inherit" /> : null}
                >
                  {pending ? tc('saving') : tc('save')}
                </Button>
              </Stack>
            </>
          ) : null}
        </form>
      </Card>

      {canDelete ? (
        <Card sx={{ borderColor: 'error.main' }}>
          <CardHeader
            title={
              <Typography variant="h6" sx={{ color: 'error.main' }}>
                {tc('delete')}
              </Typography>
            }
          />
          <CardContent>
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              {t('deleteConfirm')}
            </Typography>
            <Button
              variant="contained"
              color="error"
              disabled={deleting}
              startIcon={
                deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineOutlined />
              }
              onClick={() => {
                if (!window.confirm(t('deleteConfirm'))) return
                startDeleting(async () => {
                  await deleteProject(projectId)
                })
              }}
            >
              {tc('delete')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  )
}
