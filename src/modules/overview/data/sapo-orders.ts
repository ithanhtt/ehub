/**
 * How one Sapo order counts, and how a day's figures are summed from its
 * orders — the arithmetic of sapo.ts, kept apart from its reads so it can be
 * checked on its own (it imports nothing, and runs as it is under Node).
 *
 * The central idea: an order is first turned into its facts (OrderFacts) —
 * what it adds to its day: its channel, hour, value, whether it is cancelled,
 * its lines, VAT, shipping, the refunds on it and the products it holds — and
 * a day is the fold of its orders' facts (foldDay). The fold visits the orders
 * in one fixed order (the time placed, then the id), whatever order they were
 * read in, so the same orders always give the same day to the last bit of
 * every float. That is what lets today be kept current order by order: when
 * the ledger sees one of today's orders modified (cancelled, its total or
 * lines edited), its facts replace the old ones — exactly once, keyed by id —
 * and the day folded again equals what a full read of today would give.
 *
 * The rest are the small rules the reads around it follow: which version of
 * an order is newer, where the ledger's mark moves (by Sapo's clock, not
 * ours), when an older day is worth reading again, how a failed day waits
 * before it is tried again, and how a day's read is checked against Sapo's
 * own count.
 */

export type Order = Record<string, unknown>

/**
 * One hour's orders placed: [orders, cancelled, gmv, cancelled value, lines,
 * VAT, shipping] — see Tally.
 */
export type HourTally = [number, number, number, number, number, number, number]

export type Tally = {
  /** Orders placed, cancelled ones included. */
  created: number
  /** Of those, the ones cancelled. */
  cancelled: number
  /** Value of every order placed (`total_price`: after discounts, VAT and shipping in), cancelled ones included. */
  gmv: number
  cancelledValue: number
  /** Their lines at list price, VAT taken out — Sapo's Tiền hàng (see linesOf). */
  lines: number
  /** The VAT inside `gmv`. */
  tax: number
  shipping: number
  /** The same for each hour of the day, Vietnam time, by the hour placed. */
  hours: HourTally[]
}

/** Refunds: [how many, amount with VAT, the VAT in it]. */
export type RefundTally = [number, number, number]

/** One product's orders on one day, in one channel. */
/** [orders, cancelled orders, value, cancelled value] — the last two from products version 4. */
export type ProductHour = [number, number] | [number, number, number, number]

export type ProductDay = {
  name: string
  /** Orders containing it (an order with two lines of it counts once), and the units in them. */
  orders: number
  quantity: number
  /** Of those orders, the ones cancelled. Missing, like the values below, on days read before products version 2. */
  cancelled?: number
  /** Its lines' value after discounts (see `lineValue`), cancelled orders included — as the day's GMV counts them. */
  gmv?: number
  /** The part of `gmv` in cancelled orders. */
  cancelledGmv?: number
  /** Time of its latest order, epoch ms. */
  last: number
  /** The SKUs its lines were sold under — what ties it to the same product on TikTok Shop. From products version 3. */
  skus?: string[]
  /**
   * By the hour placed (Vietnam time), hours without orders left out: its
   * orders and, of those, the cancelled (products version 3 on); then its
   * lines' value and the part of it in cancelled orders, as `gmv` and
   * `cancelledGmv` count them (version 4 on — absent on days read before).
   */
  hours?: Record<string, ProductHour>
}

const VN_OFFSET_MS = 7 * 3600_000

/** The day an instant falls on, Vietnam time — the same as period.ts's vnDate. */
export const vnDay = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10)
export const vnHour = (ms: number) => new Date(ms + VN_OFFSET_MS).getUTCHours()

export const emptyHours = (): HourTally[] => Array.from({ length: 24 }, (): HourTally => [0, 0, 0, 0, 0, 0, 0])

export const emptyTally = (): Tally => ({
  created: 0,
  cancelled: 0,
  gmv: 0,
  cancelledValue: 0,
  lines: 0,
  tax: 0,
  shipping: 0,
  hours: emptyHours(),
})

export const channelOf = (order: Order, otherChannel: string) =>
  typeof order.source_name === 'string' && order.source_name ? order.source_name : otherChannel

/** When the revenue report files the order: `processed_on`, or its creation when that is missing. */
export function placedAt(order: Order): number {
  const at = Date.parse(String(order.processed_on ?? order.created_on))
  return Number.isNaN(at) ? Date.parse(String(order.created_on)) : at
}

