import { maintenanceState } from '@/modules/site-settings/data/settings'

/**
 * Whether the app is closed for maintenance — asked by the maintenance notice
 * (to reopen by itself when it ends) and by open pages (to close when it
 * begins). Says nothing else, so anyone may ask.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const { active } = await maintenanceState()
  return Response.json({ active }, { headers: { 'Cache-Control': 'no-store' } })
}
