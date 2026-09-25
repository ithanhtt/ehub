import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { freshContext } from '@/core/plugins/fresh-credentials'
import type { ConnectionContext } from '@/core/plugins/types'
import { REPORT_SOURCES, SOURCE_PLUGIN, type ReportSource } from '../types'

/**
 * The connection each source is read through, for one project: of the
 * connections for the source's plugin, the first that tests green, else the
 * first — as the overview picks them. Its credentials are renewed first when
 * they expire on their own (a TikTok Shop token).
 */
export async function reportContexts(projectId: string): Promise<Partial<Record<ReportSource, ConnectionContext>>> {
  const rows = await db.select().from(connections).where(eq(connections.projectId, projectId))
  const out: Partial<Record<ReportSource, ConnectionContext>> = {}
  await Promise.all(
    REPORT_SOURCES.map(async (source) => {
      if (source === 'booking') return
      const own = rows.filter((row) => row.pluginId === SOURCE_PLUGIN[source])
      const row = own.find((candidate) => candidate.status === 'connected') ?? own[0]
      if (row) out[source] = await freshContext(row)
    }),
  )
  return out
}

/** Every connection of a plugin that tests green, across projects — for the background warm-up. */
export async function connectedContexts(pluginId: string): Promise<ConnectionContext[]> {
  const rows = await db.select().from(connections).where(eq(connections.pluginId, pluginId))
  const out: ConnectionContext[] = []
  for (const row of rows) {
    if (row.status !== 'connected') continue
    try {
      out.push(await freshContext(row))
    } catch {
      /* unreadable credentials: the report says why when opened */
    }
  }
  return out
}
