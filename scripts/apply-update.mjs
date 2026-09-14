/**
 * Applies an update an administrator confirmed on the server's admin page
 * (see src/modules/system-update). It runs apart from the app: the app starts
 * it with --launch, which hands off to a process of its own and exits, so
 * restarting the app can never take the updater down with it.
 *
 * The server's layout, made by deploy/install.sh:
 *
 *   /opt/adshub/releases/<id>/   one directory per release, built in place
 *   /opt/adshub/current          → the live release (a symbolic link)
 *   /opt/adshub/shared/          .env.local, .data, backups, ecosystem.config.cjs,
 *                                linked into every release
 *
 * The steps, each reported in .data/updates/status.json for the page:
 *
 *   verify   the bundle is the one confirmed (its SHA-256) and breaks no rule
 *   backup   pg_dump of the database, before anything touches it
 *   unpack   into a new release directory; the live one is not touched
 *   install  npm ci
 *   migrate  the new release's migrations
 *   build    next build
 *   switch   current → the new release, in one atomic rename
 *   restart  PM2 reloads the app from current
 *   health   /api/health answers, from the new release
 *
 * Until "switch", the live app runs on untouched and a failure leaves it
 * there. After it, a failure points current back at the previous release and
 * restarts that. Migrations are not undone — they are written to be additive;
 * the backup is there for when one is not.
 *
 * Usage: node scripts/apply-update.mjs --launch <update id>   (from the app)
 *        node scripts/apply-update.mjs <update id>            (the update itself)
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './lib.mjs'
import { extractBundle, readBundle, sha256Hex } from './update-bundle.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
/** The release this script belongs to: the live one, applying the next. */
const LIVE_RELEASE = path.resolve(path.dirname(SCRIPT), '..')
const UPDATES = path.join(LIVE_RELEASE, '.data', 'updates')
const STEPS = ['verify', 'backup', 'unpack', 'install', 'migrate', 'build', 'switch', 'restart', 'health']
// The live release and the one before it (to fall back on) — each is about 1 GB with its dependencies.
const KEEP_RELEASES = 2
const KEEP_BACKUPS = 5
/** Past runs the history lists; their logs go with them. */
const HISTORY_SIZE = 30
const HEALTH_TIMEOUT_MS = 120_000

const logFile = (id) => path.join(UPDATES, 'logs', `${id}.log`)
const now = () => new Date().toISOString()
const message = (error) => (error instanceof Error ? error.message : String(error))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (line) => console.log(`[${now()}] ${line}`)

function checkId(value) {
  if (!/^[a-z0-9-]{8,64}$/.test(value ?? '')) {
    console.error('usage: apply-update.mjs [--launch] <update id>')
    process.exit(2)
  }
  return value
}

const [, , first, second] = process.argv

if (first === '--launch') {
  // Hand off and leave: once this process exits, the updater is no longer the app's child.
  const id = checkId(second)
  mkdirSync(path.dirname(logFile(id)), { recursive: true })
  const out = openSync(logFile(id), 'a')
  spawn(process.execPath, [SCRIPT, id], { detached: true, stdio: ['ignore', out, out], env: process.env }).unref()
  process.exit(0)
}

// The update itself starts at the bottom of this file: main() needs every binding declared below.

/* -------------------------------------------------------------- state --- */

let state = null

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, file)
}

const save = () => writeJson(path.join(UPDATES, 'status.json'), state)

async function step(key, work) {
  const entry = state.steps.find((s) => s.key === key)
  entry.state = 'running'
  entry.startedAt = now()
  save()
  log(`▸ ${key}`)
  try {
    await work()
    entry.state = 'done'
  } catch (error) {
    entry.state = 'failed'
    entry.note = message(error)
    throw error
  } finally {
    entry.endedAt = now()
    save()
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** One update at a time: the lock holds the updater's pid, and a dead holder's lock is taken over. */
function takeLock(lock) {
  mkdirSync(path.dirname(lock), { recursive: true })
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    const holder = Number(readFileSync(lock, 'utf8').trim())
    if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && isAlive(holder)) return false
    writeFileSync(lock, String(process.pid))
    return true
  }
}

/* -------------------------------------------------------------- tools --- */

function run(command, args, cwd, extraEnv = {}) {
  log(`$ ${path.basename(command)} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args[0] ?? ''} exited with ${signal ?? code}`)),
    )
  })
}

