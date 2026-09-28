'use client'

import { useEffect } from 'react'

const POLL_MS = 30_000

/**
 * On every page for everyone but Administrators: asks every little while
 * whether the app has been closed for maintenance and, when it has, reloads —
 * the layout then shows the maintenance notice instead of a page left open.
 */
export function MaintenanceWatcher() {
  useEffect(() => {
    const check = async () => {
      if (document.hidden) return
      try {
        const response = await fetch('/api/maintenance', { cache: 'no-store' })
        if (!response.ok) return
        const { active } = (await response.json()) as { active: boolean }
        if (active) window.location.reload()
      } catch {
        /* offline for a moment: asked again shortly */
      }
    }
    const timer = setInterval(() => void check(), POLL_MS)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
