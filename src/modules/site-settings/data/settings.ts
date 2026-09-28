import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { appSettings } from '@/core/db/schema/settings'
import { APP_NAME } from '@/core/brand'
import { currentRelease } from '@/modules/system-update/data/overview'
import { isApplying } from '@/modules/system-update/data/store'
import { fillTemplate, type TemplateValues } from '../template'
import { DEFAULT_SETTINGS, type MaintenanceState, type SiteSettings } from '../types'

/**
 * Reads and writes the app's settings (one app_settings row, key 'site'), and
 * says whether the app is closed for maintenance.
 *
 * Every page's layout asks, so the answer is kept for a few seconds: a switch
 * flipped on the admin page shows at once in this process (the cache is
 * cleared on save), and in any other within CACHE_MS.
 */

const KEY = 'site'
const CACHE_MS = 5_000

type Cached<T> = { value: T; at: number }
const memo = (globalThis as unknown as {
  __adshubSiteSettings?: { settings?: Cached<SiteSettings>; updating?: Cached<boolean>; version?: string | null }
}).__adshubSiteSettings ??= {}

const fresh = <T>(entry: Cached<T> | undefined): entry is Cached<T> => Boolean(entry && Date.now() - entry.at < CACHE_MS)

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** What is stored, read over the defaults: a field missing or malformed keeps its default. */
function parse(value: Record<string, unknown> | undefined): SiteSettings {
  const m = (value?.maintenance ?? {}) as Record<string, unknown>
  const c = (value?.corner ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    maintenance: { on: flag(m.on, d.maintenance.on), message: text(m.message, d.maintenance.message) },
    corner: {
      on: flag(c.on, d.corner.on),
      text: text(c.text, d.corner.text),
      placement: c.placement === 'footer' || c.placement === 'floating' ? c.placement : d.corner.placement,
    },
  }
}

export async function readSiteSettings(): Promise<SiteSettings> {
  if (fresh(memo.settings)) return memo.settings.value
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1)
    const value = parse(row?.value)
    memo.settings = { value, at: Date.now() }
    return value
  } catch {
    // The table not there yet (a release whose migration has not run): nothing set.
    return DEFAULT_SETTINGS
  }
}

export async function writeSiteSettings(next: SiteSettings, userId: string): Promise<void> {
  const value = next as unknown as Record<string, unknown>
  await db
    .insert(appSettings)
    .values({ key: KEY, value, updatedById: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedById: userId, updatedAt: new Date() } })
  memo.settings = { value: next, at: Date.now() }
}

async function updating(): Promise<boolean> {
  if (fresh(memo.updating)) return memo.updating.value
  const value = await isApplying().catch(() => false)
  memo.updating = { value, at: Date.now() }
  return value
}

export async function maintenanceState(): Promise<MaintenanceState> {
  const [settings, applying] = await Promise.all([readSiteSettings(), updating()])
  return {
    active: settings.maintenance.on || applying,
    manual: settings.maintenance.on,
    updating: applying,
    message: settings.maintenance.message ? fillTemplate(settings.maintenance.message, await templateValues()) : '',
  }
}

/**
 * Whether the app is closed to this user now: maintenance is on (or an
 * update running) and they are not a platform Administrator.
 */
export async function closedFor(user: { role: 'admin' | 'user' } | null): Promise<boolean> {
  if (user?.role === 'admin') return false
  return (await maintenanceState()).active
}

/** The version this app runs: the release's, else package.json's (development). */
export async function appVersion(): Promise<string | null> {
  if (memo.version !== undefined) return memo.version
  const release = await currentRelease()
  let version = release?.version ?? null
  if (!version) {
    try {
      const pkg = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), 'package.json'), 'utf8')) as { version?: string }
      version = pkg.version ?? null
    } catch {
      version = null
    }
  }
  memo.version = version
  return version
}

/** What the template variables stand for now (see template.ts). */
export async function templateValues(): Promise<TemplateValues> {
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  return { version: await appVersion(), year, appName: APP_NAME }
}
