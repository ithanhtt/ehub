/**
 * Release versions, as the System update page asks for them: MAJOR.MINOR.PATCH,
 * optionally with a pre-release tag (1.4.0-beta.2). Shared by the page and the
 * server code, so both accept exactly the same.
 */

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,24}))?$/

export type BumpKind = 'patch' | 'minor' | 'major'

export function isVersion(value: string): boolean {
  return VERSION.test(value)
}

function parse(value: string | null | undefined) {
  const match = value ? VERSION.exec(value.trim()) : null
  return match ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null } : null
}

/** Negative, zero or positive, as `a` is lower, equal or higher. Unreadable versions sort lowest. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0)
  for (let i = 0; i < 3; i++) if (left.parts[i] !== right.parts[i]) return left.parts[i] - right.parts[i]
  // 1.2.0-beta comes before 1.2.0.
  if (left.pre === right.pre) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  return left.pre < right.pre ? -1 : 1
}

/** The next version after `value`: 1.4.2 → 1.4.3 / 1.5.0 / 2.0.0. A pre-release patch bump lands on its release (1.5.0-beta → 1.5.0). */
export function bumpVersion(value: string | null | undefined, kind: BumpKind = 'patch'): string {
  const version = parse(value) ?? { parts: [0, 0, 0], pre: null }
  const [major, minor, patch] = version.parts
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return version.pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
}