const stamp = () => now().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')

function prune(dir, pattern, keep) {
  const names = readdirSync(dir).filter((name) => pattern.test(name)).sort()
  for (const name of names.slice(0, Math.max(0, names.length - keep))) rmSync(path.join(dir, name), { recursive: true, force: true })
}

/** Points `link` at `target` in one rename, so it is never missing, not even for a moment. */
function pointCurrent(link, target) {
  const next = `${link}.next`
  rmSync(next, { force: true })
  symlinkSync(target, next)
  renameSync(next, link)
}

function releaseIdOf(dir) {
  return readJson(path.join(dir, '.release.json'))?.id ?? path.basename(dir)
}

async function backupDatabase(shared, id) {
  const url = process.env.DATABASE_URL
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      'the server runs the embedded database, which cannot be updated while the app has it open — use PostgreSQL (DATABASE_URL)',
    )
  }
  const dir = path.join(shared, 'backups')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `db-${stamp()}-${id.slice(0, 8)}.dump`)
  const parsed = new URL(url)
  // Credentials travel in the environment, not the arguments, so no process listing shows the password.
  await run('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`], dir, {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    ...(parsed.searchParams.get('sslmode') ? { PGSSLMODE: parsed.searchParams.get('sslmode') } : {}),
  })
  prune(dir, /^db-.*\.dump$/, KEEP_BACKUPS)
  log(`backup: ${file}`)
  return file
}

function restartApp(shared) {
  const pm2 = process.env.PM2_BIN || 'pm2'
  return run(pm2, ['startOrReload', path.join(shared, 'ecosystem.config.cjs'), '--update-env'], shared)
}

/** Waits until /api/health answers, and answers from `releaseId` — the restart really picked it up. */
async function waitForRelease(releaseId) {
  const port = process.env.PORT || '3000'
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let last = 'no answer'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.release === releaseId) {
        log(`healthy on ${releaseId}`)
        return
      }
      last = `HTTP ${response.status}, release ${body?.release ?? '?'}`
    } catch (error) {
      last = message(error)
    }
    await sleep(2000)
  }
  throw new Error(`the app did not come back on ${releaseId} (${last})`)
}

/** Keeps the newest few releases, and never the live one or the one to fall back on. */
function pruneReleases(releasesDir, keepAlways) {
  const names = readdirSync(releasesDir)
    .filter((name) => statSync(path.join(releasesDir, name)).isDirectory())
    .sort()
  const removable = names.filter((name) => !keepAlways.has(path.join(releasesDir, name)))
  const surplus = Math.max(0, names.length - KEEP_RELEASES)
  for (const name of removable.slice(0, surplus)) rmSync(path.join(releasesDir, name), { recursive: true, force: true })
}

/** Deletes the logs of runs the history no longer lists (and of runs that never reached it). */
function pruneLogs(keep) {
  const dir = path.join(UPDATES, 'logs')
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.log') && !keep.has(name.slice(0, -'.log'.length))) rmSync(path.join(dir, name), { force: true })
  }
}

/* --------------------------------------------------------------- main --- */

