'use client'

import { useActionState, useState, useTransition } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import MuiLink from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined'
import LaunchOutlined from '@mui/icons-material/LaunchOutlined'
import PowerOutlined from '@mui/icons-material/PowerOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import type { ActionSummary, PluginSummary } from '@/core/plugins/registry'
import type { ConnectionView } from '@/features/connections/queries'
import {
  createConnection,
  deleteConnection,
  testConnectionAction,
  updateConnection,
  type ConnectionActionState,
} from '@/features/connections/actions'
import { EmptyState } from '@/components/ui/page-header'
import { TestFeedback } from './test-feedback'
import { ConnectorActions } from './connector-actions'
import { formatDateTime } from '@/core/utils/format'
import type { Locale } from '@/i18n/config'
import { MONO_STACK } from '@/theme'

const initialState: ConnectionActionState = { ok: false }

type DialogTarget =
  | { mode: 'create'; plugin: PluginSummary }
  | { mode: 'edit'; connection: ConnectionView }

/** Two letters on a brand-coloured tile, used everywhere a plugin is named. */
function PluginAvatar({ name, color, size = 34 }: { name: string; color: string; size?: number }) {
  return (
    <Avatar
      variant="rounded"
      sx={{ width: size, height: size, bgcolor: color, fontSize: size * 0.33, fontWeight: 700 }}
    >
      {name.slice(0, 2).toUpperCase()}
    </Avatar>
  )
}

export function ConnectionsManager({
  projectId,
  plugins,
  connections,
  canManage,
}: {
  projectId: string
  plugins: PluginSummary[]
  connections: ConnectionView[]
  canManage: boolean
}) {
  const t = useTranslations('connections')
  // The target outlives `open` so the dialog keeps its content while it fades
  // out. `session` gives every opening a fresh dialog instance, which is what
  // resets the form fields and the previous submission's result.
  const [dialog, setDialog] = useState<{ target: DialogTarget; open: boolean; session: number } | null>(
    null,
  )
  const [notice, setNotice] = useState<{ severity: 'success' | 'warning'; text: string } | null>(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const noticeTone = notice?.severity ?? 'success'

  const openDialog = (target: DialogTarget) =>
    setDialog((current) => ({ target, open: true, session: (current?.session ?? 0) + 1 }))
  const closeDialog = () => setDialog((current) => (current ? { ...current, open: false } : null))

  const handleSaved = (result: ConnectionActionState, mode: DialogTarget['mode']) => {
    closeDialog()
    setNotice(
      result.testOk
        ? { severity: 'success', text: t(mode === 'create' ? 'created' : 'updated') }
        : { severity: 'warning', text: t('savedTestFailed') },
    )
    setNoticeOpen(true)
  }

  return (
    <Stack spacing={3}>
      {connections.length === 0 ? (
        <EmptyState icon={<PowerOutlined sx={{ fontSize: 32 }} />} title={t('empty')} />
      ) : (
        <Stack spacing={1.5}>
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              projectId={projectId}
              connection={connection}
              actions={plugins.find((p) => p.id === connection.pluginId)?.actions ?? []}
              canManage={canManage}
              onEdit={() => openDialog({ mode: 'edit', connection })}
            />
          ))}
        </Stack>
      )}

      {canManage ? (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            {t('choosePlugin')}
          </Typography>

          <Grid container spacing={2}>
            {plugins.map((plugin) => (
              <Grid key={plugin.id} size={{ xs: 12, sm: 6 }}>
                <PluginCard plugin={plugin} onSelect={() => openDialog({ mode: 'create', plugin })} />
              </Grid>
            ))}
          </Grid>

          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.disabled' }}>
            {/* Points a developer straight at the extension point. */}
            <Box component="code" sx={{ fontFamily: MONO_STACK }}>
              src/plugins/&lt;id&gt;/index.ts
            </Box>
          </Typography>
        </Box>
      ) : null}

      {dialog ? (
        <ConnectionDialog
          key={dialog.session}
          projectId={projectId}
          plugins={plugins}
          target={dialog.target}
          open={dialog.open}
          onClose={closeDialog}
          // Unmount only once the fade-out has finished, and only if nothing
          // was opened in the meantime.
          onExited={() => setDialog((current) => (current?.open ? current : null))}
          onSaved={handleSaved}
        />
      ) : null}

      <Snackbar
        open={noticeOpen}
        autoHideDuration={5000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setNoticeOpen(false)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={noticeTone}
          onClose={() => setNoticeOpen(false)}
          sx={{
            minWidth: 280,
            // It floats over the page, so the severity tint is layered over the
            // opaque floating surface rather than the see-through card fill.
            backgroundColor: 'var(--adshub-surface-floating)',
            backgroundImage: `linear-gradient(rgba(var(--mui-palette-${noticeTone}-mainChannel) / 0.13), rgba(var(--mui-palette-${noticeTone}-mainChannel) / 0.13))`,
            boxShadow: '0 18px 44px -22px rgb(0 0 0 / 0.34)',
          }}
        >
          {notice?.text}
        </Alert>
      </Snackbar>
    </Stack>
  )
}

