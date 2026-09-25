import 'server-only'

import os from 'node:os'
import { lstat, readFile, readdir, stat, statfs } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PGLITE_DIR, db, isEmbeddedDatabase } from '@/core/db/client'
import { housekeepingState } from '@/core/housekeeping'
import { bookingAutoSyncEnabled } from '@/features/bookings/auto-sync'
import { backgroundSyncEnabled } from '@/modules/overview/data/background'
import { memoSize } from '@/modules/overview/data/cache'
import { currentRelease } from '@/modules/system-update/data/overview'
import type { DbInfo, DiskInfo, FolderInfo, HostInfo, LiveSample, NetInterface, SystemSnapshot } from '../types'
import { databaseError, databaseFacts, listTables } from './db-inspect'
import { listSnapshots } from './snapshots'

/**
 * What the System page shows about the machine and the app on it.
 *
 * Two speeds. The live part — CPU, memory, network, uptime — is measured
 * fresh on every ask (the page asks every five seconds): CPU by reading the
 * cores' time counters twice ~300 ms apart, since Windows has no load
 * average and a single reading only says how busy the machine has been since
 * it booted. The heavy part — folder sizes walked on disk, the database's
 * size and row counts — is kept for a minute and shared by every open page,
 * so a few administrators watching cannot turn the page itself into load.
 *
 * Nothing here writes, and nothing here prints a secret: the Postgres
 * location is host, port and database only — never the URL, which carries the
 * password.
 */

const DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data')
const HEAVY_TTL_MS = 60_000
const SAMPLE_MS = 300
/** The folder walk stops at whichever comes first: this many entries, or this long. */
const WALK_MAX_ENTRIES = 200_000
const WALK_MAX_MS = 4_000
const WARN_DISK_PERCENT = 85

export { WARN_DISK_PERCENT }

type Heavy = Omit<SystemSnapshot, 'live' | 'jobs' | 'collectedAt'>
type Holder = {
  __adshubSystemHeavy?: { at: number; value: Promise<Heavy> }
  __adshubNetLast?: { at: number; rx: number; tx: number }
  __adshubAppVersion?: string | null
}
const holder = globalThis as unknown as Holder

/* ------------------------------------------------------------------ live --- */

