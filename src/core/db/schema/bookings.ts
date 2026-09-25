import { bigint, date, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { projects } from './projects'

/** Where a booking stands: booked and waiting to air, aired, or called off (not counted). */
export type BookingStatus = 'pending' | 'aired' | 'cancelled'

/** Where a booking's results (orders, revenue) came from: read from TikTok Shop, or typed by a booker. */
export type BookingResultSource = 'tiktok' | 'manual'

/**
 * Why the last sync left a booking's results as they are: it has no video to
 * look up, TikTok's list did not reach the video (its revenue was read on its
 * own, its orders are unknown), the app may not read video analytics, or the
 * read failed.
 */
export type BookingResultNote = 'no_video' | 'not_found' | 'no_scope' | 'error'

export type CampaignStatus = 'active' | 'ended'

/**
 * A booking campaign: a push the team books KOCs for — a product launch, a
 * sale day, a month's seeding. It groups bookings, and carries what the
 * bookers fill in the same way for each of them (the product, the fee most
 * KOCs get), plus the targets to track the bookings against.
 */
export const bookingCampaigns = pgTable(
  'booking_campaigns',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Filled into each booking added to the campaign; a booking may still name another. */
    product: text('product'),
    defaultCost: bigint('default_cost', { mode: 'number' }),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    endOn: date('end_on', { mode: 'string' }),
    budget: bigint('budget', { mode: 'number' }),
    targetVideos: integer('target_videos'),
    status: text('status').$type<CampaignStatus>().notNull().default('active'),
    note: text('note'),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('booking_campaigns_name_unique').on(t.projectId, t.name)],
)

/**
 * The project's KOC booking file, kept in the app.
 *
 * One row per booked video. The fields are the ones the reports join on
 * (src/modules/bookings/fields.ts describes and normalises each): the KOC's
 * handle, the day it aired, the video and the product it sells, and the fee.
 * Keys are stored already normalised (`koc_handle`, `video_id`) beside what
 * the booker typed (`video_url`), so a report never re-parses a link.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * The booking's short code within the project — "BK-0001", numbered in the
     * order bookings were added — for the team to name a booking by in a chat
     * or a sheet. An imported row may bring a code of its own.
     */
    code: text('code').notNull(),
    /** The campaign it was booked for; a deleted campaign leaves its bookings in place. */
    campaignId: text('campaign_id').references(() => bookingCampaigns.id, { onDelete: 'set null' }),
    /** TikTok handle, bare and lower-case (see analytics/shared/keys.ts). */
    kocHandle: text('koc_handle').notNull(),
    kocName: text('koc_name'),
    /** Phone, Zalo, email — whatever the booker reaches the KOC by. */
    kocContact: text('koc_contact'),
    /** The KOC's size class — Nano, Micro, Mid, Macro, Mega (see fields.ts), or the team's own word. Describes the KOC, so kept the same on all their bookings. */
    kocTier: text('koc_tier'),
    bookedOn: date('booked_on', { mode: 'string' }).notNull(),
    /** The day the KOC agreed to post; a booking past it and not aired is overdue. */
    plannedAirOn: date('planned_air_on', { mode: 'string' }),
    airedOn: date('aired_on', { mode: 'string' }),
    /** The video's link as entered, and its id read from it. */
    videoUrl: text('video_url'),
    videoId: text('video_id'),
    /** TikTok product id, or a seller SKU matched through orders. */
    product: text('product'),
    cost: bigint('cost', { mode: 'number' }).notNull().default(0),
    status: text('status').$type<BookingStatus>().notNull().default('pending'),
    note: text('note'),
    /**
     * What the video brought in since it aired: TikTok Shop's orders (SKU
     * orders) and GMV for it, synced by features/bookings/sync.ts — or typed
     * by a booker (`result_source` 'manual'), which a sync never overwrites.
     */
    resultOrders: integer('result_orders'),
    resultRevenue: bigint('result_revenue', { mode: 'number' }),
    resultSource: text('result_source').$type<BookingResultSource>(),
    resultSyncedAt: timestamp('result_synced_at', { withTimezone: true }),
    resultNote: text('result_note').$type<BookingResultNote>(),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    updatedById: text('updated_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bookings_project_aired_idx').on(t.projectId, t.airedOn),
    index('bookings_project_koc_idx').on(t.projectId, t.kocHandle),
    index('bookings_project_video_idx').on(t.projectId, t.videoId),
    index('bookings_campaign_idx').on(t.campaignId),
    uniqueIndex('bookings_project_code_unique').on(t.projectId, t.code),
  ],
)