/** When Sapo last changed the order, by Sapo's clock; NaN when it does not say. */
export function modifiedAt(order: Order): number {
  return Date.parse(String(order.modified_on ?? order.updated_on))
}

export const isCancelled = (order: Order) => Boolean(order.cancelled_on || order.status === 'cancelled')

const lineItems = (order: Order) => (Array.isArray(order.line_items) ? (order.line_items as Array<Record<string, unknown>>) : [])

/**
 * A line's value after discounts: `discounted_total`, price × quantity less
 * the discounts allocated to the line. Over an order's lines it adds up to the
 * order's total_price (measured: 133 orders out of 133), so the products' GMV
 * adds up to the day's. Gifts are lines at 0 ₫.
 */
export function lineValue(line: Record<string, unknown>): number {
  if (line.discounted_total !== undefined && line.discounted_total !== null) {
    const total = Number(line.discounted_total)
    if (Number.isFinite(total)) return total
  }
  const allocations = Array.isArray(line.discount_allocations) ? (line.discount_allocations as Array<Record<string, unknown>>) : []
  const allocated = allocations.reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0)
  return (Number(line.price) || 0) * (Number(line.quantity) || 0) - allocated
}

/**
 * The order's lines at list price without VAT — the report's Tiền hàng. This
 * store's prices include VAT (`taxes_included`), and the report takes it out
 * of each line that carries some: price × quantity ÷ (1 + rate). A line with
 * none — a gift, 0 ₫ once discounted — counts at its list price. Within a few
 * đồng an hour of the report, which rounds each line its own way.
 */
export function linesOf(order: Order): number {
  let sum = 0
  for (const line of lineItems(order)) {
    const value = (Number(line.price) || 0) * (Number(line.quantity) || 0)
    const taxes = Array.isArray(line.tax_lines) ? (line.tax_lines as Array<Record<string, unknown>>) : []
    const vat = taxes.reduce((s, tax) => s + (Number(tax.price) || 0), 0)
    const rate = taxes.reduce((s, tax) => s + (Number(tax.rate) || 0), 0)
    sum += order.taxes_included !== false && vat > 0 && rate > 0 ? value / (1 + rate) : value
  }
  return sum
}

/**
 * The order's refunds — cancellation or return, Sapo records both as one —
 * each with the time it was made and its amount with VAT and the VAT in it.
 * A refund's lines carry both (`subtotal` includes VAT when prices do).
 */
export function refundsOf(order: Order): Array<{ id: string; at: number; amount: number; tax: number }> {
  const refunds = Array.isArray(order.refunds) ? (order.refunds as Array<Record<string, unknown>>) : []
  const out: Array<{ id: string; at: number; amount: number; tax: number }> = []
  for (const refund of refunds) {
    const at = Date.parse(String(refund.created_on ?? refund.processed_at))
    if (Number.isNaN(at)) continue
    const lines = Array.isArray(refund.refund_line_items) ? (refund.refund_line_items as Array<Record<string, unknown>>) : []
    const subtotal = lines.reduce((sum, line) => sum + (Number(line.subtotal) || 0), 0)
    const tax = lines.reduce((sum, line) => sum + (Number(line.total_tax) || 0), 0)
    out.push({ id: String(refund.id ?? `${String(order.id)}@${at}`), at, amount: order.taxes_included === false ? subtotal + tax : subtotal, tax })
  }
  return out
}

/** One line of a product in an order, as the day's product figures count it. */
type ProductLine = { key: string; name: string; quantity: number; value: number; sku: string }

/** What one order adds to its day — everything the day's figures take from it, and no more. */
export type OrderFacts = {
  id: string
  /** Sapo's `modified_on`, epoch ms; NaN when missing. Of two versions of an order, the later one counts. */
  modified: number
  channel: string
  /** placedAt; NaN when the order carries no usable time (then filed under hour 0, as ever). */
  at: number
  amount: number
  cancelled: boolean
  lines: number
  tax: number
  shipping: number
  /** Its refunds so far: [day made (Vietnam time), amount with VAT, the VAT in it]. */
  refunds: Array<[string, number, number]>
  /** Its product lines, removed lines and lines without a product or SKU left out. */
  products: ProductLine[]
}

