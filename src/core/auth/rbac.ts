import type { ProjectRole } from '@/core/db/schema/projects'

/**
 * Project-scoped authorisation.
 *
 * Roles are ranked, and every capability declares the lowest rank that holds
 * it. A ranked model beats a permission-per-role matrix here because the roles
 * are genuinely nested — an admin can do everything an editor can — so adding
 * a capability means one line, not four.
 */
export const ROLE_RANK: Record<ProjectRole, number> = {
  owner: 40,
  admin: 30,
  editor: 20,
  viewer: 10,
}

export const PROJECT_ROLES: ProjectRole[] = ['owner', 'admin', 'editor', 'viewer']

/** Roles that may be handed out via the members screen. `owner` transfers separately. */
export const ASSIGNABLE_ROLES: ProjectRole[] = ['admin', 'editor', 'viewer']

export type Capability =
  | 'project:view'
  | 'project:update'
  | 'project:delete'
  | 'member:view'
  | 'member:invite'
  | 'member:update-role'
  | 'member:remove'
  | 'connection:view'
  | 'connection:create'
  | 'connection:update'
  | 'connection:delete'
  | 'connection:reveal-secret'
  | 'hub:read'
  | 'hub:execute'
  | 'hub:custom'
  | 'hub:custom-write'
  | 'dataset:read'
  | 'dataset:sync'
  | 'dataset:delete'

const REQUIRED_RANK: Record<Capability, number> = {
  'project:view': ROLE_RANK.viewer,
  'project:update': ROLE_RANK.admin,
  'project:delete': ROLE_RANK.owner,

  'member:view': ROLE_RANK.viewer,
  'member:invite': ROLE_RANK.admin,
  'member:update-role': ROLE_RANK.admin,
  'member:remove': ROLE_RANK.admin,

  'connection:view': ROLE_RANK.viewer,
  'connection:create': ROLE_RANK.admin,
  'connection:update': ROLE_RANK.admin,
  'connection:delete': ROLE_RANK.admin,
  // Even an owner only ever sees a masked credential in the UI; this gates the
  // server-side decrypt path used when a request is actually sent.
  'connection:reveal-secret': ROLE_RANK.owner,

  'hub:read': ROLE_RANK.viewer,
  // Executing a request spends provider quota and can mutate remote state,
  // so viewers can inspect the catalogue but not fire it.
  'hub:execute': ROLE_RANK.editor,

  /*
   * An ad-hoc path reaches anything the provider exposes, including endpoints
   * the reviewed catalogue deliberately leaves out. Reading that way is an
   * editor's job; writing that way is not, because nobody has vetted what the
   * path does — so a non-GET ad-hoc call needs the same standing as changing
   * the connection itself.
   */
  'hub:custom': ROLE_RANK.editor,
  'hub:custom-write': ROLE_RANK.admin,

  'dataset:read': ROLE_RANK.viewer,
  'dataset:sync': ROLE_RANK.editor,
  'dataset:delete': ROLE_RANK.admin,
}

export function can(role: ProjectRole | null | undefined, capability: Capability): boolean {
  if (!role) return false
  return ROLE_RANK[role] >= REQUIRED_RANK[capability]
}

/** True when `actor` outranks `target`, e.g. an admin may not demote an owner. */
export function outranks(actor: ProjectRole, target: ProjectRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target]
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && value in ROLE_RANK
}
