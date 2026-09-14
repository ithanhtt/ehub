import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Drawer from '@mui/material/Drawer'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined'
import { getProjectContext, requireProject } from '@/core/auth/session'
import { APP_NAME } from '@/core/brand'
import { ProjectNavList, ProjectNavTabs } from '@/components/layout/project-nav'
import { RememberProject } from '@/components/layout/remember-project'
import { AppLink } from '@/components/ui/app-link'

const DRAWER_WIDTH = 236

// Pages name themselves ("Tổng quan"); the tab reads "Tổng quan · <project> · EHub".
// getProjectContext is cached per request, so this shares the layout's lookup.
export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { projectId } = await params
  const ctx = await getProjectContext(projectId)
  if (!ctx) return {}
  return { title: { default: ctx.project.name, template: `%s · ${ctx.project.name} · ${APP_NAME}` } }
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  // Redirects to /projects when the caller is not a member, so every page
  // below this layout can assume membership without re-checking.
  const { project, role } = await requireProject(projectId)
  const [tn, tr] = await Promise.all([getTranslations('nav'), getTranslations('roles')])

  return (
    <Box sx={{ display: 'flex', width: '100%', minWidth: 0 }}>
      <RememberProject />
      {/* Permanent on wide screens; the mobile equivalent is the tab bar below. */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          // Transparent with a dashed rule instead of a filled panel with a
          // border: the sidebar reads as part of the page, not a chrome slab.
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            backgroundColor: 'transparent',
            borderRight: '1px dashed var(--adshub-dashed)',
          },
        }}
      >
        {/* Offsets the sticky AppBar, which sits above the drawer. */}
        <Toolbar variant="dense" sx={{ minHeight: 56 }} />

        <Box sx={{ px: 1.5, py: 2, overflowY: 'auto' }}>
          <AppLink
            href="/projects"
            underline="none"
            variant="caption"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.25,
              mb: 1.5,
              ml: 0.5,
              color: 'text.disabled',
              '&:hover': { color: 'text.primary' },
            }}
          >
            <ChevronLeftOutlined sx={{ fontSize: 15 }} />
            {tn('backToProjects')}
          </AppLink>

          <Box sx={{ px: 0.5, mb: 2 }}>
            <Typography variant="subtitle2" noWrap title={project.name}>
              {project.name}
            </Typography>
            <Chip
              size="small"
              label={tr(role)}
              color={role === 'owner' ? 'primary' : 'default'}
              variant="outlined"
              sx={{ mt: 0.75 }}
            />
          </Box>

          <ProjectNavList projectId={projectId} />
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ px: 2, pt: 2, pb: 1, alignItems: 'center', minWidth: 0 }}
          >
            <AppLink
              href="/projects"
              underline="none"
              sx={{ display: 'inline-flex', color: 'text.disabled' }}
              aria-label={tn('backToProjects')}
            >
              <ChevronLeftOutlined sx={{ fontSize: 18 }} />
            </AppLink>
            <Typography variant="subtitle2" noWrap>
              {project.name}
            </Typography>
            <Chip size="small" label={tr(role)} variant="outlined" />
          </Stack>
          <ProjectNavTabs projectId={projectId} />
        </Box>

        <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1600 }}>{children}</Box>
      </Box>
    </Box>
  )
}
