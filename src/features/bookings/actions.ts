'use server'

import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { bookingCampaigns, bookings, type BookingResultSource } from '@/core/db/schema/bookings'
import { assertCapability } from '@/core/auth/session'
import { createId } from '@/core/utils/id'
import { campaignKey, normalizeCampaign, type CampaignDraft, type CampaignIssue } from '@/modules/bookings/campaigns'
import { kocOfVideoUrl, videoKey } from '@/modules/analytics/shared/keys'
import { vnDate } from '@/modules/analytics/period'
import { bookingCode, codeNumber, normalizeBooking, parseTier, postedOnOfVideo, withCampaignDefaults, type BookingInput, type BookingIssue, type RawBooking } from '@/modules/bookings/fields'
import { isCodeTaken, lastCodeNumberOf, lastCodeNumberQuery } from './result-writes'
import { resultSyncState, startResultSync, type SyncState, syncResultsInBackground } from './sync'

/**
 * Keeping the booking data: bookings one at a time from the form, many at
 * once from an imported file or a pasted list, and the campaigns they are
 * grouped in.
 *
 * Every write re-runs the standard (`normalizeBooking`, `normalizeCampaign`)
 * on what the browser sent, so what the page shows is what the database
 * holds. Writes need `booking:edit` (bookers and up); each is recorded in the
 * audit trail.
 */

export type BookingActionState = {
  ok: boolean
  message?: 'forbidden' | 'validation' | 'notFound' | 'tooMany' | 'invalidVideo' | 'kocMismatch'
  issues?: BookingIssue[]
  /** With `kocMismatch`: the KOC the video link names. */
  videoKoc?: string
}

export type CampaignActionState = {
  ok: boolean
  message?: 'forbidden' | 'validation' | 'notFound'
  issues?: CampaignIssue[]
  campaignId?: string
}

export type ImportResult = {
  ok: boolean
  message?: BookingActionState['message']
  inserted: number
  updated: number
  /** Same as a row already there (or earlier in this import): left alone. */
  duplicates: number
  /** Rows that did not meet the standard, by their index in the batch sent. */
  invalid: Array<{ index: number; issues: BookingIssue[] }>
  /** Campaigns named in the rows that did not exist yet, and were created. */
  campaignsCreated: number
}

/** One import call; the page sends bigger files in batches of this size. */
const MAX_IMPORT_ROWS = 1000
const MAX_DELETE = 5000

// The booking data lives under Booking & KOC (booking-koc/data); its layout covers the report beside it too.
const changed = (projectId: string) => revalidatePath(`/projects/${projectId}/booking-koc`, 'layout')

