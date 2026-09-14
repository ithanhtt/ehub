import { getTranslations } from 'next-intl/server'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import { requireProject } from '@/core/auth/session'
import { can } from '@/core/auth/rbac'
import { listDatasets } from '@/features/datasets/queries'
import { EmptyState, PageHeader } from '@/components/ui/page-header'
import { DatasetList } from './dataset-list'
import { titled } from '@/core/metadata'

export const generateMetadata = titled('nav', 'datasets')

export default async function DatasetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const { role } = await requireProject(projectId)
  const [datasets, t] = await Promise.all([listDatasets(projectId), getTranslations('datasets')])

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {datasets.length === 0 ? (
        <EmptyState icon={<StorageOutlined sx={{ fontSize: 32 }} />} title={t('empty')} />
      ) : (
        <DatasetList
          projectId={projectId}
          datasets={datasets}
          canSync={can(role, 'dataset:sync')}
          canDelete={can(role, 'dataset:delete')}
        />
      )}
    </>
  )
}