/* ------------------------------------------------------------ plugin card --- */

function PluginCard({ plugin, onSelect }: { plugin: PluginSummary; onSelect: () => void }) {
  const t = useTranslations('connections')
  const locale = useLocale() as Locale

  return (
    <Paper
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      sx={{
        p: 2,
        height: '100%',
        cursor: 'pointer',
        // The theme strips borders from Paper, so an "add me" affordance has
        // to declare its own dashed outline.
        border: '1px dashed var(--adshub-dashed)',
        transition: 'border-color .15s, background-color .15s',
        '&:hover, &:focus-visible': {
          borderColor: 'primary.main',
          backgroundColor: 'var(--adshub-soft-tint)',
        },
      }}
    >
      <Stack direction="row" spacing={1.5}>
        <PluginAvatar name={plugin.name} color={plugin.color} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2" noWrap>
              {plugin.name}
            </Typography>
            <AddOutlined sx={{ fontSize: 15, color: 'text.disabled' }} />
          </Stack>
          <Typography
            variant="caption"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              mt: 0.25,
              color: 'text.secondary',
            }}
          >
            {plugin.description[locale]}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.disabled' }}>
            {t('endpointsAvailable', { count: plugin.endpointCount })}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  )
}

/* -------------------------------------------------------- connection card --- */

const STATUS_COLOR = {
  connected: 'success',
  error: 'error',
  expired: 'warning',
  draft: 'default',
} as const

