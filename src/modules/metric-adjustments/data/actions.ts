'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertSystemAdmin } from '@/core/auth/session'
import { db } from '@/core/db/client'
import { metricAdjustments } from '@/core/db/schema/adjustments'
import { auditLogs } from '@/core/db/schema/audit'
import { projects } from '@/core/db/schema/projects'
import { createId } from '@/core/utils/id'
import { daysBetween, shiftDay } from '@/modules/overview/data/period'
import { ADJUSTMENT_METRICS } from '../spread'
import type { AdjustmentOutcome } from '../types'

/**
 * Adds, changes and removes the amounts folded into a project's overview —
 * platform Administrators only, checked here as well as by the page (a
 * server action is reachable without it). Each change goes to the audit
 * trail with who made it and the figures.
 */

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => shiftDay(value, 0) === value)

/** Up to about ten years in one adjustment, and amounts a bigint holds with room to sum. */
const MAX_DAYS = 3700
const MAX_AMOUNT = 1e15

const inputSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    projectId: z.string().min(1).max(100),
    metric: z.enum(ADJUSTMENT_METRICS as [string, ...string[]]),
    amount: z.number().int().refine((v) => v !== 0 && Math.abs(v) <= MAX_AMOUNT),
    spread: z.enum(['total', 'daily']),
    startOn: day,
    endOn: day,
    note: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.startOn <= v.endOn && daysBetween(v.startOn, v.endOn).length <= MAX_DAYS)

function refresh() {
  revalidatePath('/admin/adjustments')
}

export async function saveAdjustment(input: unknown): Promise<AdjustmentOutcome> {
  let admin
  try {
    admin = await assertSystemAdmin()
  } catch {
    return { ok: false, message: 'forbidden' }
  }
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'validation' }
  const { id, note, ...values } = parsed.data
  const fields = { ...values, metric: values.metric as (typeof ADJUSTMENT_METRICS)[number], note: note || null }

  try {
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, fields.projectId)).limit(1)
    if (!project) return { ok: false, message: 'notFound' }

    let targetId = id
    if (id) {
      const [existing] = await db.select({ id: metricAdjustments.id }).from(metricAdjustments).where(eq(metricAdjustments.id, id)).limit(1)
      if (!existing) return { ok: false, message: 'notFound' }
      await db
        .update(metricAdjustments)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(metricAdjustments.id, id))
    } else {
      targetId = createId('adj')
      await db.insert(metricAdjustments).values({ id: targetId, ...fields, createdById: admin.id })
    }

    await db.insert(auditLogs).values({
      id: createId('aud'),
      projectId: fields.projectId,
      actorId: admin.id,
      action: id ? 'dashboard.adjustment.update' : 'dashboard.adjustment.create',
      targetType: 'metric_adjustment',
      targetId,
      detail: { metric: fields.metric, amount: fields.amount, spread: fields.spread, startOn: fields.startOn, endOn: fields.endOn },
    })
  } catch (error) {
    console.error('[adjustments] save', error instanceof Error ? error.message : error)
    return { ok: false, message: 'error' }
  }
  refresh()
  return { ok: true }
}

export async function deleteAdjustment(id: unknown): Promise<AdjustmentOutcome> {
  let admin
  try {
    admin = await assertSystemAdmin()
  } catch {
    return { ok: false, message: 'forbidden' }
  }
  if (typeof id !== 'string' || !id) return { ok: false, message: 'validation' }

  try {
    const [removed] = await db.delete(metricAdjustments).where(eq(metricAdjustments.id, id)).returning()
    if (!removed) return { ok: false, message: 'notFound' }
    await db.insert(auditLogs).values({
      id: createId('aud'),
      projectId: removed.projectId,
      actorId: admin.id,
      action: 'dashboard.adjustment.delete',
      targetType: 'metric_adjustment',
      targetId: id,
      detail: { metric: removed.metric, amount: removed.amount, spread: removed.spread, startOn: removed.startOn, endOn: removed.endOn },
    })
  } catch (error) {
    console.error('[adjustments] delete', error instanceof Error ? error.message : error)
    return { ok: false, message: 'error' }
  }
  refresh()
  return { ok: true }
}
