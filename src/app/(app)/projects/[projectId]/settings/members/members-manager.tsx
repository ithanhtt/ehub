'use client'

import { useActionState, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import MailOutlined from '@mui/icons-material/MailOutlined'
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined'
import type { ProjectRole } from '@/core/db/schema/projects'
import { ASSIGNABLE_ROLES } from '@/core/auth/rbac'
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
  type ActionState,
} from '@/features/projects/actions'
import type { ProjectMemberRow } from '@/features/projects/queries'
import { formatDateTime, initialsOf } from '@/core/utils/format'
import { MONO_STACK } from '@/theme'

const initialState: ActionState = { ok: false }

export type PendingInvitation = {
  id: string
  email: string
  role: ProjectRole
  token: string
  expiresAt: Date
}

export function MembersManager({
  projectId,
  members,
  invitations,
  currentUserId,
  canInvite,
  canManageRoles,
}: {
  projectId: string
  members: ProjectMemberRow[]
  invitations: PendingInvitation[]
  currentUserId: string
  canInvite: boolean
  canManageRoles: boolean
}) {
  const t = useTranslations('members')
  const tr = useTranslations('roles')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const locale = useLocale()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function mapError(code?: string): string {
    if (code === 'cannotEditOwner') return t('cannotEditOwner')
    if (code === 'alreadyMember') return t('alreadyMember')
    if (code === 'forbidden') return te('forbidden')
    return te('serverError')
  }

  return (
    <Stack spacing={2.5}>
      {rowError ? (
        <Alert severity="error" onClose={() => setRowError(null)}>
          {rowError}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title={t('title')}
          action={
            canInvite ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<PersonAddAltOutlined />}
                onClick={() => setInviteOpen(true)}
              >
                {t('invite')}
              </Button>
            ) : null
          }
        />
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <List disablePadding>
            {members.map((member, index) => {
              const isSelf = member.userId === currentUserId
              const editable = canManageRoles && member.role !== 'owner' && !isSelf

              return (
                <ListItem
                  key={member.membershipId}
                  divider={index < members.length - 1}
                  sx={{ px: 2.5, py: 1.5, gap: 2, flexWrap: 'wrap' }}
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <Avatar sx={{ width: 32, height: 32, fontSize: 12, fontWeight: 700 }}>
                      {initialsOf(member.name)}
                    </Avatar>
                  </ListItemAvatar>

                  <ListItemText
                    sx={{ minWidth: 160, flex: 1 }}
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {member.name}
                        </Typography>
                        {isSelf ? (
                          <Chip size="small" color="primary" variant="outlined" label={t('you')} />
                        ) : null}
                      </Stack>
                    }
                    secondary={
                      <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                        {member.email} · {t('joinedAt')} {formatDateTime(member.joinedAt, locale)}
                      </Typography>
                    }
                    disableTypography
                  />

                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                    {editable ? (
                      <TextField
                        select
                        value={member.role}
                        disabled={busyId === member.membershipId}
                        aria-label={t('changeRole')}
                        sx={{ width: 148 }}
                        onChange={(event) => {
                          const nextRole = event.target.value
                          setBusyId(member.membershipId)
                          setRowError(null)
                          startTransition(async () => {
                            const outcome = await changeMemberRole(
                              projectId,
                              member.membershipId,
                              nextRole,
                            )
                            if (!outcome.ok) setRowError(mapError(outcome.message))
                            setBusyId(null)
                          })
                        }}
                      >
                        {ASSIGNABLE_ROLES.map((role) => (
                          <MenuItem key={role} value={role} sx={{ fontSize: 13 }}>
                            {tr(role)}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      <Chip
                        size="small"
                        label={tr(member.role)}
                        color={member.role === 'owner' ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    )}

                    {editable ? (
                      <Tooltip title={t('remove')}>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={busyId === member.membershipId}
                          onClick={() => {
                            if (!window.confirm(t('removeConfirm'))) return
                            setBusyId(member.membershipId)
                            setRowError(null)
                            startTransition(async () => {
                              const outcome = await removeMember(projectId, member.membershipId)
                              if (!outcome.ok) setRowError(mapError(outcome.message))
                              setBusyId(null)
                            })
                          }}
                        >
                          {busyId === member.membershipId ? (
                            <CircularProgress size={16} />
                          ) : (
                            <DeleteOutlineOutlined fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                </ListItem>
              )
            })}
          </List>
        </CardContent>
      </Card>

      {invitations.length > 0 ? (
        <Card>
          <CardHeader title={t('pendingInvites')} />
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <List disablePadding>
              {invitations.map((invitation, index) => (
                <ListItem
                  key={invitation.id}
                  divider={index < invitations.length - 1}
                  sx={{ px: 2.5, py: 1.75, display: 'block' }}
                >
                  <Stack
                    direction="row"
                    spacing={2}
                    sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {invitation.email}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {tr(invitation.role)} · {formatDateTime(invitation.expiresAt, locale)}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      color="inherit"
                      disabled={busyId === invitation.id}
                      onClick={() => {
                        setBusyId(invitation.id)
                        startTransition(async () => {
                          await revokeInvitation(projectId, invitation.id)
                          setBusyId(null)
                        })
                      }}
                    >
                      {t('revoke')}
                    </Button>
                  </Stack>
                  <Box sx={{ mt: 1 }}>
                    <InviteLink token={invitation.token} />
                  </Box>
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      ) : null}

      <InviteDialog
        projectId={projectId}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        mapError={mapError}
      />
    </Stack>
  )
}

/* ----------------------------------------------------------- invite dialog --- */

function InviteDialog({
  projectId,
  open,
  onClose,
  mapError,
}: {
  projectId: string
  open: boolean
  onClose: () => void
  mapError: (code?: string) => string
}) {
  const t = useTranslations('members')
  const tr = useTranslations('roles')
  const tc = useTranslations('common')
  const [state, formAction, pending] = useActionState(
    inviteMember.bind(null, projectId),
    initialState,
  )

  const newToken = state.ok ? (state.data?.token as string | undefined) : undefined

  return (
    <Dialog open={open} onClose={() => (pending ? null : onClose())}>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{t('inviteTitle')}</DialogTitle>

      <form action={formAction}>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {state.message ? <Alert severity="error">{mapError(state.message)}</Alert> : null}

            {newToken ? (
              <Alert severity="success">
                <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                  {t('inviteLinkHint')}
                </Typography>
                <InviteLink token={newToken} />
              </Alert>
            ) : null}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                name="email"
                label={t('inviteEmail')}
                type="email"
                required
                placeholder="thanhvien@congty.vn"
                sx={{ flex: 1 }}
              />
              <TextField select name="role" label={t('inviteRole')} defaultValue="viewer" sx={{ width: { sm: 160 } }}>
                {ASSIGNABLE_ROLES.map((role) => (
                  <MenuItem key={role} value={role} sx={{ fontSize: 13 }}>
                    {tr(role)}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Divider />

            <Stack spacing={0.75}>
              {ASSIGNABLE_ROLES.map((role) => (
                <Typography key={role} variant="caption" sx={{ color: 'text.secondary' }}>
                  <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                    {tr(role)}
                  </Box>{' '}
                  — {tr(`${role}Desc` as 'adminDesc')}
                </Typography>
              ))}
            </Stack>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={pending} color="inherit">
            {tc('close')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={pending}
            startIcon={pending ? <CircularProgress size={16} color="inherit" /> : <MailOutlined />}
          >
            {t('inviteSubmit')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/* ------------------------------------------------------------- invite link --- */

function InviteLink({ token }: { token: string }) {
  const tc = useTranslations('common')
  const [copied, setCopied] = useState(false)
  // Built in the browser so the link matches whatever host the user is on,
  // rather than a server-side guess at the public URL.
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/invite/${token}`

  return (
    <TextField
      value={url}
      onFocus={(event) => event.target.select()}
      slotProps={{
        htmlInput: { readOnly: true, style: { fontFamily: MONO_STACK, fontSize: 12 } },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={copied ? tc('copied') : tc('copy')}>
                <IconButton
                  size="small"
                  edge="end"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1600)
                    } catch {
                      /* clipboard unavailable; the field is selectable */
                    }
                  }}
                >
                  {copied ? (
                    <CheckOutlined fontSize="small" sx={{ color: 'success.main' }} />
                  ) : (
                    <ContentCopyOutlined fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