function cpuTotals(): { idle: number; total: number } | null {
  const cpus = os.cpus()
  if (cpus.length === 0) return null
  let idle = 0
  let total = 0
  for (const { times } of cpus) {
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

/** Received and sent bytes over every interface but loopback, from /proc/net/dev; null off Linux. */
async function readNetDev(): Promise<{ rx: number; tx: number } | null> {
  if (process.platform !== 'linux') return null
  try {
    const text = await readFile('/proc/net/dev', 'utf8')
    let rx = 0
    let tx = 0
    for (const line of text.split('\n').slice(2)) {
      const [name, rest] = line.split(':')
      if (!rest || name.trim() === 'lo') continue
      const fields = rest.trim().split(/\s+/).map(Number)
      rx += fields[0] || 0
      tx += fields[8] || 0
    }
    return { rx, tx }
  } catch {
    return null
  }
}

/** Linux's MemAvailable — what could be handed out now, page cache included; os.freemem() alone makes a healthy server look full. */
async function memAvailable(): Promise<number | null> {
  if (process.platform !== 'linux') return null
  try {
    const match = /^MemAvailable:\s+(\d+)\s*kB/m.exec(await readFile('/proc/meminfo', 'utf8'))
    return match ? Number(match[1]) * 1024 : null
  } catch {
    return null
  }
}

export async function sampleLive(): Promise<LiveSample> {
  const cpu0 = cpuTotals()
  const proc0 = process.cpuUsage()
  const t0 = performance.now()
  const net0 = await readNetDev()
  await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
  const cpu1 = cpuTotals()
  const proc = process.cpuUsage(proc0)
  const elapsedMs = performance.now() - t0
  const net1 = await readNetDev()
  const cores = Math.max(1, os.cpus().length)

  const totalDelta = cpu0 && cpu1 ? cpu1.total - cpu0.total : 0
  const percent = cpu0 && cpu1 && totalDelta > 0 ? clampPercent((1 - (cpu1.idle - cpu0.idle) / totalDelta) * 100) : null
  const processPercent = clampPercent(((proc.user + proc.system) / 1000 / (elapsedMs * cores)) * 100)

  // Against the previous ask when there was one lately (five seconds is steadier than 300 ms).
  let network: LiveSample['network'] = null
  if (net1) {
    const now = Date.now()
    const previous = holder.__adshubNetLast
    const base = previous && now - previous.at < 60_000 && now > previous.at && net1.rx >= previous.rx ? previous : net0 ? { ...net0, at: now - elapsedMs } : null
    const seconds = base ? (now - base.at) / 1000 : 0
    network = base && seconds > 0 ? { rxPerSec: Math.max(0, (net1.rx - base.rx) / seconds), txPerSec: Math.max(0, (net1.tx - base.tx) / seconds) } : null
    holder.__adshubNetLast = { at: now, ...net1 }
  }

  const total = os.totalmem()
  const available = (await memAvailable()) ?? os.freemem()
  const memory = process.memoryUsage()
  const load = os.loadavg()
  return {
    at: new Date().toISOString(),
    cpu: {
      percent,
      processPercent,
      loadavg: process.platform !== 'win32' && load.some((value) => value > 0) ? [load[0], load[1], load[2]] : null,
    },
    memory: {
      total,
      used: Math.max(0, total - available),
      free: available,
      process: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
    },
    network,
    uptime: { os: os.uptime(), process: process.uptime() },
  }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

/* ----------------------------------------------------------------- heavy --- */

async function appVersion(): Promise<string | null> {
  if (holder.__adshubAppVersion !== undefined) return holder.__adshubAppVersion
  try {
    const pkg = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    holder.__adshubAppVersion = pkg.version ?? null
  } catch {
    holder.__adshubAppVersion = null
  }
  return holder.__adshubAppVersion
}

async function hostInfo(): Promise<HostInfo> {
  const cpus = os.cpus()
  const release = await currentRelease()
  return {
    hostname: os.hostname(),
    osType: os.type(),
    osRelease: os.release(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    appVersion: release?.version ?? (await appVersion()),
    release: release?.id ?? null,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    cpuModel: cpus[0]?.model.trim() ?? '—',
    cores: cpus.length,
    speedMhz: cpus[0]?.speed ?? 0,
  }
}

async function diskOf(dir: string): Promise<DiskInfo | null> {
  try {
    const fs = await statfs(/*turbopackIgnore: true*/ dir)
    const total = fs.blocks * fs.bsize
    const free = fs.bavail * fs.bsize
    const used = Math.max(0, total - fs.bfree * fs.bsize)
    return { path: dir, total, free, used, percent: total > 0 ? Math.round((used / (used + free)) * 1000) / 10 : 0 }
  } catch {
    return null
  }
}

async function disks(): Promise<DiskInfo[]> {
  const dirs = [DATA_DIR, process.cwd()]
  const out: DiskInfo[] = []
  const devices = new Set<number>()
  for (const dir of dirs) {
    const info = await stat(/*turbopackIgnore: true*/ dir).catch(() => null)
    if (!info || devices.has(info.dev)) continue
    devices.add(info.dev)
    const disk = await diskOf(dir)
    if (disk) out.push(disk)
  }
  return out
}

/**
 * Sizes under .data, each top-level folder walked without following links.
 * One budget for the whole walk — entries and time — so a cache folder of a
 * million files cannot hold the page up; a folder cut short says so.
 */
async function folders(): Promise<FolderInfo[]> {
  const budget = { entries: WALK_MAX_ENTRIES, until: Date.now() + WALK_MAX_MS }
  const names = await readdir(/*turbopackIgnore: true*/ DATA_DIR, { withFileTypes: true }).catch(() => [])
  const out: FolderInfo[] = []
  const loose: FolderInfo = { name: '', bytes: 0, files: 0, truncated: false }
  for (const entry of names) {
    const full = path.join(DATA_DIR, entry.name)
    if (entry.isDirectory()) out.push({ name: entry.name, ...(await walk(full, budget)) })
    else if (entry.isFile()) {
      const info = await lstat(/*turbopackIgnore: true*/ full).catch(() => null)
      loose.bytes += info?.size ?? 0
      loose.files += 1
    }
  }
  const pglite = process.env.PGLITE_DATA_DIR
  if (isEmbeddedDatabase && pglite && !path.resolve(pglite).startsWith(DATA_DIR)) {
    out.push({ name: path.resolve(pglite), ...(await walk(path.resolve(pglite), budget)) })
  }
  out.sort((a, b) => b.bytes - a.bytes)
  if (loose.files > 0) out.push(loose)
  return out
}

async function walk(root: string, budget: { entries: number; until: number }): Promise<Omit<FolderInfo, 'name'>> {
  const out = { bytes: 0, files: 0, truncated: false }
  const stack = [root]
  while (stack.length > 0) {
    if (budget.entries <= 0 || Date.now() > budget.until) {
      out.truncated = true
      break
    }
    const dir = stack.pop()!
    const entries = await readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      budget.entries -= 1
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        const info = await lstat(/*turbopackIgnore: true*/ full).catch(() => null)
        out.bytes += info?.size ?? 0
        out.files += 1
      }
    }
  }
  return out
}

function interfaces(): NetInterface[] {
  const out: NetInterface[] = []
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      out.push({ name, family: String(address.family), address: address.address, cidr: address.cidr, internal: address.internal, mac: address.mac })
    }
  }
  return out.sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name) || a.family.localeCompare(b.family))
}

