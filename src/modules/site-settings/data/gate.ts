import 'server-only'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/core/auth/session'
import { maintenanceState } from './settings'

/**
 * For the route handlers the pages read their data from: a 503 while the app
 * is closed for maintenance, for everyone but platform Administrators; null
 * to go on. The pages reload on it and show the maintenance notice.
 */
export async function closedForMaintenance(): Promise<NextResponse | null> {
  const state = await maintenanceState()
  if (!state.active) return null
  const user = await getCurrentUser()
  if (user?.role === 'admin') return null
  return NextResponse.json({ error: 'MAINTENANCE' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Maintenance': '1' } })
}