async function editor(projectId: string) {
  try {
    return await assertCapability(projectId, 'booking:edit')
  } catch {
    return null
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Hands out the project's next booking codes (BK-0001, …) within one write:
 * numbered on from the highest the project holds, read inside the write's
 * transaction. Two writes racing for the same number is left to the unique
 * index — the loser is run once more (`withCodeRetry`) and reads the number
 * the winner took.
 */
async function codeCounter(tx: Tx, projectId: string) {
  let last = lastCodeNumberOf((await tx.execute(lastCodeNumberQuery(projectId))).rows as Array<{ n: string | number | null }>)
  return {
    next: () => bookingCode(++last),
    /** A code a row brought itself: numbering goes on after it when it is one of ours. */
    claim(code: string) {
      last = Math.max(last, codeNumber(code) ?? 0)
    },
  }
}

async function withCodeRetry<T>(write: () => Promise<T>): Promise<T> {
  // A few times: two large imports at once can clash more than once before one is through.
  for (let attempt = 1; ; attempt++) {
    try {
      return await write()
    } catch (error) {
      if (!isCodeTaken(error) || attempt >= 4) throw error
    }
  }
}

/** What is stored of a booking's results, to decide what a save does to them. */
type StoredResults = { resultSource: BookingResultSource | null; videoId: string | null; airedOn: string | null }

/**
 * A booking's result columns after a save.
 *
 * Figures typed are the booker's own ('manual') — the sync never overwrites
 * them. From the form, none typed hands a manual booking back to the sync (the
 * form shows the synced figures beside empty fields, so an empty field means
 * "TikTok's"). From a file (`fromFile`), figures only count where TikTok's are
 * not already there — an exported file carries the synced figures, and
 * importing it back must not freeze them as typed — and none typed changes
 * nothing. A new video, or a new air date, has the sync read it again.
 */
function resultColumnsOf(value: BookingInput, stored: StoredResults | null, fromFile: boolean) {
  const typed = value.resultOrders !== null || value.resultRevenue !== null
  const out: Partial<typeof bookings.$inferInsert> = {}
  const cleared = { resultOrders: null, resultRevenue: null, resultSource: null, resultSyncedAt: null, resultNote: null }
  if (typed && !(fromFile && stored?.resultSource === 'tiktok')) {
    return { resultOrders: value.resultOrders, resultRevenue: value.resultRevenue, resultSource: 'manual' as const, resultSyncedAt: null, resultNote: null }
  }
  if (!typed && !fromFile && stored?.resultSource === 'manual') return cleared
  if (stored && stored.resultSource !== 'manual') {
    if (stored.videoId !== value.videoId) return cleared
    if (stored.airedOn !== value.airedOn) out.resultSyncedAt = null
  }
  return out
}

/**
 * Records a change. Always called once a transaction has finished, never
 * inside one: the embedded database has a single connection, so a write on
 * `db` while a transaction holds it waits for that transaction — which waits
 * for the write. Saving hung exactly that way.
 */
async function audit(projectId: string, actorId: string, action: string, detail: Record<string, unknown>, targetId?: string, targetType = 'booking') {
  await db.insert(auditLogs).values({ id: createId('aud'), projectId, actorId, action, targetType, targetId: targetId ?? null, detail })
}

/**
 * The project's campaigns by name, and a way to the id of one a row names —
 * created when it does not exist yet (starting on that row's booking date),
 * so a file that names its campaigns brings them in with it.
 */
async function campaignDirectory(tx: Tx | typeof db, projectId: string, actorId: string) {
  const rows = await tx.select().from(bookingCampaigns).where(eq(bookingCampaigns.projectId, projectId))
  const byKey = new Map(rows.map((row) => [campaignKey(row.name), row]))
  let created = 0
  return {
    defaultsOf: (name: unknown) => byKey.get(campaignKey(name)) ?? null,
    async idOf(name: string | null, startOn: string): Promise<string | null> {
      if (!name) return null
      const known = byKey.get(campaignKey(name))
      if (known) return known.id
      const row = { id: createId('bc'), projectId, name, startOn, product: null, defaultCost: null, endOn: null, budget: null, targetVideos: null, status: 'active' as const, note: null, createdById: actorId, createdAt: new Date(), updatedAt: new Date() }
      await tx.insert(bookingCampaigns).values(row)
      byKey.set(campaignKey(name), row)
      created += 1
      return row.id
    },
    get created() {
      return created
    },
  }
}

/** A clean booking as its columns: the campaign's name becomes its id; its code and results are set apart (codeCounter, resultColumnsOf). */
const columnsOf = ({ campaign: _campaign, code: _code, resultOrders: _orders, resultRevenue: _revenue, ...value }: BookingInput, campaignId: string | null) => ({ ...value, campaignId })

/** Creates a booking (`id` null) or rewrites one. `raw.campaign` names its campaign. */
export async function saveBooking(projectId: string, id: string | null, raw: RawBooking): Promise<BookingActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }

  const creating = !id
  const outcome = await withCodeRetry(() => db.transaction(async (tx): Promise<BookingActionState & { saved?: { id: string; koc: string } }> => {
    const campaigns = await campaignDirectory(tx, projectId, ctx.user.id)
    const { value, issues } = normalizeBooking(withCampaignDefaults(raw, campaigns.defaultsOf(raw.campaign)))
    if (!value) return { ok: false, message: 'validation', issues }
    const campaignId = await campaigns.idOf(value.campaign, value.bookedOn)

    if (id) {
      const [stored] = await tx
        .select({ resultSource: bookings.resultSource, videoId: bookings.videoId, airedOn: bookings.airedOn })
        .from(bookings)
        .where(and(eq(bookings.id, id), eq(bookings.projectId, projectId)))
      if (!stored) return { ok: false, message: 'notFound' }
      await tx
        .update(bookings)
        .set({ ...columnsOf(value, campaignId), ...resultColumnsOf(value, stored, false), updatedById: ctx.user.id, updatedAt: new Date() })
        .where(and(eq(bookings.id, id), eq(bookings.projectId, projectId)))
      return { ok: true, saved: { id, koc: value.kocHandle } }
    }
    const newId = createId('bk')
    const codes = await codeCounter(tx, projectId)
    const [taken] = value.code ? await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.projectId, projectId), eq(bookings.code, value.code))) : []
    const code = value.code && !taken ? value.code : codes.next()
    await tx.insert(bookings).values({ id: newId, projectId, code, ...columnsOf(value, campaignId), ...resultColumnsOf(value, null, false), createdById: ctx.user.id, updatedById: ctx.user.id })
    return { ok: true, saved: { id: newId, koc: value.kocHandle } }
  }))

  const { saved, ...state } = outcome
  if (saved) {
    await audit(projectId, ctx.user.id, creating ? 'booking.create' : 'booking.update', { koc: saved.koc }, saved.id)
    changed(projectId)
  }
  return state
}

