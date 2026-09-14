/**
 * Runs once when the server starts (Next.js instrumentation hook): starts the
 * background sync that keeps the dashboard's data current without anyone
 * having it open. Node.js only — it reads the database and the filesystem.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startBackgroundSync } = await import('@/modules/overview/data/background')
  startBackgroundSync()
}
