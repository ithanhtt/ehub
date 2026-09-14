import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { datasetRecords, datasets } from '@/core/db/schema/datasets'
import { getPlugin } from '@/core/plugins/registry'

export type DatasetView = {
  id: string
  name: string
  pluginId: string
  pluginName: string
  pluginColor: string
  endpointId: string
  endpointName: string | null
  connectionName: string
  recordCount: number
  fieldCount: number
  lastSyncedAt: Date | null
  lastSyncStatus: 'ok' | 'failed' | 'running' | null
  lastSyncMessage: string | null
}

export async function listDatasets(projectId: string): Promise<DatasetView[]> {
  const rows = await db
    .select({
      dataset: datasets,
      connectionName: connections.name,
    })
    .from(datasets)
    .innerJoin(connections, eq(connections.id, datasets.connectionId))
    .where(eq(datasets.projectId, projectId))
    .orderBy(desc(datasets.updatedAt))

  return rows.map(({ dataset, connectionName }) => {
    const plugin = getPlugin(dataset.pluginId)
    const endpoint = plugin?.endpoints.find((e) => e.id === dataset.endpointId)
    return {
      id: dataset.id,
      name: dataset.name,
      pluginId: dataset.pluginId,
      pluginName: plugin?.name ?? dataset.pluginId,
      pluginColor: plugin?.color ?? '#6b7280',
      endpointId: dataset.endpointId,
      endpointName: endpoint?.name.en ?? null,
      connectionName,
      recordCount: dataset.recordCount,
      fieldCount: dataset.fieldHints?.length ?? 0,
      lastSyncedAt: dataset.lastSyncedAt,
      lastSyncStatus: dataset.lastSyncStatus,
      lastSyncMessage: dataset.lastSyncMessage,
    }
  })
}

/** Preview rows for the dataset drawer; JSONB comes back already parsed. */
export async function previewRecords(projectId: string, datasetId: string, limit = 25) {
  const rows = await db
    .select({ externalId: datasetRecords.externalId, payload: datasetRecords.payload })
    .from(datasetRecords)
    .where(and(eq(datasetRecords.datasetId, datasetId), eq(datasetRecords.projectId, projectId)))
    .orderBy(desc(datasetRecords.fetchedAt))
    .limit(limit)

  return rows.map((row) => row.payload)
}