/**
 * A KOC's own details — name, contact and size class (tier) — kept the same on
 * every booking of theirs, so correcting them once corrects the whole list.
 * A tier left out (`undefined`) is not touched.
 */
export async function updateKoc(projectId: string, handle: string, details: { name: string; contact: string; tier?: string }): Promise<BookingActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }
  const name = details.name.trim()
  const contact = details.contact.trim()
  if (name.length > 500 || contact.length > 500 || (details.tier?.length ?? 0) > 500) return { ok: false, message: 'validation' }
  const tier = details.tier === undefined ? {} : { kocTier: parseTier(details.tier) }

  const updated = await db
    .update(bookings)
    .set({ kocName: name || null, kocContact: contact || null, ...tier, updatedById: ctx.user.id, updatedAt: new Date() })
    .where(and(eq(bookings.projectId, projectId), eq(bookings.kocHandle, handle)))
    .returning({ id: bookings.id })
  if (updated.length === 0) return { ok: false, message: 'notFound' }
  await audit(projectId, ctx.user.id, 'koc.update', { koc: handle, bookings: updated.length })
  changed(projectId)
  return { ok: true }
}

export async function deleteBookings(projectId: string, ids: string[]): Promise<BookingActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }
  if (ids.length === 0) return { ok: true }
  if (ids.length > MAX_DELETE) return { ok: false, message: 'tooMany' }

  const removed = await db
    .delete(bookings)
    .where(and(eq(bookings.projectId, projectId), inArray(bookings.id, ids)))
    .returning({ id: bookings.id })
  await audit(projectId, ctx.user.id, 'booking.delete', { count: removed.length })
  changed(projectId)
  return { ok: true }
}

/**
 * The video a booked KOC posted: the booking becomes aired, on the day the
 * video was posted (read from its id) unless an air date is already there.
 * A link naming another KOC is refused rather than pinned on the wrong one.
 */