export function factsOf(order: Order, otherChannel: string): OrderFacts {
  const products: ProductLine[] = []
  for (const line of lineItems(order)) {
    if (line.deleted === true) continue
    const key = line.product_id ? String(line.product_id) : typeof line.sku === 'string' && line.sku ? `sku:${line.sku}` : null
    if (!key) continue
    products.push({
      key,
      name: String(line.title || line.name || key),
      quantity: Number(line.quantity) || 0,
      value: lineValue(line),
      sku: typeof line.sku === 'string' ? line.sku.trim() : '',
    })
  }
  return {
    id: String(order.id),
    modified: modifiedAt(order),
    channel: channelOf(order, otherChannel),
    at: placedAt(order),
    amount: Number(order.total_price ?? 0) || 0,
    cancelled: isCancelled(order),
    lines: linesOf(order),
    tax: Number(order.total_tax ?? 0) || 0,
    shipping: Number(order.total_shipping_price ?? 0) || 0,
    refunds: refundsOf(order).map((refund): [string, number, number] => [vnDay(refund.at), refund.amount, refund.tax]),
    products,
  }
}

/**
 * Whether `next` should replace `previous` of the same order: it is not older.
 * A version without a time replaces one, and is replaced — as the reads before
 * this did, the last read counts.
 */
export function isNewer(next: OrderFacts, previous: OrderFacts | undefined): boolean {
  if (!previous) return true
  if (Number.isNaN(next.modified) || Number.isNaN(previous.modified)) return true
  return next.modified >= previous.modified
}

/** Keeps `facts` in `into` if it is the newer version; true when anything changed. */
export function keepNewer(into: Map<string, OrderFacts>, facts: OrderFacts): boolean {
  const previous = into.get(facts.id)
  if (!isNewer(facts, previous)) return false
  into.set(facts.id, facts)
  return !previous || signatureOf(previous) !== signatureOf(facts) || JSON.stringify(previous.refunds) !== JSON.stringify(facts.refunds)
}

/** Two reads of the same day as one: every order in either, each at its newer version. */
export function mergeNewer(into: Map<string, OrderFacts>, from: Iterable<OrderFacts>): Map<string, OrderFacts> {
  for (const facts of from) keepNewer(into, facts)
  return into
}

/** One day's figures, as DayStats keeps them. */
export type DayFigures = {
  sources: Record<string, Tally>
  /** The refunds on this day's orders, by the day made, per channel. */
  refunds: Record<string, Record<string, RefundTally>>
  products: Record<string, Record<string, ProductDay>>
}

