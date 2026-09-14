import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { connections } from '@/core/db/schema/connections'
import { decryptJson } from '@/core/crypto/secrets'
import type { ConnectionContext } from '@/core/plugins/types'
import { advertisersOf, gmvMaxOverview, listGmvPairs } from './gmv-max'
import { listSapoChannels, sapoCatalog, sapoOverview } from './sapo'
import { pairKey, selectionOf } from './selection'
import type { Period } from './period'
import type { DashboardData, DashboardSources, GmvMaxOverview, SapoCatalog, SapoOverview } from './types'

/**
 * Everything the overview dashboard shows, for one project and period.
 *
 * Each source is read through its first working connection (a project with
 * two TikTok connections shows the first that tests green), limited to the
 * shops and channels chosen for the project (see selection.ts). The provider
 * calls are not written to the API log: the dashboard refreshes itself every
 * couple of minutes and would bury the calls people make on purpose.
 *
 * A failing source never blanks the other — it comes back empty, carrying the
 * reason, and the page says which source is behind.
 */

type ConnectionRow = typeof connections.$inferSelect

function contextOf(row: ConnectionRow): ConnectionContext {
  return {
    credentials: row.credentials ? decryptJson(row.credentials) : {},
    metadata: row.metadata ?? {},
    connectionId: row.id,
    projectId: row.projectId,
  }
}

function pick(rows: ConnectionRow[], pluginId: string): ConnectionRow | undefined {
  const own = rows.filter((row) => row.pluginId === pluginId)
  return own.find((row) => row.status === 'connected') ?? own[0]
}

async function projectConnections(projectId: string) {
  const rows = await db.select().from(connections).where(eq(connections.projectId, projectId))
  return { tiktok: pick(rows, 'tiktok-ads'), sapo: pick(rows, 'sapo') }
}

/** The Sapo connection each project's dashboard reads — the ones the background keeps in sync. */
export async function dashboardSapoContexts(): Promise<ConnectionContext[]> {
  const rows = await db.select().from(connections).where(eq(connections.pluginId, 'sapo'))
  const byProject = new Map<string, ConnectionRow[]>()
  for (const row of rows) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row])
  const out: ConnectionContext[] = []
  for (const own of byProject.values()) {
    const row = pick(own, 'sapo')
    if (!row || row.status !== 'connected') continue
    try {
      out.push(contextOf(row))
    } catch {
      /* credentials no longer readable: the dashboard shows why when opened */
    }
  }
  return out
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function failedGmv(error: unknown): GmvMaxOverview {
  return {
    currency: 'VND',
    totals: { cost: 0, revenue: 0, orders: 0 },
    previous: null,
    byTime: [],
    previousByTime: [],
    byStore: [],
    dataThrough: null,
    scope: { selected: 0, total: 0 },
    fetchedAt: new Date().toISOString(),
    failures: [{ source: 'TikTok', message: message(error) }],
  }
}

function failedSapo(error: unknown): SapoOverview {
  return {
    currency: 'VND',
    totals: {
      created: 0,
      cancelled: 0,
      gmv: 0,
      net: 0,
      sales: { orders: 0, lines: 0, discounts: 0, returns: 0, netRevenue: 0, shipping: 0, tax: 0, revenue: 0 },
    },
    previous: null,
    byTime: [],
    previousByTime: [],
    pendingDays: 0,
    sync: { current: 0, previous: 0, total: 0, returns: 0, catchingUp: false },
    scope: { channels: null },
    fetchedAt: null,
    hours: { profile: [], totals: [], counts: [], previous: null, week: [], currentHour: null, days: 0 },
    products: { items: [], since: Date.now(), pendingDays: 0, adminUrl: '', until: null },
    failures: [{ source: 'Sapo', message: message(error) }],
  }
}

export async function dashboardData(projectId: string, period: Period): Promise<DashboardData> {
  const { tiktok, sapo } = await projectConnections(projectId)

  const [gmvMax, sapoData] = await Promise.all([
    tiktok ? gmvMaxOverview(contextOf(tiktok), period).catch(failedGmv) : Promise.resolve(null),
    sapo ? sapoOverview(contextOf(sapo), period).catch(failedSapo) : Promise.resolve(null),
  ])

  return {
    range: period.range,
    period: { start: period.start, end: period.end, days: period.days },
    generatedAt: new Date().toISOString(),
    gmvMax,
    sapo: sapoData,
  }
}

/** The Sapo catalog for the quiet-products list's "all products" view; null without a Sapo connection. */
export async function dashboardCatalog(projectId: string): Promise<SapoCatalog | null> {
  const { sapo } = await projectConnections(projectId)
  return sapo ? sapoCatalog(contextOf(sapo)) : null
}

/** What can be chosen for the dashboard, and what is chosen now. */
export async function dashboardSources(projectId: string): Promise<DashboardSources> {
  const { tiktok, sapo } = await projectConnections(projectId)

  const tiktokPart = async (row: ConnectionRow): Promise<NonNullable<DashboardSources['tiktok']>> => {
    const context = contextOf(row)
    const base = {
      connectionId: row.id,
      connectionName: row.name,
      selected: selectionOf(context.metadata).gmvStores,
    }
    try {
      const { pairs, failures } = await listGmvPairs(context)
      const withShops = new Set(pairs.map((p) => p.advertiserId)).size
      return {
        ...base,
        shops: pairs.map((p) => ({ key: pairKey(p.advertiserId, p.storeId), ...p })),
        accountsWithoutShops: Math.max(0, advertisersOf(context.metadata).length - withShops),
        failures,
      }
    } catch (error) {
      return { ...base, shops: [], accountsWithoutShops: 0, failures: [{ source: 'TikTok', message: message(error) }] }
    }
  }

  const [tiktokSources, sapoSources] = await Promise.all([
    tiktok ? tiktokPart(tiktok) : Promise.resolve(null),
    sapo
      ? listSapoChannels(contextOf(sapo)).then((channels) => ({
          connectionId: sapo.id,
          connectionName: sapo.name,
          channels,
          selected: selectionOf(sapo.metadata).sapoChannels,
        }))
      : Promise.resolve(null),
  ])

  return { tiktok: tiktokSources, sapo: sapoSources }
}
