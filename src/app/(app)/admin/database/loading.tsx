import { AdminLoading } from '@/modules/system-admin/ui/admin-loading'

/** Shown at once while the Database page lists its tables. */
export default function Loading() {
  return <AdminLoading variant="database" />
}
