'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/core/db/client'
import { user } from '@/core/db/schema/auth'
import { auditLogs } from '@/core/db/schema/audit'
import { projectInvitations, projectMembers, projects, type ProjectRole } from '@/core/db/schema/projects'
import { assertCapability, getCurrentUser, requireUser } from '@/core/auth/session'
import { ASSIGNABLE_ROLES, isProjectRole, outranks } from '@/core/auth/rbac'
import { createId, createToken, slugify } from '@/core/utils/id'

export type ActionState = { ok: boolean; message?: string; data?: Record<string, unknown> }

const INVITE_TTL_DAYS = 7

function fail(message: string): ActionState {
  return { ok: false, message }
}

/* --------------------------------------------------------------- projects --- */

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
})

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const currentUser = await requireUser()

  const parsed = createProjectSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || undefined,
  })
  if (!parsed.success) return fail('validation')

  const id = createId('prj')
  // Slugs are globally unique, so a collision on a common name ("Shop") is
  // expected rather than exceptional — disambiguate with the id suffix.
  const base = slugify(parsed.data.name) || 'project'
  const slug = `${base}-${id.slice(-6)}`

  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id,
      slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      ownerId: currentUser.id,
    })
    await tx.insert(projectMembers).values({
      id: createId('pm'),
      projectId: id,
      userId: currentUser.id,
      role: 'owner',
    })
    await tx.insert(auditLogs).values({
      id: createId('aud'),
      projectId: id,
      actorId: currentUser.id,
      action: 'project.create',
      targetType: 'project',
      targetId: id,
      detail: { name: parsed.data.name },
    })
  })

  revalidatePath('/projects')
  redirect(`/projects/${id}`)
}

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().min(1).max(8),
})

export async function updateProject(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await assertCapability(projectId, 'project:update')
  } catch {
    return fail('forbidden')
  }

  const parsed = updateProjectSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    timezone: formData.get('timezone'),
    currency: formData.get('currency'),
  })
  if (!parsed.success) return fail('validation')

  await db
    .update(projects)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))

  revalidatePath(`/projects/${projectId}`, 'layout')
  return { ok: true }
}

export async function deleteProject(projectId: string): Promise<void> {
  await assertCapability(projectId, 'project:delete')
  // Every child table declares ON DELETE CASCADE, so this one statement
  // removes connections, logs, datasets and memberships with the project.
  await db.delete(projects).where(eq(projects.id, projectId))
  revalidatePath('/projects')
  redirect('/projects')
}

/* ---------------------------------------------------------------- members --- */

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.string().refine(isProjectRole),
})

export async function inviteMember(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'member:invite')
  } catch {
    return fail('forbidden')
  }

  const parsed = inviteSchema.safeParse({ email: formData.get('email'), role: formData.get('role') })
  if (!parsed.success) return fail('validation')

  const role = parsed.data.role as ProjectRole
  if (!ASSIGNABLE_ROLES.includes(role)) return fail('validation')
  // An admin must not be able to mint another admin above their own level.
  if (!outranks(ctx.role, role) && ctx.role !== 'owner') return fail('forbidden')

  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, parsed.data.email))
    .limit(1)

  if (existingUser) {
    const [existingMember] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, existingUser.id)))
      .limit(1)
    if (existingMember) return fail('alreadyMember')
  }

  const token = createToken(24)
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db.insert(projectInvitations).values({
    id: createId('inv'),
    projectId,
    email: parsed.data.email,
    role,
    token,
    invitedById: ctx.user.id,
    expiresAt,
  })

  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId,
    actorId: ctx.user.id,
    action: 'member.invite',
    targetType: 'invitation',
    detail: { email: parsed.data.email, role },
  })

  revalidatePath(`/projects/${projectId}/settings/members`)
  // No mail transport is configured, so the link is handed back to the
  // inviter to deliver. Wiring an email provider later only changes this line.
  return { ok: true, data: { token } }
}

export async function revokeInvitation(projectId: string, invitationId: string): Promise<ActionState> {
  try {
    await assertCapability(projectId, 'member:invite')
  } catch {
    return fail('forbidden')
  }

  await db
    .update(projectInvitations)
    .set({ status: 'revoked' })
    .where(and(eq(projectInvitations.id, invitationId), eq(projectInvitations.projectId, projectId)))

  revalidatePath(`/projects/${projectId}/settings/members`)
  return { ok: true }
}

