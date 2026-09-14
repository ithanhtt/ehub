import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/core/auth/auth'

/**
 * better-auth mounts its whole surface — sign-in, sign-up, session, admin —
 * under this one catch-all route. The client in core/auth/client.ts talks to it.
 */
export const { GET, POST } = toNextJsHandler(auth.handler)
