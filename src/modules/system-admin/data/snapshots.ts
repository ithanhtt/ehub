import 'server-only'

import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SnapshotInfo } from '../types'

/**
 * Database snapshots taken from inside the running app.
 *
 * `npm run db:snapshot` cannot run while the server holds the embedded
 * database — a second PGlite on the same directory destroys it — so the
 * System page and the SQL console take them through the server's own
 * connection instead. They are the same thing scripts/lib.mjs writes: a
 * gzipped tar from PGlite's dumpDataDir, in .data/snapshots, named by the
 * time, the newest five kept. `npm run db:restore` therefore finds and
 * restores them like any other.
 *
 * A Postgres server has no such thing to dump from here; the updater backs it
 * up before every update (scripts/apply-update.mjs).
 */

export const SNAPSHOT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'snapshots')
export const SNAPSHOT_KEEP = 5

/** What dumpDataDir needs: the embedded client, or a stand-in in a test. */
export type Dumpable = { dumpDataDir(compression?: 'gzip' | 'none' | 'auto'): Promise<Blob> }

/** Newest first, like listSnapshots in scripts/lib.mjs (the names sort by time). */
export async function listSnapshots(dir = SNAPSHOT_DIR): Promise<Array<SnapshotInfo & { file: string }>> {
  const names = await readdir(/*turbopackIgnore: true*/ dir).catch(() => [] as string[])
  const out: Array<SnapshotInfo & { file: string }> = []
  for (const name of names.filter((n) => n.endsWith('.tar.gz')).sort().reverse()) {
    const file = path.join(dir, name)
    const info = await stat(/*turbopackIgnore: true*/ file).catch(() => null)
    if (info?.isFile()) out.push({ name, file, bytes: info.size, at: info.mtime.toISOString() })
  }
  return out
}

/** Writes one snapshot, then drops all but the newest `keep`. */
export async function writeSnapshot(client: Dumpable, dir = SNAPSHOT_DIR, keep = SNAPSHOT_KEEP, now = new Date()): Promise<SnapshotInfo> {
  await mkdir(dir, { recursive: true })
  const blob = await client.dumpDataDir('gzip')
  const name = `${now.toISOString().replace(/[:.]/g, '-')}.tar.gz`
  const file = path.join(dir, name)
  // Written under another name first: restore.mjs offers every *.tar.gz, and a
  // half-written one must never be among them.
  const part = `${file}.part`
  await writeFile(part, Buffer.from(await blob.arrayBuffer()))
  await rename(part, file)
  for (const stale of (await listSnapshots(dir)).slice(keep)) await rm(stale.file, { force: true })
  const info = await stat(/*turbopackIgnore: true*/ file)
  return { name, bytes: info.size, at: info.mtime.toISOString() }
}
