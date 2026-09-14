import { getTranslations } from 'next-intl/server'
import { requireProject } from '@/core/auth/session'
import { can } from '@/core/auth/rbac'
import { listPluginSummaries } from '@/core/plugins/registry'
import { listConnections } from '@/features/connections/queries'
import { PageHeader } from '@/components/ui/page-header'
import { ConnectionsManager } from './connections-manager'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'connections')

export default async function ConnectionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const { role } = await requireProject(projectId)
  const [connections, t] = await Promise.all([
    listConnections(projectId),
    getTranslations('connections'),
  ])

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ConnectionsManager
        projectId={projectId}
        plugins={listPluginSummaries()}
        connections={connections}
        canManage={can(role, 'connection:create')}
      />
    </>
  )
}
