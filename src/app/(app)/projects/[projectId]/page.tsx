import { cookies } from 'next/headers'
import Box from '@mui/material/Box'
import { visuallyHidden } from '@mui/utils'
import { PREFERENCES_COOKIE, parsePreferences } from '@/components/ui/preferences-cookie'
import { PreferencesProvider } from '@/components/ui/use-preference'
import { can } from '@/core/auth/rbac'
import { requireProject } from '@/core/auth/session'
import { listConnections } from '@/features/connections/queries'
import { hiddenDashboardPlugins } from '@/modules/overview/data/overview'
import { OverviewDashboard } from '@/modules/overview/shell/overview-page'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'overview')

/**
 * The project home: the overview module's page (see src/modules/overview).
 *
 * The page itself only knows which sources are connected; the numbers are
 * fetched by the dashboard after it mounts and refreshed on a timer, so a
 * cold provider sweep never holds up the first paint. The API tooling that
 * used to live here (call counts, recent calls) sits under Settings → API
 * integration now.
 *
 * No visible page header: the dashboard starts straight with its filter row,
 * so the numbers sit at the top of the screen. The project's name stays as
 * the page's heading for screen readers.
 *
 * The viewer's remembered choices (period, views, measures) come in with the
 * request's cookie and are rendered here already, so the page opens as they
 * left it rather than on the defaults and then jumping (see usePreference).
 */
export default async function ProjectOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const { project, role } = await requireProject(projectId)
  const [connections, hidden] = await Promise.all([listConnections(projectId), hiddenDashboardPlugins(projectId)])
  const usable = connections.filter((c) => !c.orphaned)
  const preferences = parsePreferences((await cookies()).get(PREFERENCES_COOKIE)?.value)

  return (
    <PreferencesProvider initial={preferences}>
      <Box component="h1" sx={visuallyHidden}>
        {project.name}
      </Box>
      <OverviewDashboard
        projectId={projectId}
        connected={usable.map((c) => c.pluginId)}
        hidden={hidden}
        canConfigure={can(role, 'connection:update')}
      />
    </PreferencesProvider>
  )
}
