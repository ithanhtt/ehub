import { cookies } from 'next/headers'
import { PREFERENCES_COOKIE, parsePreferences } from '@/components/ui/preferences-cookie'
import { PreferencesProvider } from '@/components/ui/use-preference'
import { requireProject } from '@/core/auth/session'
import { titled } from '@/core/metadata'
import { listConnections } from '@/features/connections/queries'
import { OrderCancelPage } from '@/modules/order-cancel/page'

export const generateMetadata = titled('nav', 'orderCancel')

/** The orders & cancellations report (see src/modules/order-cancel). */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireProject(projectId)
  const connections = await listConnections(projectId)
  const preferences = parsePreferences((await cookies()).get(PREFERENCES_COOKIE)?.value)
  return (
    <PreferencesProvider initial={preferences}>
      <OrderCancelPage projectId={projectId} connected={connections.filter((c) => !c.orphaned).map((c) => c.pluginId)} />
    </PreferencesProvider>
  )
}