export async function attachVideo(projectId: string, id: string, videoUrl: string): Promise<BookingActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }

  const url = videoUrl.trim()
  const videoId = videoKey(url)
  if (!/^\d{10,}$/.test(videoId)) return { ok: false, message: 'invalidVideo' }

  const [row] = await db
    .select({ kocHandle: bookings.kocHandle, airedOn: bookings.airedOn, bookedOn: bookings.bookedOn, videoId: bookings.videoId, resultSource: bookings.resultSource })
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.projectId, projectId)))
  if (!row) return { ok: false, message: 'notFound' }
  const named = kocOfVideoUrl(url)
  if (named && named !== row.kocHandle) return { ok: false, message: 'kocMismatch', videoKoc: named }

  const airedOn = row.airedOn ?? postedOnOfVideo(videoId) ?? vnDate(new Date())
  // Another video's figures are not this one's: the sync reads the new one (typed figures stay).
  const results = row.resultSource !== 'manual' && row.videoId !== videoId ? { resultOrders: null, resultRevenue: null, resultSource: null, resultSyncedAt: null, resultNote: null } : {}
  await db
    .update(bookings)
    .set({ videoUrl: url, videoId, airedOn, status: 'aired', ...results, updatedById: ctx.user.id, updatedAt: new Date() })
    .where(eq(bookings.id, id))
  await audit(projectId, ctx.user.id, 'booking.video', { videoId }, id)
  changed(projectId)
  return { ok: true }
}

/** Cancels bookings (they stop counting), or brings them back: aired if they have an air date, else pending. */
export async function setCancelled(projectId: string, ids: string[], cancelled: boolean): Promise<BookingActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }
  if (ids.length > MAX_DELETE) return { ok: false, message: 'tooMany' }
  const scope = and(eq(bookings.projectId, projectId), inArray(bookings.id, ids))
  const touch = { updatedById: ctx.user.id, updatedAt: new Date() }
  if (cancelled) {
    await db.update(bookings).set({ status: 'cancelled', ...touch }).where(and(scope, ne(bookings.status, 'cancelled')))
  } else {
    await db.update(bookings).set({ status: 'aired', ...touch }).where(and(scope, eq(bookings.status, 'cancelled'), isNotNull(bookings.airedOn)))
    await db.update(bookings).set({ status: 'pending', ...touch }).where(and(scope, eq(bookings.status, 'cancelled'), isNull(bookings.airedOn)))
  }
  await audit(projectId, ctx.user.id, cancelled ? 'booking.cancel' : 'booking.restore', { count: ids.length })
  changed(projectId)
  return { ok: true }
}

/** Moves bookings into a campaign, or out of any (`campaignId` null). */
export async function moveBookings(projectId: string, ids: string[], campaignId: string | null): Promise<BookingActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }
  if (ids.length > MAX_DELETE) return { ok: false, message: 'tooMany' }
  if (campaignId) {
    const [campaign] = await db
      .select({ id: bookingCampaigns.id })
      .from(bookingCampaigns)
      .where(and(eq(bookingCampaigns.id, campaignId), eq(bookingCampaigns.projectId, projectId)))
    if (!campaign) return { ok: false, message: 'notFound' }
  }
  await db
    .update(bookings)
    .set({ campaignId, updatedById: ctx.user.id, updatedAt: new Date() })
    .where(and(eq(bookings.projectId, projectId), inArray(bookings.id, ids)))
  await audit(projectId, ctx.user.id, 'booking.move', { count: ids.length }, campaignId ?? undefined)
  changed(projectId)
  return { ok: true }
}

/**
 * Hands bookings whose figures a booker typed back to the sync: their figures
 * are cleared and read from TikTok Shop again, starting at once.
 */
export async function resumeSyncedResults(projectId: string, ids: string[]): Promise<BookingActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }
  if (ids.length > MAX_DELETE) return { ok: false, message: 'tooMany' }
  const reset = await db
    .update(bookings)
    .set({ resultOrders: null, resultRevenue: null, resultSource: null, resultSyncedAt: null, resultNote: null, updatedById: ctx.user.id, updatedAt: new Date() })
    .where(and(eq(bookings.projectId, projectId), inArray(bookings.id, ids), eq(bookings.resultSource, 'manual')))
    .returning({ id: bookings.id })
  await audit(projectId, ctx.user.id, 'booking.results.reset', { count: reset.length })
  void startResultSync(projectId)
  changed(projectId)
  return { ok: true }
}