export async function changeMemberRole(
  projectId: string,
  membershipId: string,
  nextRole: string,
): Promise<ActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'member:update-role')
  } catch {
    return fail('forbidden')
  }
  if (!isProjectRole(nextRole) || !ASSIGNABLE_ROLES.includes(nextRole)) return fail('validation')

  const [target] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.id, membershipId), eq(projectMembers.projectId, projectId)))
    .limit(1)

  if (!target) return fail('notFound')
  if (target.role === 'owner') return fail('cannotEditOwner')
  if (target.userId === ctx.user.id) return fail('forbidden')
  if (!outranks(ctx.role, target.role)) return fail('forbidden')

  await db.update(projectMembers).set({ role: nextRole }).where(eq(projectMembers.id, membershipId))

  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId,
    actorId: ctx.user.id,
    action: 'member.role-change',
    targetType: 'membership',
    targetId: membershipId,
    detail: { from: target.role, to: nextRole },
  })

  revalidatePath(`/projects/${projectId}/settings/members`)
  return { ok: true }
}

export async function removeMember(projectId: string, membershipId: string): Promise<ActionState> {
  let ctx
  try {
    ctx = await assertCapability(projectId, 'member:remove')
  } catch {
    return fail('forbidden')
  }

  const [target] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.id, membershipId), eq(projectMembers.projectId, projectId)))
    .limit(1)

  if (!target) return fail('notFound')
  // Removing the owner would orphan the project; ownership transfer is a
  // separate, deliberate operation.
  if (target.role === 'owner') return fail('cannotEditOwner')
  if (!outranks(ctx.role, target.role) && target.userId !== ctx.user.id) return fail('forbidden')

  await db.delete(projectMembers).where(eq(projectMembers.id, membershipId))

  await db.insert(auditLogs).values({
    id: createId('aud'),
    projectId,
    actorId: ctx.user.id,
    action: 'member.remove',
    targetType: 'membership',
    targetId: membershipId,
    detail: { userId: target.userId },
  })

  revalidatePath(`/projects/${projectId}/settings/members`)
  return { ok: true }
}

/* ------------------------------------------------------------ invitations --- */

export async function acceptInvitation(token: string): Promise<ActionState> {
  const currentUser = await getCurrentUser()
  if (!currentUser) return fail('unauthenticated')

  const [invitation] = await db
    .select()
    .from(projectInvitations)
    .where(eq(projectInvitations.token, token))
    .limit(1)

  if (!invitation || invitation.status !== 'pending') return fail('inviteInvalid')
  if (invitation.expiresAt.getTime() < Date.now()) {
    await db
      .update(projectInvitations)
      .set({ status: 'expired' })
      .where(eq(projectInvitations.id, invitation.id))
    return fail('inviteInvalid')
  }
  // The invitation names an address; accepting from a different account would
  // let a forwarded link grant access to the wrong person.
  if (invitation.email.toLowerCase() !== currentUser.email.toLowerCase()) {
    return fail('inviteWrongEmail')
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(projectMembers)
      .values({
        id: createId('pm'),
        projectId: invitation.projectId,
        userId: currentUser.id,
        role: invitation.role,
        invitedById: invitation.invitedById,
      })
      .onConflictDoNothing()

    await tx
      .update(projectInvitations)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(projectInvitations.id, invitation.id))

    await tx.insert(auditLogs).values({
      id: createId('aud'),
      projectId: invitation.projectId,
      actorId: currentUser.id,
      action: 'member.join',
      targetType: 'project',
      targetId: invitation.projectId,
      detail: { role: invitation.role },
    })
  })

  revalidatePath('/projects')
  return { ok: true, data: { projectId: invitation.projectId } }
}

export async function getInvitationPreview(token: string) {
  const [row] = await db
    .select({
      id: projectInvitations.id,
      email: projectInvitations.email,
      role: projectInvitations.role,
      status: projectInvitations.status,
      expiresAt: projectInvitations.expiresAt,
      projectId: projects.id,
      projectName: projects.name,
      inviterName: user.name,
    })
    .from(projectInvitations)
    .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
    .leftJoin(user, eq(user.id, projectInvitations.invitedById))
    .where(eq(projectInvitations.token, token))
    .limit(1)

  if (!row) return null
  const valid = row.status === 'pending' && row.expiresAt.getTime() > Date.now()
  return { ...row, valid }
}

/** Used by the overview screen; kept here so the count logic has one home. */
export async function countProjects(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
  return row?.n ?? 0
}
