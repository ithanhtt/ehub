/**
 * What the System update page shows and does — shared by the page, the
 * server code behind it, and (as JSON) the updater script, which writes the
 * status and history these types describe (see scripts/apply-update.mjs).
 */

export type UpdateStepKey = 'verify' | 'backup' | 'unpack' | 'install' | 'migrate' | 'build' | 'switch' | 'restart' | 'health'

export const UPDATE_STEPS: UpdateStepKey[] = ['verify', 'backup', 'unpack', 'install', 'migrate', 'build', 'switch', 'restart', 'health']

export type StepState = 'pending' | 'running' | 'done' | 'failed'

/** "interrupted": the updater stopped without saying how it ended (the server went down mid-way, say). */
export type UpdateState = 'queued' | 'running' | 'succeeded' | 'failed' | 'rolled-back' | 'interrupted'

export interface UpdateStep {
  key: UpdateStepKey
  state: StepState
  startedAt?: string
  endedAt?: string
  /** Why it failed. */
  note?: string
}

/** One update's run: the one going on, or the last one. */
export interface UpdateStatus {
  id: string
  version: string
  label: string
  state: UpdateState
  startedAt: string
  endedAt: string | null
  steps: UpdateStep[]
  /** The release it built, and the one it replaced (the one to fall back on). */
  release: string | null
  previous: string | null
  /** Where the database backup taken before it was written. */
  backup: string | null
  error: string | null
  /** The administrator who confirmed it, by email. */
  confirmedBy: string | null
}

/** A past update, as the history keeps it. */
export type UpdateRecord = Omit<UpdateStatus, 'steps'>

/** An update received on the server and waiting for its code. */
export interface PendingUpdate {
  id: string
  version: string
  label: string
  sha256: string
  /** Packed size, and how many files. */
  bytes: number
  files: number
  /** Which machine sent it, as it named itself. */
  source: string
  createdAt: string
  expiresAt: string
  attempts: number
  confirmedAt: string | null
  confirmedBy: string | null
}

/** Why this server cannot take updates, when it is meant to. */
export type ReceiverProblem = 'key' | 'layout' | 'embedded'

/** Why this machine cannot send updates, when it is meant to. */
export type SenderProblem = 'key' | 'url'

export interface UpdateOverview {
  /** The release this app runs; null outside the server's release layout (development). */
  release: { id: string; version: string | null } | null
  /** This machine sends updates to `server` (a development machine). */
  sender: { server: string; problem: SenderProblem | null } | null
  /** This machine takes updates (the server). */
  receiver: { problems: ReceiverProblem[]; attemptsAllowed: number } | null
  pending: PendingUpdate | null
  status: UpdateStatus | null
  history: UpdateRecord[]
  /** The last lines of the current (or last) update's log. */
  log: string[]
}

/** What the send dialog starts from: the versions on either side, and the one it proposes. */
export interface VersionSuggestion {
  /** The version the server runs; null when it could not be asked, or runs a build without one. */
  server: string | null
  /** package.json on this machine. */
  local: string | null
  /** One step above the higher of the two. */
  suggested: string
}

export type SendFailure =
  | 'forbidden'
  | 'notConfigured'
  | 'version'
  | 'pack'
  | 'tooLarge'
  | 'network'
  | 'signature'
  | 'stale'
  | 'busy'
  | 'bundle'
  | 'notReceiver'
  | 'server'

export type SendOutcome =
  | { ok: true; id: string; code: string; version: string; files: number; bytes: number; expiresAt: string; server: string }
  | { ok: false; reason: SendFailure; detail?: string }

export type ConfirmOutcome =
  | { ok: true }
  | {
      ok: false
      reason: 'forbidden' | 'notReceiver' | 'problem' | 'notFound' | 'expired' | 'wrongCode' | 'locked' | 'busy'
      /** Tries left after a wrong code. */
      remaining?: number
    }