/** "Đồng bộ kết quả": starts reading the bookings' orders and revenue from TikTok Shop now (see sync.ts); the page follows it with `resultsSyncStatus`. */
export async function syncResults(projectId: string): Promise<BookingActionState & { sync?: SyncState }> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }
  void startResultSync(projectId, true)
  await audit(projectId, ctx.user.id, 'booking.results.sync', {})
  return { ok: true, sync: resultSyncState(projectId) }
}

/**
 * For the open page, every few minutes and when its tab comes back into view:
 * the project's sync when one is due (the same light check the server's own
 * loop makes), and where it stands. Anyone who reads the file may ask — it
 * only ever reads what is due, and joins a sync already running.
 */
export async function syncResultsWhenDue(projectId: string): Promise<SyncState | null> {
  try {
    await assertCapability(projectId, 'booking:view')
  } catch {
    return null
  }
  await syncResultsInBackground(projectId).catch(() => {})
  return resultSyncState(projectId)
}

/** Where the project's results sync stands — for the page to show "Đang đồng bộ…" and refresh once it is done. Anyone who reads the file may ask. */
export async function resultsSyncStatus(projectId: string): Promise<SyncState | null> {
  try {
    await assertCapability(projectId, 'booking:view')
  } catch {
    return null
  }
  return resultSyncState(projectId)
}

/** What makes two bookings the same one, for rows without a video to go by. */
const sameBooking = (b: Pick<BookingInput, 'kocHandle' | 'bookedOn' | 'product' | 'cost'>) =>
  `${b.kocHandle}|${b.bookedOn}|${b.product ?? ''}|${b.cost}`

/**
 * Adds a batch of rows from an imported file or a pasted list.
 *
 * A row names its campaign, or takes `campaign` (a name) when it does not;
 * the campaign's product and default fee fill the row's blanks, and a
 * campaign named that does not exist yet is created. A row whose video is
 * already there updates that booking — so a file exported from here, edited
 * and imported again, updates rather than doubles. A row without a video that
 * matches an existing booking field for field (KOC, booking date, product,
 * fee) is a duplicate and is left alone. Rows that do not meet the standard
 * are returned with their reasons; the valid ones are still saved.
 */
export async function importBookings(projectId: string, rows: RawBooking[], campaign: string | null = null): Promise<ImportResult> {
  const empty = { inserted: 0, updated: 0, duplicates: 0, invalid: [], campaignsCreated: 0 }
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden', ...empty }
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, message: 'tooMany', ...empty }

  const result = await withCodeRetry(() => db.transaction(async (tx) => {
    const campaigns = await campaignDirectory(tx, projectId, ctx.user.id)
    const invalid: ImportResult['invalid'] = []
    const valid: BookingInput[] = []
    rows.forEach((row, index) => {
      const raw = String(row.campaign ?? '').trim() || !campaign ? row : { ...row, campaign }
      const { value, issues } = normalizeBooking(withCampaignDefaults(raw, campaigns.defaultsOf(raw.campaign)))
      if (value) valid.push(value)
      else invalid.push({ index, issues })
    })

    const existing = await tx
      .select({
        id: bookings.id,
        code: bookings.code,
        videoId: bookings.videoId,
        kocHandle: bookings.kocHandle,
        bookedOn: bookings.bookedOn,
        airedOn: bookings.airedOn,
        product: bookings.product,
        cost: bookings.cost,
        resultSource: bookings.resultSource,
      })
      .from(bookings)
      .where(eq(bookings.projectId, projectId))
    type Known = (typeof existing)[number]
    const byVideo = new Map<string, Known>(existing.filter((row) => row.videoId).map((row) => [row.videoId!, row]))
    const byCode = new Map<string, Known>(existing.map((row) => [row.code, row]))
    const known = new Set(existing.filter((row) => !row.videoId).map(sameBooking))
    const codes = await codeCounter(tx, projectId)

    let inserted = 0
    let updated = 0
    let duplicates = 0
    const now = new Date()
    for (const value of valid) {
      // A row naming a booking by its code (of the same KOC) updates it — an exported file edited and imported back;
      // else a row with the video of one updates that one.
      const byOwnCode = value.code ? byCode.get(value.code) : undefined
      const match = (byOwnCode && byOwnCode.kocHandle === value.kocHandle ? byOwnCode : undefined) ?? (value.videoId ? byVideo.get(value.videoId) : undefined)
      if (!match && !value.videoId) {
        if (known.has(sameBooking(value))) {
          duplicates += 1
          continue
        }
        known.add(sameBooking(value))
      }
      const columns = columnsOf(value, await campaigns.idOf(value.campaign, value.bookedOn))
      if (match) {
        await tx
          .update(bookings)
          .set({ ...columns, ...resultColumnsOf(value, match, true), updatedById: ctx.user.id, updatedAt: now })
          .where(eq(bookings.id, match.id))
        if (value.videoId) byVideo.set(value.videoId, { ...match, videoId: value.videoId })
        updated += 1
        continue
      }
      const id = createId('bk')
      // A code the row brings is kept when no booking has it yet; else it gets the next one.
      const code = value.code && !byCode.has(value.code) ? value.code : codes.next()
      codes.claim(code)
      const row = { id, projectId, code, ...columns, ...resultColumnsOf(value, null, true), createdById: ctx.user.id, updatedById: ctx.user.id }
      await tx.insert(bookings).values(row)
      const stored: Known = { id, code, videoId: value.videoId, kocHandle: value.kocHandle, bookedOn: value.bookedOn, airedOn: value.airedOn, product: value.product, cost: value.cost, resultSource: row.resultSource ?? null }
      byCode.set(code, stored)
      if (value.videoId) byVideo.set(value.videoId, stored)
      inserted += 1
    }
    return { inserted, updated, duplicates, invalid, campaignsCreated: campaigns.created }
  }))

  if (result.inserted + result.updated > 0) {
    await audit(projectId, ctx.user.id, 'booking.import', { ...result, invalid: result.invalid.length })
    changed(projectId)
  }
  return { ok: true, ...result }
}

