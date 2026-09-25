'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { connections } from '@/core/db/schema/connections'
import { decryptJson, encryptJson } from '@/core/crypto/secrets'
import { assertCapability } from '@/core/auth/session'
import { createId } from '@/core/utils/id'

/**
 * Saves what the project's overview reads, source by source: whether a source
 * is on it at all, the GMV Max shops and Sapo channels it counts, and which
 * of the shops a TikTok Shop app is authorised for it reads.
 *
 * The same right as editing the connection: this changes what everyone in
 * the project sees. Each kind of update belongs to one kind of connection,
 * and one aimed at the wrong kind is refused rather than stored where nothing
 * reads it.
 */

const connectionId = z.string().min(1)

const updatesSchema = z
  .array(
    z.discriminatedUnion('key', [
      // null = everything, including shops and channels added later.
      z.object({ connectionId, key: z.literal('gmvStores'), values: z.array(z.string().min(1).max(200)).min(1).max(500).nullable() }),
      z.object({ connectionId, key: z.literal('sapoChannels'), values: z.array(z.string().min(1).max(200)).min(1).max(500).nullable() }),
      z.object({ connectionId, key: z.literal('hidden'), value: z.boolean() }),
      z.object({ connectionId, key: z.literal('shopCipher'), value: z.string().min(1).max(200) }),
    ]),
  )
  .min(1)
  .max(8)

type Update = z.infer<typeof updatesSchema>[number]

const OWNER_PLUGINS: Record<Update['key'], readonly string[]> = {
  gmvStores: ['tiktok-ads'],
  sapoChannels: ['sapo'],
  hidden: ['tiktok-ads', 'tiktok-shop', 'sapo'],
  shopCipher: ['tiktok-shop'],
}

type Row = typeof connections.$inferSelect

/** The connection's new metadata (and credentials, when they change) for one update; null when the update is refused. */
function apply(row: Row, update: Update): { metadata: Record<string, unknown>; credentials?: string } | null {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  const dashboard = metadata.dashboard && typeof metadata.dashboard === 'object' ? (metadata.dashboard as Record<string, unknown>) : {}

  if (update.key === 'gmvStores' || update.key === 'sapoChannels') {
    return { metadata: { ...metadata, dashboard: { ...dashboard, [update.key]: update.values ? [...new Set(update.values)] : null } } }
  }
  if (update.key === 'hidden') {
    return { metadata: { ...metadata, dashboard: { ...dashboard, hidden: update.value } } }
  }

  // The shop a TikTok Shop connection reads: one of those its test found authorised, nothing else.
  const shops = Array.isArray(metadata.shops) ? (metadata.shops as Array<Record<string, unknown>>) : []
  const shop = shops.find((s) => String(s.cipher ?? '') === update.value)
  if (!shop) return null
  const next = { ...metadata, shopCipher: update.value, shopId: String(shop.id ?? ''), shopName: String(shop.name ?? ''), region: String(shop.region ?? '') }
  // A cipher typed into the connection's form would win over this choice (shopCipherOf): it gives way.
  if (row.credentials) {
    const credentials = decryptJson<Record<string, string>>(row.credentials)
    if (credentials.shopCipher && credentials.shopCipher !== update.value) {
      const { shopCipher: _typed, ...rest } = credentials
      return { metadata: next, credentials: encryptJson(rest) }
    }
  }
  return { metadata: next }
}

export async function saveDashboardSelection(projectId: string, updates: unknown): Promise<{ ok: boolean; message?: string }> {
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
    if (!row || !OWNER_PLUGINS[update.key].includes(row.pluginId)) return { ok: false, message: 'notFound' }

    const next = apply(row, update)
    if (!next) return { ok: false, message: 'validation' }

    await db
      .update(connections)
      .set({ metadata: next.metadata, ...(next.credentials ? { credentials: next.credentials } : {}), updatedAt: new Date() })
      .where(eq(connections.id, row.id))

    await db.insert(auditLogs).values({
      id: createId('aud'),
      projectId,
      actorId: ctx.user.id,
      action: 'dashboard.sources.update',
      targetType: 'connection',
      targetId: row.id,
      detail: { key: update.key, value: 'values' in update ? (update.values ?? 'all') : update.value },
    })
  }

  // The TikTok Shop's shop feeds the reports too, so the whole project is refreshed.
  revalidatePath(`/projects/${projectId}`, 'layout')
  return { ok: true }
}