async function main(id) {
  const lock = path.join(UPDATES, 'apply.lock')
  if (!takeLock(lock)) {
    log('another update is running; this one stops here')
    process.exit(1)
  }
  process.on('exit', () => rmSync(lock, { force: true }))

  const pendingFile = path.join(UPDATES, 'pending', `${id}.json`)
  const bundleFile = path.join(UPDATES, 'pending', `${id}.bundle`)
  const meta = readJson(pendingFile)
  state = {
    id,
    version: meta?.version ?? '?',
    label: meta?.label ?? '?',
    state: 'running',
    startedAt: now(),
    endedAt: null,
    steps: STEPS.map((key) => ({ key, state: 'pending' })),
    release: null,
    previous: null,
    backup: null,
    error: null,
    confirmedBy: meta?.confirmedBy ?? null,
  }
  save()

  const releasesDir = path.dirname(LIVE_RELEASE)
  const home = path.dirname(releasesDir)
  const current = path.join(home, 'current')
  const shared = path.join(home, 'shared')
  let switched = false
  let previous = null
  let releaseDir = null

  try {
    if (!meta?.confirmedAt) throw new Error('this update was never confirmed')
    if (path.basename(releasesDir) !== 'releases' || !existsSync(current) || !existsSync(shared)) {
      throw new Error('the app is not installed with the release layout (see deploy/install.sh)')
    }

    let bundle
    await step('verify', async () => {
      const buffer = readFileSync(bundleFile)
      if (sha256Hex(buffer) !== meta.sha256) throw new Error('the bundle is not the one that was confirmed')
      bundle = readBundle(buffer)
      log(`${bundle.files.length} files, version ${bundle.version}`)
    })

    await step('backup', async () => {
      state.backup = await backupDatabase(shared, id)
    })

    await step('unpack', async () => {
      const releaseId = `${stamp()}-${bundle.version.replace(/[^a-zA-Z0-9.]/g, '-').slice(0, 32)}`
      releaseDir = path.join(releasesDir, releaseId)
      extractBundle(bundle, releaseDir)
      symlinkSync(path.join(shared, '.env.local'), path.join(releaseDir, '.env.local'))
      symlinkSync(path.join(shared, '.data'), path.join(releaseDir, '.data'))
      writeJson(path.join(releaseDir, '.release.json'), { id: releaseId, version: bundle.version, update: id, createdAt: now() })
      state.release = releaseId
    })

    await step('install', () => run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], releaseDir, { NODE_ENV: 'development' }))
    await step('migrate', () => run(process.execPath, ['scripts/migrate.mjs'], releaseDir))
    // On a small VPS Node caps its heap near half the RAM, and the build's type check needs more: let it use the swap.
    await step('build', () =>
      run(process.execPath, ['node_modules/next/dist/bin/next', 'build'], releaseDir, {
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: '--max-old-space-size=2048',
      }),
    )

    await step('switch', async () => {
      previous = realpathSync(current)
      state.previous = releaseIdOf(previous)
      pointCurrent(current, releaseDir)
      switched = true
    })
    await step('restart', () => restartApp(shared))
    await step('health', () => waitForRelease(state.release))

    state.state = 'succeeded'
    try {
      pruneReleases(releasesDir, new Set([releaseDir, previous]))
    } catch (error) {
      log(`cleanup skipped: ${message(error)}`)
    }
  } catch (error) {
    state.error = message(error)
    log(`failed: ${state.error}`)
    if (switched && previous) {
      log(`putting ${path.basename(previous)} back`)
      try {
        pointCurrent(current, previous)
        await restartApp(shared)
        await waitForRelease(releaseIdOf(previous))
        state.state = 'rolled-back'
      } catch (again) {
        state.state = 'failed'
        state.error = `${state.error}; putting the previous release back failed too: ${message(again)}`
      }
    } else {
      state.state = 'failed'
      if (releaseDir) rmSync(releaseDir, { recursive: true, force: true })
    }
  } finally {
    state.endedAt = now()
    save()
    const historyFile = path.join(UPDATES, 'history.json')
    const { steps: _steps, ...record } = state
    const history = [record, ...(readJson(historyFile) ?? [])].slice(0, HISTORY_SIZE)
    writeJson(historyFile, history)
    try {
      pruneLogs(new Set(history.map((entry) => entry.id)))
    } catch (error) {
      log(`log cleanup skipped: ${message(error)}`)
    }
    // Spent either way: a failed update is sent again, never retried from a stale copy.
    rmSync(pendingFile, { force: true })
    rmSync(bundleFile, { force: true })
    log(`finished: ${state.state}`)
  }
}

/* -------------------------------------------------------------- start --- */

/*
 * Last, not first. A module's `let` and `const` do not exist until their line
 * has run, so calling main() from the top of the file threw "Cannot access
 * 'state' before initialization" before it could write a word of status — and
 * every update ended as "interrupted".
 */
loadEnv()
const updateId = checkId(first)
try {
  await main(updateId)
} catch (error) {
  // main() records its own failures; this is for one it cannot (a full disk, say).
  log(`updater crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  try {
    const statusFile = path.join(UPDATES, 'status.json')
    const recorded = readJson(statusFile)
    if (recorded?.id === updateId && (recorded.state === 'queued' || recorded.state === 'running')) {
      writeJson(statusFile, { ...recorded, state: 'failed', endedAt: now(), error: message(error) })
    }
  } catch {
    // Nothing more to do; the log above has the story.
  }
  process.exitCode = 1
}
