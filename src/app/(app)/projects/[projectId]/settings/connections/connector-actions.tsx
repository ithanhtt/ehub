'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import { CredentialField } from '@/components/ui/credential-field'
import Typography from '@mui/material/Typography'
import BuildOutlined from '@mui/icons-material/BuildOutlined'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import HelpOutlineOutlined from '@mui/icons-material/HelpOutlineOutlined'
import RemoveCircleOutlineOutlined from '@mui/icons-material/RemoveCircleOutlineOutlined'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import type { ActionSummary } from '@/core/plugins/registry'
import type { ActionFinding, FindingState } from '@/core/plugins/types'
import { runConnectionAction } from '@/features/connections/actions'
import { DashedDivider } from '@/components/ui/soft'
import type { Locale } from '@/i18n/config'
import { MONO_STACK } from '@/theme'

type Outcome = {
  ok: boolean
  message?: string
  hint?: string
  findings?: ActionFinding[]
  failed?: string
}

/**
 * Renders the repair tools a connector declares.
 *
 * Knows nothing about any particular provider: the buttons, their input
 * fields and their result all come from the plugin. That is what lets a
 * connector ship its own troubleshooting without a change here.
 */
export function ConnectorActions({
  projectId,
  connectionId,
  actions,
  canManage,
}: {
  projectId: string
  connectionId: string
  actions: ActionSummary[]
  canManage: boolean
}) {
  const t = useTranslations('connections')
  const locale = useLocale() as Locale
  const [dialogAction, setDialogAction] = useState<ActionSummary | null>(null)
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // A mutating tool is offered only to someone allowed to change credentials.
  const available = actions.filter((action) => canManage || !action.mutatesCredentials)
  if (available.length === 0) return null

  function run(action: ActionSummary, input: Record<string, string>) {
    setBusyId(action.id)
    startTransition(async () => {
      const result = await runConnectionAction(projectId, connectionId, action.id, input)
      setOutcome((prev) => ({
        ...prev,
        [action.id]: result.ok
          ? {
              ok: Boolean(result.actionOk),
              message: result.actionMessage,
              hint: result.actionHint,
              findings: result.findings,
            }
          : { ok: false, failed: result.message },
      }))
      setBusyId(null)
      setDialogAction(null)
    })
  }

  return (
    <Box sx={{ mt: 1.5 }}>
      <DashedDivider sx={{ mb: 1.5 }} />
      <Typography variant="overline" sx={{ display: 'block', mb: 1, color: 'text.disabled' }}>
        {t('tools')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {available.map((action) => (
          <Button
            key={action.id}
            size="small"
            variant="outlined"
            color="inherit"
            disabled={busyId !== null}
            startIcon={
              busyId === action.id ? (
                <CircularProgress size={14} />
              ) : (
                <BuildOutlined sx={{ fontSize: 16 }} />
              )
            }
            onClick={() => {
              if (action.inputs.length > 0) setDialogAction(action)
              else run(action, {})
            }}
          >
            {action.label[locale]}
          </Button>
        ))}
      </Stack>

      <Stack spacing={1.5} sx={{ mt: available.some((a) => outcome[a.id]) ? 1.5 : 0 }}>
        {available.map((action) =>
          outcome[action.id] ? (
            <ActionOutcome key={action.id} action={action} outcome={outcome[action.id]} />
          ) : null,
        )}
      </Stack>

      <ActionInputDialog
        action={dialogAction}
        busy={busyId !== null}
        onClose={() => setDialogAction(null)}
        onSubmit={(input) => dialogAction && run(dialogAction, input)}
      />
    </Box>
  )
}

/* ------------------------------------------------------------- outcome --- */

const FINDING_ICON: Record<FindingState, React.ReactNode> = {
  ok: <CheckCircleOutlined sx={{ fontSize: 16, color: 'success.main' }} />,
  fail: <ErrorOutlineOutlined sx={{ fontSize: 16, color: 'error.main' }} />,
  warn: <WarningAmberOutlined sx={{ fontSize: 16, color: 'warning.main' }} />,
  unknown: <HelpOutlineOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />,
  skipped: <RemoveCircleOutlineOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />,
}

function ActionOutcome({ action, outcome }: { action: ActionSummary; outcome: Outcome }) {
  const t = useTranslations('connections')
  const te = useTranslations('errors')
  const locale = useLocale() as Locale

  if (outcome.failed) {
    return (
      <Alert severity="error">
        {outcome.failed === 'forbidden' ? te('forbidden') : te('serverError')}
      </Alert>
    )
  }

  const hintText = outcome.hint ? safeTranslate(t, `hints.${outcome.hint}`) : null

  return (
    <Alert severity={outcome.ok ? 'success' : 'warning'}>
      <AlertTitle sx={{ fontSize: '0.8125rem' }}>{action.label[locale]}</AlertTitle>

      {/*
        The checklist is the point of a diagnosis: one line per credential, so
        the user can see which single item is failing rather than inferring it
        from a summary sentence.
      */}
      {outcome.findings?.length ? (
        <Stack
          spacing={0.75}
          sx={{
            mb: outcome.message || hintText ? 1.25 : 0,
            /*
             * A credential diagnosis is three lines and wants no chrome. The
             * permission probe returns one line per endpoint — over a hundred
             * — and without a ceiling the summary and the hint below, which
             * are the actionable part, end up off screen.
             */
            ...(outcome.findings.length > 12
              ? { maxHeight: 320, overflowY: 'auto', pr: 1 }
              : null),
          }}
        >
          {outcome.findings.map((finding, index) => (
            <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', mt: 0.1 }}>{FINDING_ICON[finding.state]}</Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {finding.label[locale]}
                </Typography>
                {finding.detail ? (
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', fontFamily: MONO_STACK, fontSize: 11, opacity: 0.85, wordBreak: 'break-word' }}
                  >
                    {finding.detail}
                  </Typography>
                ) : null}
              </Box>
            </Stack>
          ))}
        </Stack>
      ) : null}

      {hintText ? (
        <Typography variant="body2" sx={{ mb: outcome.message ? 0.75 : 0 }}>
          {hintText}
        </Typography>
      ) : null}

      {outcome.message ? (
        <Typography
          variant="caption"
          sx={{ display: 'block', fontFamily: MONO_STACK, fontSize: 11.5, opacity: 0.8, wordBreak: 'break-word' }}
        >
          {outcome.message}
        </Typography>
      ) : null}
    </Alert>
  )
}

/* --------------------------------------------------------- input dialog --- */

function ActionInputDialog({
  action,
  busy,
  onClose,
  onSubmit,
}: {
  action: ActionSummary | null
  busy: boolean
  onClose: () => void
  onSubmit: (input: Record<string, string>) => void
}) {
  const tc = useTranslations('common')
  const locale = useLocale() as Locale
  const [values, setValues] = useState<Record<string, string>>({})

  return (
    <Dialog
      open={Boolean(action)}
      onClose={() => (busy ? null : onClose())}
      // Remount per action so fields never carry a value across tools.
      key={action?.id ?? 'none'}
    >
      {action ? (
        <form
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit(values)
          }}
        >
          <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>
            {action.label[locale]}
          </DialogTitle>

          <DialogContent dividers>
            <Stack spacing={2.5}>
              {action.description ? (
                <Alert severity="info">{action.description[locale]}</Alert>
              ) : null}

              {action.inputs.map((field) => (
                <CredentialField
                  key={field.key}
                  label={field.label[locale]}
                  secret={field.type === 'password' || Boolean(field.secret)}
                  required={field.required}
                  helperText={field.help?.[locale]}
                  value={values[field.key] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  slotProps={{ htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } } }}
                />
              ))}
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={onClose} disabled={busy} color="inherit">
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={busy}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {tc('confirm')}
            </Button>
          </DialogActions>
        </form>
      ) : null}
    </Dialog>
  )
}

function safeTranslate(t: ReturnType<typeof useTranslations>, key: string): string | null {
  try {
    return t(key as never)
  } catch {
    return null
  }
}
