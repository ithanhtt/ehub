import { getTranslations } from 'next-intl/server'
import { requireProject } from '@/core/auth/session'
import { can } from '@/core/auth/rbac'
import { listCatalog } from '@/core/plugins/registry'
import { listConnections } from '@/features/connections/queries'
import { PageHeader } from '@/components/ui/page-header'
import { ApiHub } from './api-hub'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'apiHub')

export default async function HubPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ connection?: string }>
}) {
  const [{ projectId }, { connection }] = await Promise.all([params, searchParams])
  const { role } = await requireProject(projectId)

  const [connections, t] = await Promise.all([listConnections(projectId), getTranslations('hub')])

  // The catalogue is scoped to the plugins this project has actually
  // connected, so the Hub never advertises an endpoint that cannot be called.
  const usable = connections.filter((c) => !c.orphaned)
  const pluginIds = [...new Set(usable.map((c) => c.pluginId))]
  const catalog = listCatalog(pluginIds)

  const initialConnectionId = usable.some((c) => c.id === connection)
    ? connection
    : usable[0]?.id

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ApiHub
        projectId={projectId}
        connections={usable}
        catalog={catalog}
        canExecute={can(role, 'hub:execute')}
        canCustom={can(role, 'hub:custom')}
        canCustomWrite={can(role, 'hub:custom-write')}
        initialConnectionId={initialConnectionId}
      />
    </>
  )
}
