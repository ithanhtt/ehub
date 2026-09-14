import 'server-only'

import { cookies } from 'next/headers'
import { getProjectContext } from '@/core/auth/session'
import { LAST_PROJECT_COOKIE, parseLastProject, projectOverviewPath } from './last-project-cookie'

/**
 * Where a signed-in viewer lands when opening the app: the overview of the
 * project they were in last in this browser, while they are still a member of
 * it — the list of projects otherwise.
 */
export async function resumePath(): Promise<string> {
  const projectId = parseLastProject((await cookies()).get(LAST_PROJECT_COOKIE)?.value)
  if (projectId && (await getProjectContext(projectId))) return projectOverviewPath(projectId)
  return '/projects'
}
