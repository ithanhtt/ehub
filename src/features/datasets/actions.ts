'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { datasetRecords, datasets } from '@/core/db/schema/datasets'
import { assertCapability } from '@/core/auth/session'
import { executeEndpoint } from '@/core/plugins/execute'
import { requireEndpoint } from '@/core/plugins/registry'
import { externalIdOf, inferFields } from '@/core/utils/infer'
import { createId } from '@/core/utils/id'

export type DatasetActionState = {
  ok: boolean
  message?: string
  datasetId?: string
  recordCount?: number
}

const RECORD_BATCH_SIZE = 200

/**
 * Captures an endpoint's output into the dataset store.
 *
 * The request is *re-executed on the server* rather than accepting rows posted
 * from the browser: the Hub only ever holds a display-truncated copy, and
 * trusting client-supplied rows would let anyone with `dataset:sync` write
 * arbitrary content into the project's data.
 */
export async function saveDataset(
  projectId: string,
  input: {
    connectionId: string
    endpointId: string
    name: string
    params: Record<string, unknown>
  },
): Promise<DatasetActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'dataset:sync')
  } catch {
    return { ok: false, message: 'forbidden' }
  }

  const name = input.name.trim()
  if (!name) return { ok: false, message: 'validation' }

  const [connection] = await db
    .select({ pluginId: connections.pluginId })
    .from(connections)
    .where(and(eq(connections.id, input.connectionId), eq(connections.projectId, projectId)))
    .limit(1)
  if (!connection) return { ok: false, message: 'notFound' }

  let endpoint
  try {
    endpoint = requireEndpoint(connection.pluginId, input.endpointId)
  } catch {
    return { ok: false, message: 'notFound' }
  }
  if (!endpoint.resultPath) {
    return { ok: false, message: 'endpointHasNoRecords' }
  }

  const [existing] = await db
    .select({ id: datasets.id })
    .from(datasets)
    .where(
      and(
        eq(datasets.projectId, projectId),
        eq(datasets.connectionId, input.connectionId),
        eq(datasets.endpointId, input.endpointId),
        eq(datasets.name, name),
      ),
    )
    .limit(1)

  const datasetId = existing?.id ?? createId('ds')

  if (!existing) {
    await db.insert(datasets).values({
      id: datasetId,
      projectId,
      connectionId: input.connectionId,
      pluginId: connection.pluginId,
      endpointId: input.endpointId,
      name,
      params: input.params,
      lastSyncStatus: 'running',
      createdById: ctx.user.id,
    })
  } else {
    await db
      .update(datasets)
      .set({ params: input.params, lastSyncStatus: 'running', updatedAt: new Date() })
      .where(eq(datasets.id, datasetId))
  }

  return ingest({
    projectId,
    datasetId,
    connectionId: input.connectionId,
    pluginId: connection.pluginId,
    endpointId: input.endpointId,
    params: input.params,
    actorId: ctx.user.id,
  })
}

export async function resyncDataset(projectId: string, datasetId: string): Promise<DatasetActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'dataset:sync')
  } catch {
    return { ok: false, message: 'forbidden' }
  }

  const [dataset] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, datasetId), eq(datasets.projectId, projectId)))
    .limit(1)
  if (!dataset) return { ok: false, message: 'notFound' }

  await db
    .update(datasets)
    .set({ lastSyncStatus: 'running', updatedAt: new Date() })
    .where(eq(datasets.id, datasetId))

  return ingest({
    projectId,
    datasetId,
    connectionId: dataset.connectionId,
    pluginId: dataset.pluginId,
    endpointId: dataset.endpointId,
    params: dataset.params ?? {},
    actorId: ctx.user.id,
  })
}

async function ingest(input: {
  projectId: string
  datasetId: string
  connectionId: string
  pluginId: string
  endpointId: string
  params: Record<string, unknown>
  actorId: string
}): Promise<DatasetActionState> {
  let result
  try {
    result = await executeEndpoint({
      projectId: input.projectId,
      connectionId: input.connectionId,
      endpointId: input.endpointId,
      params: input.params,
      actorId: input.actorId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markFailed(input.datasetId, message)
    return { ok: false, message }
  }

  if (!result.ok) {
    await markFailed(input.datasetId, result.error ?? 'Request failed')
    return { ok: false, message: result.error ?? 'requestFailed', datasetId: input.datasetId }
  }

  const records = result.records ?? []
  const endpoint = requireEndpoint(input.pluginId, input.endpointId)

  const rows = records.map((record, index) => ({
    id: createId('rec'),
    datasetId: input.datasetId,
    projectId: input.projectId,
    externalId: externalIdOf(record, endpoint.idField, index),
    payload: record as Record<string, unknown>,
    occurredAt: extractOccurredAt(record),
    fetchedAt: new Date(),
  }))

  // Inserted in batches: a single statement with thousands of rows blows past
  // the parameter limit, and PGlite runs it all in one process.
  for (let offset = 0; offset < rows.length; offset += RECORD_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + RECORD_BATCH_SIZE)
    await db
      .insert(datasetRecords)
      .values(batch)
      .onConflictDoUpdate({
        target: [datasetRecords.datasetId, datasetRecords.externalId],
        set: {
          payload: sql`excluded.payload`,
          occurredAt: sql`excluded.occurred_at`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      })
  }

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(datasetRecords)
    .where(eq(datasetRecords.datasetId, input.datasetId))

  await db
    .update(datasets)
    .set({
      fieldHints: inferFields(records),
      recordCount: countRow?.n ?? rows.length,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'ok',
      lastSyncMessage: `${rows.length} record(s) fetched`,
      updatedAt: new Date(),
    })
    .where(eq(datasets.id, input.datasetId))

  revalidatePath(`/projects/${input.projectId}/datasets`)
  return { ok: true, datasetId: input.datasetId, recordCount: rows.length }
}

async function markFailed(datasetId: string, message: string): Promise<void> {
  await db
    .update(datasets)
    .set({ lastSyncStatus: 'failed', lastSyncMessage: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(datasets.id, datasetId))
}

/** Pulls a business date out of the record when the provider exposes one. */
function extractOccurredAt(record: unknown): Date | null {
  if (!record || typeof record !== 'object') return null
  const row = record as Record<string, unknown>

  const candidates = [
    (row.dimensions as Record<string, unknown> | undefined)?.stat_time_day,
    row.stat_time_day,
    row.created_on,
    row.created_at,
    row.date,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const parsed = new Date(candidate)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }
  return null
}

export async function deleteDataset(projectId: string, datasetId: string): Promise<DatasetActionState> {
  try {
    await assertCapability(projectId, 'dataset:delete')
  } catch {
    return { ok: false, message: 'forbidden' }
  }

  await db.delete(datasets).where(and(eq(datasets.id, datasetId), eq(datasets.projectId, projectId)))
  revalidatePath(`/projects/${projectId}/datasets`)
  return { ok: true }
}
