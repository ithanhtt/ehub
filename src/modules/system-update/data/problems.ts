import 'server-only'

import { isEmbeddedDatabase } from '@/core/db/client'
import type { ReceiverProblem } from '../types'
import { releaseLayout, signingKey } from './config'

/** What stops this server from applying updates: no key, not installed in the release layout, or the embedded database. */
export function receiverProblems(): ReceiverProblem[] {
  const problems: ReceiverProblem[] = []
  if (!signingKey()) problems.push('key')
  if (!releaseLayout()) problems.push('layout')
  // Migrating the embedded database while the running app holds it open corrupts it.
  if (isEmbeddedDatabase) problems.push('embedded')
  return problems
}
