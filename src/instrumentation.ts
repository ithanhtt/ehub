/**
 * Runs once when the server starts (Next.js instrumentation hook): starts the
 * background sync that keeps the dashboard's data current without anyone
 * having it open, and the daily housekeeping that keeps logs and caches from
 * filling the disk. Node.js only — both read the database and the filesystem.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const [{ startBackgroundSync }, { startHousekeeping }, { startBookingAutoSync }] = await Promise.all([
    import('@/modules/overview/data/background'),
    import('@/core/housekeeping'),
    import('@/features/bookings/auto-sync'),
  ])
  startBackgroundSync()
  // The booking file's results fill in by themselves, dev included (features/bookings/auto-sync.ts).
  startBookingAutoSync()
  // Always on, dev included: it only removes what has expired or lost its owner.
  startHousekeeping()
}
