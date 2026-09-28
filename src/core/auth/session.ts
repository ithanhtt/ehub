import 'server-only'

import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { auth } from './auth'
import { can, type Capability } from './rbac'
import { db } from '@/core/db/client'
import { projectMembers, projects, type ProjectRole } from '@/core/db/schema/projects'
import { closedFor } from '@/modules/site-settings/data/settings'

export type CurrentUser = {
  id: string
  name: string
  email: string
  image?: string | null
  role: 'admin' | 'user'
}

/**
 * `cache()` dedupes the session lookup per request, so a page, its layout and
 * three server actions in the same render all share one cookie verification
 * instead of hitting the database four times.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const result = await auth.api.getSession({ headers: await headers() })
  if (!result?.user) return null
  const u = result.user as CurrentUser & { role?: string | null }
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    role: u.role === 'admin' ? 'admin' : 'user',
  }
})

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

/** A page only a platform Administrator may open; everyone else is sent back to their projects. */
export async function requireSystemAdmin(): Promise<CurrentUser> {
  const user = await requireUser()
  if (user.role !== 'admin') redirect('/projects')
  return user
}

/** Server-action and route variant: throws instead of redirecting. */
export async function assertSystemAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('FORBIDDEN')
  return user
}

export type ProjectContext = {
  project: typeof projects.$inferSelect
  role: ProjectRole
  user: CurrentUser
}

/**
 * Resolves a project *through the membership table*, so an unauthorised
 * project id is indistinguishable from a missing one — no existence oracle.
 *
 * While the app is closed for maintenance, no project opens for anyone but a
 * platform Administrator: every page, action and route that goes through here
 * (all of a project's) is refused, whatever the user's role in it.
 */
export const getProjectContext = cache(async (projectId: string): Promise<ProjectContext | null> => {
  const user = await getCurrentUser()
  if (!user) return null
  if (await closedFor(user)) return null

  const [row] = await db
    .select({ project: projects, role: projectMembers.role })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.id, projectId), eq(projectMembers.userId, user.id)))
    .limit(1)

  if (!row) return null
  return { project: row.project, role: row.role, user }
})

export async function requireProject(projectId: string): Promise<ProjectContext> {
  const ctx = await getProjectContext(projectId)
  if (!ctx) redirect('/projects')
  return ctx
}

export async function requireCapability(projectId: string, capability: Capability): Promise<ProjectContext> {
  const ctx = await requireProject(projectId)
  if (!can(ctx.role, capability)) redirect(`/projects/${projectId}`)
  return ctx
}

/** Server-action variant: throws instead of redirecting so the caller can return a form error. */
export async function assertCapability(projectId: string, capability: Capability): Promise<ProjectContext> {
  const ctx = await getProjectContext(projectId)
  if (!ctx) throw new Error('FORBIDDEN')
  if (!can(ctx.role, capability)) throw new Error('FORBIDDEN')
  return ctx
}
