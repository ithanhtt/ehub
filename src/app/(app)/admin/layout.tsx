import { requireSystemAdmin } from '@/core/auth/session'
import { AdminTabs } from '@/modules/system-admin/ui/admin-tabs'

/**
 * The admin area — System, Database, Metric adjustments, System update — for platform
 * Administrators only. This guard keeps everyone else off the pages; every
 * action and route handler behind them checks again on its own
 * (assertSystemAdmin), since those are reachable without the page.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSystemAdmin()
  return (
    <>
      <AdminTabs />
      {children}
    </>
  )
}
