import { getTranslations } from 'next-intl/server'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { requireUser } from '@/core/auth/session'
import { getInvitationPreview } from '@/features/projects/actions'
import { AcceptInvite } from './accept-invite'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('members', 'acceptTitle')

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // Signing in first is required: accepting must bind the invitation to a
  // known account, and requireUser() sends guests to /login.
  const user = await requireUser()

  const [invitation, t, tr, tn] = await Promise.all([
    getInvitationPreview(token),
    getTranslations('members'),
    getTranslations('roles'),
    getTranslations('nav'),
  ])

  const wrongEmail =
    invitation?.valid && invitation.email.toLowerCase() !== user.email.toLowerCase()

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Card>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h3" component="h1">
            {t('acceptTitle')}
          </Typography>

          <Stack spacing={2.5} sx={{ mt: 3 }}>
            {!invitation || !invitation.valid ? (
              <>
                <Alert severity="error">{t('inviteInvalid')}</Alert>
                <Button href="/projects" variant="outlined" color="inherit">
                  {tn('backToProjects')}
                </Button>
              </>
            ) : (
              <>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="subtitle2">{invitation.projectName}</Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
                    {invitation.inviterName ? `${invitation.inviterName} → ` : ''}
                    {invitation.email}
                  </Typography>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={tr(invitation.role)}
                    sx={{ mt: 1.25 }}
                  />
                </Paper>

                {wrongEmail ? (
                  <Alert severity="warning">{t('inviteWrongEmail')}</Alert>
                ) : (
                  <AcceptInvite token={token} />
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  )
}
