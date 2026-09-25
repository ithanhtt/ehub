/**
 * What the SQL console lets through, decided before anything reaches the
 * database.
 *
 * The console runs one statement at a time, inside a transaction the console
 * opens itself — READ ONLY unless the Administrator has switched writes on.
 * The read-only transaction is what actually keeps a read from writing; this
 * file only turns away what that transaction cannot:
 *
 *   - more than one statement. node-postgres sends a statement without
 *     parameters over the simple protocol, which runs `select 1; drop …`
 *     as two — the second one outside anything the console decided;
 *   - transaction and session control (BEGIN, COMMIT, SET, RESET …): a COMMIT
 *     would end the console's own read-only transaction, and a plain SET on
 *     the embedded database changes the one connection the whole app shares;
 *   - VACUUM and COPY: the first cannot run in a transaction (the System page
 *     has a button for it), the second reads and writes files on the server;
 *   - functions that reach outside the database or hold it: reading server
 *     files, signalling backends, set_config, advisory locks, pg_sleep — on
 *     the embedded database a sleep stops every request the app serves;
 *   - statements naming a secret column (secrets.ts): masking works by the
 *     result's column names, which an alias would change;
 *   - and, even with writes on, a short deny list of the irreversible:
 *     dropping a database, a schema, roles; emptying, dropping or rewriting
 *     every row of the sign-in tables; touching the audit trail or drizzle's
 *     migration journal; ALTER SYSTEM.
 *
 * It is a tokenizer, not a parser: it knows strings, quoted identifiers,
 * dollar quoting and comments well enough that a semicolon or a keyword
 * inside any of them is not mistaken for SQL. Pure and DB-free, so
 * `npm run check:plugins` can hold it to all of the above.
 */

export type Token = {
  kind: 'word' | 'quoted' | 'string' | 'number' | 'symbol' | 'semicolon'
  /** Lower-cased for words; the unescaped contents for quoted identifiers and strings. */
  text: string
  start: number
}

export type GuardFailure =
  | { code: 'empty' }
  | { code: 'unterminated' }
  | { code: 'multiple' }
  | { code: 'control'; word: string }
  | { code: 'vacuum' }
  | { code: 'copy' }
  | { code: 'function'; name: string }
  | { code: 'secret'; column: string }
  | { code: 'secretTable'; table: string }
  | { code: 'denied'; rule: DenyRule }

export type DenyRule = 'dropDatabase' | 'dropSchema' | 'roles' | 'alterSystem' | 'authTable' | 'auditTrail' | 'migrations'

export type GuardResult =
  | {
      ok: true
      /** The statement without its trailing semicolons. */
      statement: string
      /** Its first keyword, lower-cased. */
      leading: string
      /** A plain query: safe to wrap as a subquery for the row cap, and nothing to snapshot for. */
      readLike: boolean
      /** Every table-ish word it names, lower-cased — for the table-specific masking. */
      words: Set<string>
    }
  | { ok: false; failure: GuardFailure }

const WORD_START = /[A-Za-z_\u0080-￿]/
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/

