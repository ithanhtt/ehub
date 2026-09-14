'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { connections } from '@/core/db/schema/connections'
import { assertCapability } from '@/core/auth/session'
import { createId } from '@/core/utils/id'

/**
 * Saves which shops and channels the project's dashboard counts.
 *
 * The same right as editing the connection: this changes what everyone in
 * the project sees. Each key belongs to one kind of connection, and a list
 * aimed at the wrong kind is refused rather than stored where nothing reads it.
 */

const OWNER_PLUGIN = { gmvStores: 'tiktok-ads', sapoChannels: 'sapo' } as const

const updatesSchema = z
  .array(
    z.object({
      connectionId: z.string().min(1),
      key: z.enum(['gmvStores', 'sapoChannels']),
      // null = everything, including shops and channels added later.
      values: z.array(z.string().min(1).max(200)).min(1).max(500).nullable(),
    }),
  )
  .min(1)
  .max(4)

export async function saveDashboardSelection(
  projectId: string,
  updates: unknown,
): Promise<{ ok: boolean; message?: string }> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'connection:update')
  } catch {
    return { ok: false, message: 'forbidden' }
  }

  const parsed = updatesSchema.safeParse(updates)
  if (!parsed.success) return { ok: false, message: 'validation' }

  for (const update of parsed.data) {
    const [row] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, update.connectionId), eq(connections.projectId, projectId)))
      .limit(1)
    if (!row || row.pluginId !== OWNER_PLUGIN[update.key]) return { ok: false, message: 'notFound' }

    const metadata = (row.metadata ?? {}) as Record<string, unknown>
    const previous =
      metadata.dashboard && typeof metadata.dashboard === 'object' ? (metadata.dashboard as Record<string, unknown>) : {}
    const values = update.values ? [...new Set(update.values)] : null

    await db
      .update(connections)
      .set({ metadata: { ...metadata, dashboard: { ...previous, [update.key]: values } }, updatedAt: new Date() })
      .where(eq(connections.id, row.id))

    await db.insert(auditLogs).values({
      id: createId('aud'),
      projectId,
      actorId: ctx.user.id,
      action: 'dashboard.sources.update',
      targetType: 'connection',
      targetId: row.id,
      detail: { key: update.key, values: values ?? 'all' },
    })
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}