/* ------------------------------------------------------------ campaigns --- */

/** Creates a campaign (`id` null) or rewrites one. */
export async function saveCampaign(projectId: string, id: string | null, draft: Partial<CampaignDraft>): Promise<CampaignActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }

  const { value, issues } = normalizeCampaign(draft)
  if (!value) return { ok: false, message: 'validation', issues }

  const others = await db.select({ id: bookingCampaigns.id, name: bookingCampaigns.name }).from(bookingCampaigns).where(eq(bookingCampaigns.projectId, projectId))
  if (others.some((other) => other.id !== id && campaignKey(other.name) === campaignKey(value.name))) {
    return { ok: false, message: 'validation', issues: [{ field: 'name', code: 'duplicateName' }] }
  }

  if (id) {
    const updated = await db
      .update(bookingCampaigns)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(bookingCampaigns.id, id), eq(bookingCampaigns.projectId, projectId)))
      .returning({ id: bookingCampaigns.id })
    if (updated.length === 0) return { ok: false, message: 'notFound' }
  } else {
    id = createId('bc')
    await db.insert(bookingCampaigns).values({ id, projectId, ...value, createdById: ctx.user.id })
  }
  await audit(projectId, ctx.user.id, 'campaign.save', { name: value.name }, id, 'booking_campaign')
  changed(projectId)
  return { ok: true, campaignId: id }
}

/** Deletes a campaign; its bookings stay, outside any campaign. */
export async function deleteCampaign(projectId: string, id: string): Promise<CampaignActionState> {
  const ctx = await editor(projectId)
  if (!ctx) return { ok: false, message: 'forbidden' }
  const removed = await db
    .delete(bookingCampaigns)
    .where(and(eq(bookingCampaigns.id, id), eq(bookingCampaigns.projectId, projectId)))
    .returning({ name: bookingCampaigns.name })
  if (removed.length === 0) return { ok: false, message: 'notFound' }
  await audit(projectId, ctx.user.id, 'campaign.delete', { name: removed[0].name }, id, 'booking_campaign')
  changed(projectId)
  return { ok: true }
}