export function tokenize(source: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '-' && source[i + 1] === '-') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      // Postgres block comments nest.
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') {
          depth++
          i += 2
        } else if (source[i] === '*' && source[i + 1] === '/') {
          depth--
          i += 2
        } else i++
      }
      if (depth > 0) return null
      continue
    }
    if (c === "'") {
      // E'…' strings take backslash escapes; the E was read as a word just before.
      const prev = tokens[tokens.length - 1]
      const escapes = Boolean(prev && prev.kind === 'word' && prev.text === 'e' && prev.start + 1 === i)
      if (escapes) tokens.pop()
      const start = escapes ? i - 1 : i
      let text = ''
      i++
      let closed = false
      while (i < n) {
        if (escapes && source[i] === '\\') {
          text += source[i + 1] ?? ''
          i += 2
          continue
        }
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            text += "'"
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        text += source[i++]
      }
      if (!closed) return null
      tokens.push({ kind: 'string', text, start })
      continue
    }
    if (c === '"') {
      const start = i
      let text = ''
      i++
      let closed = false
      while (i < n) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            text += '"'
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        text += source[i++]
      }
      if (!closed) return null
      tokens.push({ kind: 'quoted', text: text.toLowerCase(), start })
      continue
    }
    if (c === '$') {
      // $tag$ … $tag$ (or $$ … $$); $1 is a parameter.
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i))
      if (match) {
        const fence = match[0]
        const end = source.indexOf(fence, i + fence.length)
        if (end < 0) return null
        tokens.push({ kind: 'string', text: source.slice(i + fence.length, end), start: i })
        i = end + fence.length
        continue
      }
      const start = i
      i++
      while (i < n && /[0-9]/.test(source[i])) i++
      tokens.push({ kind: 'symbol', text: source.slice(start, i), start })
      continue
    }
    if (WORD_START.test(c)) {
      const start = i
      while (i < n && WORD_PART.test(source[i])) i++
      tokens.push({ kind: 'word', text: source.slice(start, i).toLowerCase(), start })
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i
      while (i < n && /[0-9.eE]/.test(source[i])) i++
      tokens.push({ kind: 'number', text: source.slice(start, i), start })
      continue
    }
    tokens.push({ kind: c === ';' ? 'semicolon' : 'symbol', text: c, start: i })
    i++
  }
  return tokens
}

/**
 * Ends or changes the console's own transaction, or the shared connection's
 * session — and DO and CALL, which run code given as a string (a function
 * body): every other rule here reads the statement's words, and the words
 * inside that string would pass unseen (set_config, COPY, …).
 */
const CONTROL = new Set([
  'begin', 'start', 'commit', 'end', 'rollback', 'abort', 'savepoint', 'release',
  'prepare', 'execute', 'deallocate', 'set', 'reset', 'discard',
  'listen', 'unlisten', 'notify', 'load', 'checkpoint',
  'do', 'call',
])

/**
 * Tables whose secrets the console cannot mask by column name: a whole row
 * cast to text (`select s::text from session s`), or the column under another
 * name, would show a session token, a sign-in code or an invitation's token —
 * values with no shape to recognise them by (unlike the encrypted
 * credentials). The console does not read them at all; the Tables tab does,
 * masking by column.
 */
export const SECRET_TABLES = new Set(['session', 'verification', 'account', 'project_invitations'])

/** Functions that reach outside the database, signal other sessions, change the session or hold the connection. */
const DENIED_FUNCTIONS = new Set([
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'pg_ls_logdir', 'pg_ls_waldir', 'pg_ls_tmpdir',
  'lo_import', 'lo_export', 'lo_from_bytea', 'lo_put',
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile', 'pg_promote',
  'set_config', 'pg_sleep', 'pg_sleep_for', 'pg_sleep_until',
  'pg_advisory_lock', 'pg_advisory_lock_shared',
  'dblink', 'dblink_exec', 'dblink_connect', 'dblink_send_query',
])

/** The sign-in tables: emptied, dropped or rewritten wholesale, nobody can sign in again. */
export const AUTH_TABLES = new Set(['user', 'session', 'account', 'verification'])

const READ_LEADING = new Set(['select', 'with', 'values', 'table'])
const WRITE_WORDS = new Set(['into', 'insert', 'update', 'delete', 'merge', 'truncate', 'drop', 'alter', 'create', 'grant', 'revoke'])

