import { cookies } from 'next/headers'
import { PREFERENCES_COOKIE, parsePreferences } from '@/components/ui/preferences-cookie'
import { PreferencesProvider } from '@/components/ui/use-preference'
import { requireProject } from '@/core/auth/session'
import { titled } from '@/core/metadata'
import { listConnections } from '@/features/connections/queries'
import { VideoGmvPage } from '@/modules/video-gmv/page'

export const generateMetadata = titled('nav', 'videoGmv')

/** The video & product GMV report (see src/modules/video-gmv). */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireProject(projectId)
  const connections = await listConnections(projectId)
  const preferences = parsePreferences((await cookies()).get(PREFERENCES_COOKIE)?.value)
  return (
    <PreferencesProvider initial={preferences}>
      <VideoGmvPage projectId={projectId} connected={connections.filter((c) => !c.orphaned).map((c) => c.pluginId)} />
    </PreferencesProvider>
  )
}
