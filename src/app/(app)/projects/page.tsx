import { getLocale, getTranslations } from 'next-intl/server'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined'
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined'
import PowerOutlined from '@mui/icons-material/PowerOutlined'
import GroupOutlined from '@mui/icons-material/GroupOutlined'
import { requireUser } from '@/core/auth/session'
import { listProjectsForUser } from '@/features/projects/queries'
import { EmptyState, PageHeader } from '@/components/ui/page-header'
import { formatDateTime } from '@/core/utils/format'
import { RememberProject } from '@/components/layout/remember-project'
import { CreateProjectForm } from './create-project-form'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'projects')

export default async function ProjectsPage() {
  const user = await requireUser()
  const [projects, t, tr, tc, locale] = await Promise.all([
    listProjectsForUser(user.id),
    getTranslations('projects'),
    getTranslations('roles'),
    getTranslations('common'),
    getLocale(),
  ])

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <RememberProject forget />
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={projects.length > 0 ? <CreateProjectForm /> : undefined}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpenOutlined sx={{ fontSize: 32 }} />}
          title={t('empty')}
          action={<CreateProjectForm />}
        />
      ) : (
        <Grid container spacing={2}>
          {projects.map((project) => (
            <Grid key={project.id} size={{ xs: 12, sm: 6 }}>
              <Card
                sx={{
                  height: '100%',
                  transition: 'border-color .15s, box-shadow .15s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    boxShadow: '0 8px 24px -16px rgb(0 0 0 / 0.3)',
                  },
                }}
              >
                <CardActionArea
                  href={`/projects/${project.id}`}
                  sx={{
                    height: '100%',
                    p: 2.5,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
                  >
                    <Typography variant="h5" component="h2" noWrap sx={{ minWidth: 0 }}>
                      {project.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={tr(project.role)}
                      color={project.role === 'owner' ? 'primary' : 'default'}
                      variant={project.role === 'owner' ? 'filled' : 'outlined'}
                    />
                  </Stack>

                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.75,
                      color: 'text.secondary',
                      minHeight: 40,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {project.description || '—'}
                  </Typography>

                  <Stack direction="row" spacing={2} sx={{ mt: 2, color: 'text.secondary' }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <GroupOutlined sx={{ fontSize: 15 }} />
                      <Typography variant="caption">
                        {t('memberCount', { count: project.memberCount })}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <PowerOutlined sx={{ fontSize: 15 }} />
                      <Typography variant="caption">
                        {t('connectionCount', { count: project.connectionCount })}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Box sx={{ flexGrow: 1 }} />
                  <Divider sx={{ mt: 2 }} />

                  <Stack
                    direction="row"
                    sx={{ pt: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {tc('updatedAt')}: {formatDateTime(project.updatedAt, locale)}
                    </Typography>
                    <ArrowForwardOutlined sx={{ fontSize: 15, color: 'text.disabled' }} />
                  </Stack>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  )
}
