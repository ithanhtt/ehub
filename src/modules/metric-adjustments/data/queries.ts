import 'server-only'

import { asc, desc, eq } from 'drizzle-orm'
import { db } from '@/core/db/client'
import { metricAdjustments } from '@/core/db/schema/adjustments'
import { user } from '@/core/db/schema/auth'
import { projects } from '@/core/db/schema/projects'
import type { AdjustmentRow, AdjustmentsOverview } from '../types'

/** Every project, and every adjustment set on any of them, newest first — for the admin page. */
export async function adjustmentsOverview(): Promise<AdjustmentsOverview> {
  const [projectRows, rows] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name)),
    db
      .select({ row: metricAdjustments, createdBy: user.name })
      .from(metricAdjustments)
      .leftJoin(user, eq(user.id, metricAdjustments.createdById))
      .orderBy(desc(metricAdjustments.startOn), desc(metricAdjustments.createdAt)),
  ])
  const adjustments: AdjustmentRow[] = rows.map(({ row, createdBy }) => ({
    id: row.id,
    projectId: row.projectId,
    metric: row.metric,
    amount: row.amount,
    spread: row.spread,
    startOn: row.startOn,
    endOn: row.endOn,
    note: row.note,
    createdBy: createdBy ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }))
  return { projects: projectRows, adjustments }
}
