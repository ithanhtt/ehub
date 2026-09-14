/**
 * The cookie that remembers which project this browser was in last, so opening
 * the app again (its address, the installed app, signing in) goes back to that
 * project's overview instead of the list of every project. Only the project is
 * kept, never the page inside it: the app always reopens on the overview.
 *
 * Shared by the browser, which writes it on every project page, and the
 * server, which reads it — and checks the project is still the viewer's.
 */

export const LAST_PROJECT_COOKIE = 'adshub_last_project'

/** A year; every project page renews it. */
export const LAST_PROJECT_MAX_AGE = 365 * 24 * 3600

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/
/** A page inside one project: /projects/<id>, optionally deeper. */
const PROJECT_PAGE = /^\/projects\/([A-Za-z0-9_-]{1,64})(?:\/|$)/

/** The project a page of the app belongs to; null outside a project. */
export function projectOfPath(pathname: string | null | undefined): string | null {
  return pathname ? (PROJECT_PAGE.exec(pathname)?.[1] ?? null) : null
}

/** The project id a stored value holds; null when it is missing or not one. */
export function parseLastProject(value: string | null | undefined): string | null {
  return value && PROJECT_ID.test(value) ? value : null
}

/** Where a remembered project reopens: its overview. */
export const projectOverviewPath = (projectId: string) => `/projects/${projectId}`
