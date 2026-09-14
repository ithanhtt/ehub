import { getTranslations } from 'next-intl/server'
import { requireProject } from '@/core/auth/session'
import { can } from '@/core/auth/rbac'
import { PageHeader } from '@/components/ui/page-header'
import { GeneralForm } from './general-form'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'general')

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const { project, role } = await requireProject(projectId)
  const t = await getTranslations('nav')

  return (
    <>
      <PageHeader title={t('general')} />
      <GeneralForm
        projectId={projectId}
        project={{
          name: project.name,
          description: project.description,
          timezone: project.timezone,
          currency: project.currency,
          slug: project.slug,
        }}
        canUpdate={can(role, 'project:update')}
        canDelete={can(role, 'project:delete')}
      />
    </>
  )
}
