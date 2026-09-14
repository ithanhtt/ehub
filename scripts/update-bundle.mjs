/**
 * EHub update bundles: one file carrying a release's source from the
 * machine the code is written on to the server that runs it.
 *
 * Plain on purpose — gzip over JSON, with Node's own zlib and nothing else —
 * so the installer can open one before a single dependency is installed, and
 * the app, the updater and the installer all read it the same way.
 *
 * What goes in is a fixed list of top-level entries (BUNDLE_ROOTS): never
 * dependencies, build output, the local database or any .env file. What comes
 * out is checked path by path — relative, on the list, no way out through
 * "..", nothing that is never shipped — and a bundle that breaks any rule is
 * refused whole, never partly unpacked.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

export const BUNDLE_FORMAT = 'adshub-bundle@1'

/** A release is made of these top-level entries, and nothing else. */
export const BUNDLE_ROOTS = [
  'src',
  'messages',
  'public',
  'scripts',
  'drizzle',
  'deploy',
  'package.json',
  'package-lock.json',
  'next.config.ts',
  'tsconfig.json',
  'drizzle.config.ts',
  '.env.example',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
]

/** The largest bundle accepted, compressed. */
export const MAX_BUNDLE_BYTES = 60 * 1024 * 1024
/** …and once unpacked. */
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024
const MAX_FILES = 20_000

/** Never shipped, wherever they sit: dependencies, build output, local data, OS litter. */
const SKIPPED = new Set([
  'node_modules',
  '.next',
  '.data',
  '.git',
  '.turbo',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  'tsconfig.tsbuildinfo',
])

/** Secrets stay on the machine they belong to: every .env file but the example. */
const isSecret = (name) => (name === '.env' || name.startsWith('.env.')) && name !== '.env.example'

/** @param {Buffer} buffer */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Why a path may not be in a bundle, or null when it may.
 * @param {unknown} file
 * @returns {string | null}
 */
export function pathProblem(file) {
  if (typeof file !== 'string' || file.length === 0 || file.length > 400) return 'not a path'
  if (file.includes('\\') || file.includes('\0')) return 'bad characters'
  if (file.startsWith('/') || /^[A-Za-z]:/.test(file)) return 'absolute'
  const parts = file.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return 'escapes the release'
  if (!BUNDLE_ROOTS.includes(parts[0])) return 'not part of a release'
  if (parts.some((part) => SKIPPED.has(part)) || isSecret(parts[parts.length - 1])) return 'never shipped'
  return null
}

/**
 * Every file of the release under `root`, as bundle entries. Symbolic links
 * are left out: a release carries files, not pointers to elsewhere.
 * @param {string} root
 * @returns {Array<{ path: string; executable: boolean; data: Buffer }>}
 */
export function collectFiles(root) {
  const files = []
  const walk = (relative) => {
    const absolute = path.join(/*turbopackIgnore: true*/ root, ...relative.split('/'))
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) return
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (SKIPPED.has(name) || isSecret(name) || name.endsWith('.log')) continue
        walk(`${relative}/${name}`)
      }
      return
    }
    if (!stat.isFile()) return
    files.push({ path: relative, executable: relative.endsWith('.sh') || (stat.mode & 0o111) !== 0, data: readFileSync(absolute) })
  }
  // Reads the checkout at run time; the comment stops Next's tracer from shipping the whole project for it.
  for (const entry of BUNDLE_ROOTS) if (existsSync(path.join(/*turbopackIgnore: true*/ root, entry))) walk(entry)
  return files
}

/**
 * Packs the release under `root`. `sha256` is taken over the packed bytes:
 * what is signed on one side and checked on the other.
 * @param {string} root
 * @param {{ version: string; label: string }} about
 */
export function packBundle(root, { version, label }) {
  const files = collectFiles(root)
  for (const file of files) {
    const problem = pathProblem(file.path)
    if (problem) throw new Error(`${file.path}: ${problem}`)
    // A script that no longer starts like one has been overwritten — by a copied bundle, say.
    if (file.path.endsWith('.sh') && file.data.subarray(0, 2).toString('latin1') !== '#!') {
      throw new Error(`${file.path} is not a shell script any more (was it overwritten?) — restore it before packing`)
    }
  }
  const createdAt = new Date().toISOString()
  const manifest = {
    format: BUNDLE_FORMAT,
    version,
    label,
    createdAt,
    files: files.map((file) => ({ path: file.path, executable: file.executable, data: file.data.toString('base64') })),
  }
  const buffer = gzipSync(Buffer.from(JSON.stringify(manifest)), { level: 9 })
  return {
    buffer,
    sha256: sha256Hex(buffer),
    version,
    label,
    createdAt,
    files: files.length,
    unpackedBytes: files.reduce((total, file) => total + file.data.length, 0),
  }
}

/**
 * Opens a bundle and checks every rule; throws, naming the first rule broken.
 * @param {Buffer} buffer
 * @returns {{ version: string; label: string; createdAt: string | null; files: Array<{ path: string; executable: boolean; data: Buffer }> }}
 */
export function readBundle(buffer) {
  if (buffer.length > MAX_BUNDLE_BYTES) throw new Error('bundle too large')
  let manifest
  try {
    // Base64 inside the JSON runs about a third larger than the files themselves.
    const text = gunzipSync(buffer, { maxOutputLength: Math.ceil(MAX_UNPACKED_BYTES * 1.4) + 1_000_000 }).toString('utf8')
    manifest = JSON.parse(text)
  } catch {
    throw new Error('not a readable bundle')
  }
  if (!manifest || manifest.format !== BUNDLE_FORMAT) throw new Error('unknown bundle format')
  if (typeof manifest.version !== 'string' || !Array.isArray(manifest.files)) throw new Error('malformed bundle')
  if (manifest.files.length === 0 || manifest.files.length > MAX_FILES) throw new Error('wrong number of files')

  const seen = new Set()
  let total = 0
  const files = manifest.files.map((file) => {
    const problem = pathProblem(file?.path)
    if (problem) throw new Error(`${String(file?.path)}: ${problem}`)
    // Case-folded, so no two entries can land on one file on a case-insensitive disk.
    const key = file.path.toLowerCase()
    if (seen.has(key)) throw new Error(`${file.path}: listed twice`)
    seen.add(key)
    if (typeof file.data !== 'string') throw new Error(`${file.path}: no content`)
    const data = Buffer.from(file.data, 'base64')
    total += data.length
    if (total > MAX_UNPACKED_BYTES) throw new Error('bundle unpacks too large')
    return { path: file.path, executable: file.executable === true, data }
  })
  for (const required of ['package.json', 'package-lock.json']) {
    if (!seen.has(required)) throw new Error(`${required} missing`)
  }
  return {
    version: manifest.version,
    label: typeof manifest.label === 'string' ? manifest.label : manifest.version,
    createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : null,
    files,
  }
}

/**
 * Writes a checked bundle's files under `dir`, which must not exist yet.
 * @param {ReturnType<typeof readBundle>} bundle
 * @param {string} dir
 */
export function extractBundle(bundle, dir) {
  if (existsSync(dir)) throw new Error(`${dir} already exists`)
  mkdirSync(dir, { recursive: true })
  const base = path.resolve(dir)
  for (const file of bundle.files) {
    const target = path.resolve(base, ...file.path.split('/'))
    // Checked when read; checked again where it matters, against the real directory.
    if (!target.startsWith(base + path.sep)) throw new Error(`${file.path}: escapes the release`)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, file.data, { mode: file.executable ? 0o755 : 0o644 })
  }
}
