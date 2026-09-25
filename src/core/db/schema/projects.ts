import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'

/** Role a member holds inside one project. Ordered from most to least power. */
export type ProjectRole = 'owner' | 'admin' | 'editor' | 'booker' | 'viewer'

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    /** Denormalised for cheap "my projects" queries; authoritative role lives in projectMembers. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
    currency: text('currency').notNull().default('VND'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('projects_owner_idx').on(t.ownerId)],
)

export const projectMembers = pgTable(
  'project_members',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<ProjectRole>().notNull().default('viewer'),
    invitedById: text('invited_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_members_unique').on(t.projectId, t.userId),
    index('project_members_user_idx').on(t.userId),
  ],
)

export const projectInvitations = pgTable(
  'project_invitations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<ProjectRole>().notNull().default('viewer'),
    token: text('token').notNull().unique(),
    status: text('status').$type<'pending' | 'accepted' | 'revoked' | 'expired'>().notNull().default('pending'),
    invitedById: text('invited_by_id').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_invitations_project_idx').on(t.projectId),
    index('project_invitations_email_idx').on(t.email),
  ],
)
