import 'server-only'

import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { user } from '@/core/db/schema/auth'
import { apiCallLogs, connections } from '@/core/db/schema/connections'
import { datasets } from '@/core/db/schema/datasets'
import { projectInvitations, projectMembers, projects, type ProjectRole } from '@/core/db/schema/projects'

export type ProjectListItem = {
  id: string
  slug: string
  name: string
  description: string | null
  role: ProjectRole
  memberCount: number
  connectionCount: number
  updatedAt: Date
}

export async function listProjectsForUser(userId: string): Promise<ProjectListItem[]> {
  const rows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      description: projects.description,
      role: projectMembers.role,
      updatedAt: projects.updatedAt,
      // Correlated subqueries keep this to a single round trip. At project
      // counts measured in dozens that is cheaper than a pair of group-bys.
      memberCount: sql<number>`(select count(*)::int from ${projectMembers} pm where pm.project_id = ${projects.id})`,
      connectionCount: sql<number>`(select count(*)::int from ${connections} c where c.project_id = ${projects.id})`,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projectMembers.userId, userId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.updatedAt))

  return rows
}

export type ProjectMemberRow = {
  membershipId: string
  userId: string
  name: string
  email: string
  image: string | null
  role: ProjectRole
  joinedAt: Date
}

export async function listMembers(projectId: string): Promise<ProjectMemberRow[]> {
  return db
    .select({
      membershipId: projectMembers.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: projectMembers.role,
      joinedAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt)
}

export async function listPendingInvitations(projectId: string) {
  return db
    .select()
    .from(projectInvitations)
    .where(and(eq(projectInvitations.projectId, projectId), eq(projectInvitations.status, 'pending')))
    .orderBy(desc(projectInvitations.createdAt))
}

export type ProjectStats = {
  activeConnections: number
  totalConnections: number
  calls24h: number
  failedCalls24h: number
  datasetCount: number
}

export async function getProjectStats(projectId: string): Promise<ProjectStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [connectionRows, callRows, datasetRows] = await Promise.all([
    db
      .select({ status: connections.status, n: count() })
      .from(connections)
      .where(eq(connections.projectId, projectId))
      .groupBy(connections.status),
    db
      .select({ ok: apiCallLogs.ok, n: count() })
      .from(apiCallLogs)
      .where(and(eq(apiCallLogs.projectId, projectId), gte(apiCallLogs.createdAt, since)))
      .groupBy(apiCallLogs.ok),
    db.select({ n: count() }).from(datasets).where(eq(datasets.projectId, projectId)),
  ])

  return {
    activeConnections: connectionRows.find((r) => r.status === 'connected')?.n ?? 0,
    totalConnections: connectionRows.reduce((sum, r) => sum + r.n, 0),
    calls24h: callRows.reduce((sum, r) => sum + r.n, 0),
    failedCalls24h: callRows.find((r) => r.ok === 'false')?.n ?? 0,
    datasetCount: datasetRows[0]?.n ?? 0,
  }
}

export async function listRecentCalls(projectId: string, limit = 20) {
  return db
    .select({
      id: apiCallLogs.id,
      pluginId: apiCallLogs.pluginId,
      endpointId: apiCallLogs.endpointId,
      method: apiCallLogs.method,
      ok: apiCallLogs.ok,
      statusCode: apiCallLogs.statusCode,
      durationMs: apiCallLogs.durationMs,
      responseBytes: apiCallLogs.responseBytes,
      errorMessage: apiCallLogs.errorMessage,
      createdAt: apiCallLogs.createdAt,
      actorName: user.name,
    })
    .from(apiCallLogs)
    .leftJoin(user, eq(user.id, apiCallLogs.createdById))
    .where(eq(apiCallLogs.projectId, projectId))
    .orderBy(desc(apiCallLogs.createdAt))
    .limit(limit)
}