function ConnectionCard({
  projectId,
  connection,
  actions,
  canManage,
  onEdit,
}: {
  projectId: string
  connection: ConnectionView
  actions: ActionSummary[]
  canManage: boolean
  onEdit: () => void
}) {
  const t = useTranslations('connections')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string; hint?: string } | null>(null)
  const [showMeta, setShowMeta] = useState(false)

  // A manual test result only stands until the connection is tested again —
  // by saving it from the dialog, say — so it never masks a newer stored one.
  const testedAt = String(connection.lastTestedAt ?? '')
  const [feedbackFor, setFeedbackFor] = useState(testedAt)
  if (feedbackFor !== testedAt) {
    setFeedbackFor(testedAt)
    setFeedback(null)
  }

  const statusLabel = {
    connected: t('statusConnected'),
    error: t('statusError'),
    expired: t('statusExpired'),
    draft: t('statusDraft'),
  }[connection.status]

  const testMessage = feedback?.message ?? connection.lastTestMessage
  const testHint = feedback ? feedback.hint : connection.lastTestHint
  const testOk = feedback ? feedback.ok : connection.lastTestStatus === 'ok'
  const hasMeta = Object.keys(connection.metadata ?? {}).length > 0

  return (
    <Card>
      <CardContent sx={{ p: 2 }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1.5 }}
        >
          <Stack direction="row" spacing={1.5} sx={{ minWidth: 0, flex: 1 }}>
            <PluginAvatar name={connection.pluginName} color={connection.pluginColor} />
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography variant="subtitle2" noWrap>
                  {connection.name}
                </Typography>
                <Chip
                  size="small"
                  label={statusLabel}
                  color={STATUS_COLOR[connection.status]}
                  variant={connection.status === 'draft' ? 'outlined' : 'filled'}
                />
                {connection.orphaned ? (
                  <Chip size="small" color="warning" variant="outlined" label="plugin missing" />
                ) : null}
              </Stack>

              <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'text.secondary' }}>
                {connection.pluginName} ·{' '}
                {t('endpointsAvailable', { count: connection.endpointCount })}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
                {t('lastTested')}:{' '}
                {connection.lastTestedAt
                  ? formatDateTime(connection.lastTestedAt, locale)
                  : tc('never')}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={pending}
              startIcon={
                pending ? <CircularProgress size={14} /> : <RefreshOutlined sx={{ fontSize: 16 }} />
              }
              onClick={() =>
                startTransition(async () => {
                  const outcome = await testConnectionAction(projectId, connection.id)
                  setFeedback({
                    ok: Boolean(outcome.testOk),
                    message: outcome.testMessage ?? outcome.message ?? '',
                    hint: outcome.testHint,
                  })
                })
              }
            >
              {pending ? t('testing') : t('test')}
            </Button>

            {connection.status === 'connected' ? (
              <Tooltip title={t('openInHub')}>
                <IconButton
                  size="small"
                  component={Link}
                  href={`/projects/${projectId}/hub?connection=${connection.id}`}
                >
                  <LaunchOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}

            {canManage ? (
              <>
                <Tooltip title={tc('edit')}>
                  <IconButton size="small" onClick={onEdit}>
                    <EditOutlined fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={tc('delete')}>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(t('deleteConfirm'))) return
                      startTransition(async () => {
                        await deleteConnection(projectId, connection.id)
                      })
                    }}
                  >
                    <DeleteOutlineOutlined fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
          </Stack>
        </Stack>

        {testMessage || testHint ? (
          <Box sx={{ mt: 1.5 }}>
            <TestFeedback ok={testOk} message={testMessage} hint={testHint} />
          </Box>
        ) : null}

        {hasMeta ? (
          <Box sx={{ mt: 1.5 }}>
            <Button
              size="small"
              color="inherit"
              onClick={() => setShowMeta((v) => !v)}
              endIcon={
                <ExpandMoreOutlined
                  sx={{
                    fontSize: 16,
                    transition: 'transform .15s',
                    transform: showMeta ? 'rotate(180deg)' : 'none',
                  }}
                />
              }
              sx={{ color: 'text.disabled', fontWeight: 400 }}
            >
              metadata
            </Button>
            <Collapse in={showMeta}>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  mt: 1,
                  p: 1.5,
                  maxHeight: 200,
                  overflow: 'auto',
                  borderRadius: 1.5,
                  bgcolor: 'action.hover',
                  fontFamily: MONO_STACK,
                  fontSize: 11,
                  lineHeight: 1.6,
                }}
              >
                {JSON.stringify(connection.metadata, null, 2)}
              </Box>
            </Collapse>
          </Box>
        ) : null}

        {!connection.orphaned ? (
          <ConnectorActions
            projectId={projectId}
            connectionId={connection.id}
            actions={actions}
            canManage={canManage}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------ create/edit dialog --- */

function ConnectionDialog({
  projectId,
  plugins,
  target,
  open,
  onClose,
  onExited,
  onSaved,
}: {
  projectId: string
  plugins: PluginSummary[]
  target: DialogTarget
  open: boolean
  onClose: () => void
  onExited: () => void
  onSaved: (result: ConnectionActionState, mode: DialogTarget['mode']) => void
}) {
  const t = useTranslations('connections')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const locale = useLocale() as Locale

  const connection = target.mode === 'edit' ? target.connection : undefined
  const plugin =
    target.mode === 'create' ? target.plugin : plugins.find((p) => p.id === connection?.pluginId)

  const save = connection
    ? updateConnection.bind(null, projectId, connection.id)
    : createConnection.bind(null, projectId)
  const [state, formAction, pending] = useActionState(
    async (previous: ConnectionActionState, formData: FormData) => {
      const result = await save(previous, formData)
      // Saved means done, whatever the test said: the connection is stored
      // either way and its card shows the result. Staying open would only
      // invite a second "Add", which then fails as a duplicate name.
      if (result.ok) onSaved(result, target.mode)
      return result
    },
    initialState,
  )

  // Codes the actions use for a bad request. Any other message is the
  // provider's own wording from resolving the credentials, and gets the same
  // two-layer display as a test result.
  const requestErrors: Record<string, string> = {
    nameTaken: t('nameTaken'),
    validation: te('validation'),
    forbidden: te('forbidden'),
    notFound: te('notFound'),
  }
  const failed = !state.ok && Boolean(state.message || state.testHint)

  return (
    <Dialog
      open={open}
      onClose={() => (pending ? null : onClose())}
      maxWidth="sm"
      slotProps={{ transition: { onExited } }}
    >
      {plugin ? (
        // The form sits between the dialog paper and its sections, so it has to
        // pass the flex column on: without it the whole paper scrolls — title,
        // buttons and all — instead of just the fields.
        <Box
          component="form"
          action={formAction}
          sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <PluginAvatar name={plugin.name} color={plugin.color} size={28} />
              <span>{connection ? connection.name : `${t('addTitle')} · ${plugin.name}`}</span>
            </Stack>
          </DialogTitle>

          <DialogContent dividers>
            <Stack spacing={2.5}>
              {plugin.authInstructions ? (
                <Alert severity="info">
                  <AlertTitle sx={{ fontSize: '0.8125rem' }}>{t('instructions')}</AlertTitle>
                  {plugin.authInstructions[locale]}
                  {plugin.docsUrl ? (
                    <MuiLink
                      href={plugin.docsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        mt: 0.75,
                        fontWeight: 600,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {plugin.docsUrl}
                      <LaunchOutlined sx={{ fontSize: 13 }} />
                    </MuiLink>
                  ) : null}
                </Alert>
              ) : null}

              <input type="hidden" name="pluginId" value={plugin.id} />

              <TextField
                name="name"
                label={t('connectionName')}
                required
                defaultValue={connection?.name ?? ''}
                slotProps={{ htmlInput: { maxLength: 120 } }}
                placeholder={`${plugin.name} – ${locale === 'vi' ? 'tài khoản chính' : 'main account'}`}
                helperText={t('connectionNameHint')}
              />

              <Box
                component="fieldset"
                // A fieldset refuses to shrink below its content by default,
                // which pushes a sideways scrollbar onto the dialog.
                sx={{
                  m: 0,
                  minWidth: 0,
                  px: 2,
                  pt: 1,
                  pb: 2,
                  border: '1px dashed var(--adshub-dashed)',
                  borderRadius: 3.5,
                }}
              >
                <Typography component="legend" variant="subtitle2" sx={{ px: 0.75 }}>
                  {t('credentials')}
                </Typography>

                <Stack spacing={2.5} sx={{ mt: 1 }}>
                  {plugin.authFields.map((field) => {
                    const stored = connection?.fieldState.find((f) => f.key === field.key)
                    return (
                      <TextField
                        key={field.key}
                        name={`cred_${field.key}`}
                        label={`${field.label[locale]}${field.required ? '' : ` (${tc('optional')})`}`}
                        type={field.type === 'password' ? 'password' : 'text'}
                        // A stored secret is required but must not be re-typed
                        // to save an unrelated change, so the browser
                        // requirement drops once a value exists; the server
                        // still enforces it.
                        required={field.required && !stored?.filled}
                        defaultValue={field.secret ? '' : (stored?.value ?? '')}
                        placeholder={
                          field.secret && stored?.filled
                            ? t('secretStored')
                            : (field.placeholder ?? '')
                        }
                        autoComplete="off"
                        helperText={field.help?.[locale]}
                        slotProps={{
                          htmlInput: { style: { fontFamily: MONO_STACK, fontSize: 13 } },
                        }}
                      />
                    )
                  })}
                </Stack>
              </Box>
            </Stack>
          </DialogContent>

          {failed ? (
            // Outside the scrolling area, next to the button just pressed: an
            // error at the top of a long form is out of sight when it appears.
            <Box sx={{ px: 3, pt: 2, maxHeight: '40vh', overflowY: 'auto', flexShrink: 0 }}>
              {state.message && requestErrors[state.message] ? (
                <Alert severity="error">{requestErrors[state.message]}</Alert>
              ) : (
                <TestFeedback ok={false} message={state.message} hint={state.testHint} />
              )}
            </Box>
          ) : null}

          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={onClose} disabled={pending} color="inherit">
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={pending}
              startIcon={pending ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {pending ? t('testing') : connection ? tc('save') : t('add')}
            </Button>
          </DialogActions>
        </Box>
      ) : (
        <DialogContent>
          <Alert severity="warning">This connection&apos;s plugin is no longer registered.</Alert>
        </DialogContent>
      )}
    </Dialog>
  )
}