/** Placed first, then by id: the one order every fold visits orders in. NaN times go first. */
function byPlaced(a: OrderFacts, b: OrderFacts): number {
  const x = Number.isNaN(a.at) ? -Infinity : a.at
  const y = Number.isNaN(b.at) ? -Infinity : b.at
  if (x !== y) return x < y ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * A day's figures from its orders' facts. The orders are visited in one fixed
 * order (byPlaced), so the sums — floats, since the lines' VAT is divided out
 * — come out the same to the last bit however the orders were read; and a
 * product's name is the one on its latest order, as the product lists across
 * days already take it.
 */
export function foldDay(orders: Iterable<OrderFacts>): DayFigures {
  const sources: Record<string, Tally> = {}
  const refunds: Record<string, Record<string, RefundTally>> = {}
  const products: Record<string, Record<string, ProductDay>> = {}
  for (const order of [...orders].sort(byPlaced)) {
    const { channel, amount, cancelled, lines, tax, shipping, at } = order
    const tally = (sources[channel] ??= emptyTally())
    const hour = Number.isNaN(at) ? 0 : vnHour(at)
    const hourly = tally.hours[hour]

    tally.created += 1
    tally.gmv += amount
    tally.lines += lines
    tally.tax += tax
    tally.shipping += shipping
    hourly[0] += 1
    hourly[2] += amount
    hourly[4] += lines
    hourly[5] += tax
    hourly[6] += shipping
    if (cancelled) {
      tally.cancelled += 1
      tally.cancelledValue += amount
      hourly[1] += 1
      hourly[3] += amount
    }

    // Its refunds so far, filed under the day each was made.
    for (const [day, refunded, refundedTax] of order.refunds) {
      const cell = ((refunds[day] ??= {})[channel] ??= [0, 0, 0])
      cell[0] += 1
      cell[1] += refunded
      cell[2] += refundedTax
    }

    // The products it held: each counted once per order, whatever its lines.
    const list = (products[channel] ??= {})
    const counted = new Set<string>()
    for (const line of order.products) {
      const entry = (list[line.key] ??= {
        name: line.name,
        orders: 0,
        quantity: 0,
        cancelled: 0,
        gmv: 0,
        cancelledGmv: 0,
        last: 0,
        skus: [],
        hours: {},
      })
      entry.quantity += line.quantity
      entry.gmv = (entry.gmv ?? 0) + line.value
      if (cancelled) entry.cancelledGmv = (entry.cancelledGmv ?? 0) + line.value
      // Every line's value goes to the hour placed; the order itself is counted there once, below.
      const cell = ((entry.hours ??= {})[String(hour)] ??= [0, 0, 0, 0]) as [number, number, number, number]
      cell[2] += line.value
      if (cancelled) cell[3] += line.value
      if (line.sku && !(entry.skus ??= []).includes(line.sku)) entry.skus.push(line.sku)
      if (!counted.has(line.key)) {
        entry.name = line.name
        entry.orders += 1
        if (cancelled) entry.cancelled = (entry.cancelled ?? 0) + 1
        cell[0] += 1
        if (cancelled) cell[1] += 1
        counted.add(line.key)
      }
      if (at > entry.last) entry.last = at
    }
  }
  return { sources, refunds, products }
}

/**
 * A short fingerprint of what an order adds to its day's placed figures —
 * refunds left out (they are the ledger's, by the day made) and the time
 * modified too (a delivery update changes nothing counted). Two versions with
 * the same fingerprint count the same.
 */
export function signatureOf(facts: OrderFacts): number {
  const text = JSON.stringify([
    facts.channel,
    facts.at,
    facts.amount,
    facts.cancelled,
    facts.lines,
    facts.tax,
    facts.shipping,
    facts.products.map((line) => [line.key, line.name, line.quantity, line.value, line.sku]),
  ])
  // FNV-1a, 32 bits: a fingerprint, not a secret.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The fingerprint of every order of a day, by id — what tells a later change to one of them apart from a delivery update. */
export function signaturesOf(orders: Iterable<OrderFacts>): Map<string, number> {
  const out = new Map<string, number>()
  for (const facts of orders) out.set(facts.id, signatureOf(facts))
  return out
}

/**
 * Whether a modified order of an earlier day kept on file means that day's
 * figures are out of date. With the day's fingerprints (it was read in this
 * run), exactly: the order counts differently now, or it was not there. Without
 * them, the one change that can be told from the order alone: cancelled after
 * the day was read.
 */
export function changesKeptDay(
  facts: OrderFacts,
  order: Order,
  readAt: number,
  signatures: Map<string, number> | undefined,
): boolean {
  if (signatures) return signatures.get(facts.id) !== signatureOf(facts)
  if (!facts.cancelled) return false
  const cancelledAt = Date.parse(String(order.cancelled_on))
  return (Number.isNaN(cancelledAt) ? facts.modified : cancelledAt) > readAt
}

/**
 * Where the ledger's mark goes after a read of what changed: the latest
 * `modified_on` it saw — Sapo's clock, so a server clock ahead of Sapo's can
 * never make the next read start after changes it has not seen — and never
 * back. Only when the orders came back with no time at all does it fall back
 * to this server's clock at the read's start (`started`), as before.
 */
export function nextCursor(previous: number, orders: { newest: number; untimed: boolean }, started: number): number {
  if (Number.isFinite(orders.newest)) return Math.max(previous, orders.newest)
  return orders.untimed ? Math.max(previous, started) : previous
}

/** The latest `modified_on` among `orders` (NaN when none has one), and whether any came without. */
export function newestModified(orders: Order[], seen: { newest: number; untimed: boolean } = { newest: NaN, untimed: false }) {
  for (const order of orders) {
    const at = modifiedAt(order)
    if (Number.isNaN(at)) seen.untimed = true
    else if (!(at <= seen.newest)) seen.newest = at
  }
  return seen
}

/* ------------------------------------------------ days read again, days failed --- */

/** A marked day waits this long before it is read again, so a burst of changes to it costs one read. */
export const RECHECK_SETTLE_MS = 2 * 60_000
/** No day is read again for a change sooner than this after its last read. */
export const RECHECK_GAP_MS = 15 * 60_000
/** At most one such read this often per store: they are extra, and a day weighs 8–14 MB. */
export const RECHECK_EVERY_MS = 5 * 60_000

/** Earlier days a change was seen on, day → when first marked; and when one was last let through. */
export type Rechecks = { marks: Map<string, number>; admittedAt: number }

export const newRechecks = (): Rechecks => ({ marks: new Map(), admittedAt: 0 })

/** Marks a day to be read again; a day already marked keeps its first mark (one read for many changes). */
export function markRecheck(rechecks: Rechecks, day: string, now: number) {
  if (!rechecks.marks.has(day)) rechecks.marks.set(day, now)
}

/**
 * The marked day to read again now, if one is due: settled, not being read or
 * waiting out a failure (`busy`), not read in the last RECHECK_GAP_MS, and no
 * other let through in the last RECHECK_EVERY_MS. The most recent day first.
 * The mark stays until a read that began after it lands (settleRecheck), so a
 * failed read is tried again.
 */
export function takeRecheck(
  rechecks: Rechecks,
  now: number,
  readAt: (day: string) => number | undefined,
  busy: (day: string) => boolean,
): string | null {
  if (now - rechecks.admittedAt < RECHECK_EVERY_MS) return null
  let pick: string | null = null
  for (const [day, markedAt] of rechecks.marks) {
    if (now - markedAt < RECHECK_SETTLE_MS || busy(day)) continue
    if (now - (readAt(day) ?? 0) < RECHECK_GAP_MS) continue
    if (pick === null || day > pick) pick = day
  }
  if (pick !== null) rechecks.admittedAt = now
  return pick
}

/** A read of `day` that began at `began` has landed: a mark made before it is answered. */
export function settleRecheck(rechecks: Rechecks, day: string, began: number) {
  const markedAt = rechecks.marks.get(day)
  if (markedAt !== undefined && markedAt <= began) rechecks.marks.delete(day)
}

/** A day that failed to read: why, when last, and how many times in a row. */
export type DayFailure = { message: string; at: number; count: number }

/** A failed day waits this long before it is tried again — longer once it has failed twice. */
export const RETRY_AFTER_MS = 10 * 60_000
export const RETRY_AFTER_REPEAT_MS = 15 * 60_000
/** A failure older than this no longer shows on the page: the day is not being asked for. */
export const FAILURE_SHOWN_MS = 30 * 60_000

export function mayRetry(failures: Map<string, DayFailure>, day: string, now: number): boolean {
  const failure = failures.get(day)
  if (!failure) return true
  return now - failure.at >= (failure.count > 1 ? RETRY_AFTER_REPEAT_MS : RETRY_AFTER_MS)
}

export function recordFailure(failures: Map<string, DayFailure>, day: string, message: string, now: number) {
  const previous = failures.get(day)
  failures.set(day, { message, at: now, count: (previous?.count ?? 0) + 1 })
}

/**
 * What the page says went wrong: the latest failure among the days still
 * failing (a day read since is dropped), recent enough to matter — not the
 * last error of any read, which one success elsewhere would hide and the next
 * failure bring back.
 */
export function currentFailure(failures: Map<string, DayFailure>, now: number): string | null {
  let latest: DayFailure | null = null
  for (const failure of failures.values()) {
    if (now - failure.at > FAILURE_SHOWN_MS) continue
    if (!latest || failure.at > latest.at) latest = failure
  }
  return latest?.message ?? null
}

/* ------------------------------------------------------------ a whole day --- */

/**
 * A day's orders, checked against Sapo's own count of them. Pages are asked
 * for by number, and an order that moves up a page between two of them (one
 * before it dropped out of the day) is skipped: so a read that comes back with
 * fewer orders than `expected` — counted just before it — is read once more,
 * and the two taken together, each order at its newer version. A count that is
 * off by more than a read could ever miss is not Sapo counting the same thing,
 * and says so (`comparable: false`) so the caller stops asking.
 */
export async function readWhole(
  read: () => Promise<Map<string, OrderFacts>>,
  expected: number | null,
  slack: number,
): Promise<{ orders: Map<string, OrderFacts>; reread: boolean; short: boolean; comparable: boolean }> {
  const orders = await read()
  if (expected === null || orders.size >= expected) return { orders, reread: false, short: false, comparable: true }
  if (expected - orders.size > slack) return { orders, reread: false, short: true, comparable: false }
  mergeNewer(orders, (await read()).values())
  return { orders, reread: true, short: orders.size < expected, comparable: true }
}