export function guardStatement(source: string, secretColumns: Iterable<string>): GuardResult {
  const tokens = tokenize(source)
  if (!tokens) return { ok: false, failure: { code: 'unterminated' } }
  const firstSemicolon = tokens.findIndex((token) => token.kind === 'semicolon')
  if (firstSemicolon >= 0 && tokens.slice(firstSemicolon).some((token) => token.kind !== 'semicolon')) {
    return { ok: false, failure: { code: 'multiple' } }
  }
  const body = firstSemicolon >= 0 ? tokens.slice(0, firstSemicolon) : tokens
  if (body.length === 0) return { ok: false, failure: { code: 'empty' } }
  const statement = (firstSemicolon >= 0 ? source.slice(0, tokens[firstSemicolon].start) : source).trim()

  const firstWord = body.find((token) => token.kind === 'word')
  const leading = firstWord?.text ?? ''
  const words = new Set(body.filter((token) => token.kind === 'word' || token.kind === 'quoted').map((token) => token.text))
  const plain = body.filter((token) => token.kind === 'word').map((token) => token.text)

  if (CONTROL.has(leading)) return { ok: false, failure: { code: 'control', word: leading.toUpperCase() } }
  if (leading === 'vacuum') return { ok: false, failure: { code: 'vacuum' } }
  if (leading === 'copy') return { ok: false, failure: { code: 'copy' } }

  for (const [index, token] of body.entries()) {
    const next = body[index + 1]
    if ((token.kind === 'word' || token.kind === 'quoted') && DENIED_FUNCTIONS.has(token.text) && next?.text === '(') {
      return { ok: false, failure: { code: 'function', name: token.text } }
    }
  }

  const secrets = new Set([...secretColumns].map((name) => name.toLowerCase()))
  for (const token of body) {
    if ((token.kind === 'word' || token.kind === 'quoted' || token.kind === 'string') && secrets.has(token.text.toLowerCase())) {
      return { ok: false, failure: { code: 'secret', column: token.text.toLowerCase() } }
    }
  }

  for (const token of body) {
    if ((token.kind === 'word' || token.kind === 'quoted') && SECRET_TABLES.has(token.text.toLowerCase())) {
      return { ok: false, failure: { code: 'secretTable', table: token.text.toLowerCase() } }
    }
  }

  const readLike = READ_LEADING.has(leading) && !plain.some((word) => WRITE_WORDS.has(word))
  const denied = denyRule(body, leading, words, readLike)
  if (denied) return { ok: false, failure: { code: 'denied', rule: denied } }

  return { ok: true, statement, leading, readLike, words }
}

function denyRule(body: Token[], leading: string, words: Set<string>, readLike: boolean): DenyRule | null {
  const second = body.filter((token) => token.kind === 'word')[1]?.text ?? ''
  if (leading === 'drop' && second === 'database') return 'dropDatabase'
  if (leading === 'drop' && (second === 'schema' || second === 'owned')) return 'dropSchema'
  if ((leading === 'drop' || leading === 'create' || leading === 'alter') && (second === 'role' || second === 'user' || second === 'group')) return 'roles'
  if (leading === 'alter' && (second === 'system' || second === 'database')) return 'alterSystem'
  if (readLike) return null
  if (words.has('audit_logs')) return 'auditTrail'
  if (words.has('__drizzle_migrations')) return 'migrations'

  const namesAuth = [...AUTH_TABLES].some((table) => words.has(table))
  if (!namesAuth) return null
  if (leading === 'truncate' || (leading === 'drop' && second === 'table') || (leading === 'alter' && second === 'table')) return 'authTable'
  // Every row at once: an UPDATE or DELETE on a sign-in table with no WHERE.
  if ((leading === 'delete' || leading === 'update') && !words.has('where')) {
    const target = targetOf(body, leading)
    if (target && AUTH_TABLES.has(target)) return 'authTable'
  }
  return null
}

/** The table a DELETE FROM / UPDATE acts on (the last part of a qualified name). */
function targetOf(body: Token[], leading: string): string | null {
  let at = body.findIndex((token) => token.kind === 'word' && token.text === leading)
  if (leading === 'delete') at = body.findIndex((token, i) => i > at && token.kind === 'word' && token.text === 'from')
  if (at < 0) return null
  let i = at + 1
  if (body[i]?.kind === 'word' && body[i].text === 'only') i++
  let name: string | null = null
  while (body[i] && (body[i].kind === 'word' || body[i].kind === 'quoted')) {
    name = body[i].text
    if (body[i + 1]?.text !== '.') break
    i += 2
  }
  return name
}