/** host:port/database from DATABASE_URL — never the user's password, which the URL carries. */
export function postgresLocation(url: string | undefined): string {
  try {
    const parsed = new URL(url ?? '')
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''}`
  } catch {
    return 'PostgreSQL'
  }
}

async function databaseInfo(): Promise<DbInfo> {
  const location = isEmbeddedDatabase ? path.resolve(process.env.PGLITE_DATA_DIR ?? DEFAULT_PGLITE_DIR) : postgresLocation(process.env.DATABASE_URL)
  const base: DbInfo = { kind: isEmbeddedDatabase ? 'embedded' : 'postgres', location, version: null, bytes: null, connections: null, tables: [], error: null }
  try {
    const [facts, tables] = await Promise.all([databaseFacts(db, !isEmbeddedDatabase), listTables(db)])
    return { ...base, ...facts, tables: tables.map(({ name, rows, exact, bytes }) => ({ name, rows, exact, bytes })) }
  } catch (error) {
    return { ...base, error: databaseError(error) }
  }
}

async function collectHeavy(): Promise<Heavy> {
  const [host, diskList, folderList, database, snapshots] = await Promise.all([hostInfo(), disks(), folders(), databaseInfo(), listSnapshots()])
  return {
    host,
    dataDir: DATA_DIR,
    disks: diskList,
    folders: folderList,
    interfaces: interfaces(),
    database,
    snapshots: snapshots.map(({ name, bytes, at }) => ({ name, bytes, at })),
    canSnapshot: isEmbeddedDatabase,
  }
}

/** Forget the cached heavy part, after an action changed what it shows (a snapshot, a VACUUM, a clean-up). */
export function invalidateSystemSnapshot() {
  holder.__adshubSystemHeavy = undefined
}

export async function systemSnapshot(): Promise<SystemSnapshot> {
  const now = Date.now()
  let heavy = holder.__adshubSystemHeavy
  if (!heavy || now - heavy.at > HEAVY_TTL_MS) {
    const value = collectHeavy()
    heavy = { at: now, value }
    holder.__adshubSystemHeavy = heavy
    // A failed collection is not kept for the whole minute.
    value.catch(() => {
      if (holder.__adshubSystemHeavy?.value === value) holder.__adshubSystemHeavy = undefined
    })
  }
  const [heavyValue, live] = await Promise.all([heavy.value, sampleLive()])
  const housekeeping = housekeepingState()
  return {
    ...heavyValue,
    collectedAt: new Date(heavy.at).toISOString(),
    live,
    jobs: {
      backgroundSync: backgroundSyncEnabled(),
      bookingAutoSync: bookingAutoSyncEnabled(),
      housekeeping: {
        scheduled: housekeeping.scheduled,
        running: housekeeping.running,
        lastAt: housekeeping.last?.at ?? null,
        lastMs: housekeeping.last?.ms ?? null,
        report: housekeeping.last?.report ?? null,
      },
      memoEntries: memoSize(),
    },
  }
}
