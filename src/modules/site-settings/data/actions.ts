'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertSystemAdmin } from '@/core/auth/session'
import { db } from '@/core/db/client'
import { auditLogs } from '@/core/db/schema/audit'
import { createId } from '@/core/utils/id'
import { MAX_CORNER_TEXT, MAX_MESSAGE, type SettingsOutcome } from '../types'
import { readSiteSettings, writeSiteSettings } from './settings'

/**
 * Saves the admin Settings page — platform Administrators only, checked here
 * (a server action is reachable without the page). Each save is audited.
 */

const maintenanceSchema = z.object({ on: z.boolean(), message: z.string().trim().max(MAX_MESSAGE) })
const cornerSchema = z.object({ on: z.boolean(), text: z.string().trim().max(MAX_CORNER_TEXT), placement: z.enum(['floating', 'footer']) })

async function save(part: 'maintenance' | 'corner', input: unknown): Promise<SettingsOutcome> {
  let admin
  try {
    admin = await assertSystemAdmin()
  } catch {
    return { ok: false, message: 'forbidden' }
  }
  const parsed = (part === 'maintenance' ? maintenanceSchema : cornerSchema).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'validation' }

  try {
    const current = await readSiteSettings()
    await writeSiteSettings({ ...current, [part]: parsed.data }, admin.id)
    await db.insert(auditLogs).values({
      id: createId('aud'),
      actorId: admin.id,
      action: `system.settings.${part}`,
      targetType: 'app_settings',
      targetId: 'site',
      detail: parsed.data,
    })
  } catch (error) {
    console.error('[settings] save', error instanceof Error ? error.message : error)
    return { ok: false, message: 'error' }
  }
  // Every layout reads these: the whole app is re-rendered.
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function saveMaintenance(input: unknown): Promise<SettingsOutcome> {
  return save('maintenance', input)
}

export async function saveCorner(input: unknown): Promise<SettingsOutcome> {
  return save('corner', input)
}
