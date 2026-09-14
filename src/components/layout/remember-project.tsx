'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { LAST_PROJECT_COOKIE, LAST_PROJECT_MAX_AGE, projectOfPath } from '@/features/projects/last-project-cookie'

/**
 * Remembers the project on screen, so the app opens on its overview next time
 * (see features/projects/resume.ts). On the list of projects it forgets
 * instead: someone who went back to the list has left the project.
 */
export function RememberProject({ forget = false }: { forget?: boolean }) {
  const pathname = usePathname()
  useEffect(() => {
    const projectId = forget ? null : projectOfPath(pathname)
    document.cookie = projectId
      ? `${LAST_PROJECT_COOKIE}=${projectId}; path=/; max-age=${LAST_PROJECT_MAX_AGE}; SameSite=Lax`
      : `${LAST_PROJECT_COOKIE}=; path=/; max-age=0; SameSite=Lax`
  }, [pathname, forget])
  return null
}
