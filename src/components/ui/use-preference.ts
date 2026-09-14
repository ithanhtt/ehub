'use client'

import { createContext, createElement, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import {
  PREFERENCES_COOKIE,
  PREFERENCES_MAX_AGE,
  PREFERENCES_MAX_LENGTH,
  parsePreferences,
  serializePreferences,
} from './preferences-cookie'

/**
 * A viewer's choice — a period, a measure, a chart or its table — remembered
 * in this browser, so a reload or a later visit opens as they left it.
 *
 * Choices live in a cookie (see preferences-cookie), which the server reads
 * too: the page passes what it read to PreferencesProvider, the first render
 * uses exactly that, and the browser, reading the same cookie, agrees — so a
 * page never shows the default first and then jumps to the saved choice.
 *
 * Whatever comes back is checked by `accept` first, so a saved value that no
 * longer makes sense (a period now too old, an option since removed) falls
 * back to the default. `fallback` and `accept` should be steady (module-level)
 * values. Every place reading a key follows a change made in another. When
 * the cookie can't be written, choices still hold for the visit.
 *
 * Choices an earlier version kept in localStorage still read, and move to the
 * cookie the first time the page runs.
 */

/** The choices the request's cookie carried, as the server read them — what the first render uses. */
const InitialPreferences = createContext<Record<string, unknown>>({})

export function PreferencesProvider({ initial, children }: { initial: Record<string, unknown>; children: React.ReactNode }) {
  return createElement(InitialPreferences.Provider, { value: initial }, children)
}

/** Choices made during this visit — still what is read when the cookie can't be written. */
const memory = new Map<string, unknown>()
const listeners = new Set<() => void>()

// The cookie's choices, parsed once per change of the cookie.
let cookieText: string | null = null
let cookieChoices: Record<string, unknown> = {}

function saved(): Record<string, unknown> {
  const prefix = `${PREFERENCES_COOKIE}=`
  const raw = document.cookie.split('; ').find((part) => part.startsWith(prefix))?.slice(prefix.length) ?? ''
  if (raw !== cookieText) {
    cookieText = raw
    cookieChoices = parsePreferences(raw)
  }
  return cookieChoices
}

/** Saves the choices to the cookie; whether the browser kept it. */
function write(choices: Record<string, unknown>): boolean {
  const value = serializePreferences(choices)
  if (value.length > PREFERENCES_MAX_LENGTH) return false
  document.cookie = `${PREFERENCES_COOKIE}=${value}; path=/; max-age=${PREFERENCES_MAX_AGE}; SameSite=Lax`
  saved()
  return cookieText === value
}

/** A choice an earlier version kept in localStorage — as JSON, or a plain string — as JSON text. */
function legacy(key: string): string | null {
  try {
    const text = window.localStorage.getItem(key)
    if (text === null) return null
    try {
      JSON.parse(text)
      return text
    } catch {
      return JSON.stringify(text)
    }
  } catch {
    return null
  }
}

/** The saved value of `key` as JSON text — text, so the store's snapshots compare by value. */
function read(key: string): string | null {
  if (memory.has(key)) return JSON.stringify(memory.get(key))
  const choices = saved()
  if (key in choices) return JSON.stringify(choices[key])
  return legacy(key)
}

let migrated = false

/** Moves choices left in localStorage by an earlier version into the cookie, once. */
function migrate() {
  if (migrated) return
  migrated = true
  try {
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith('adshub.'))
    if (keys.length === 0) return
    const choices = { ...saved() }
    for (const key of keys) {
      const text = legacy(key)
      if (!(key in choices) && text !== null) choices[key] = JSON.parse(text)
    }
    if (write(choices)) for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    /* left where it is; still read from there */
  }
}

function subscribe(listener: () => void) {
  migrate()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function usePreference<T>(key: string, fallback: T, accept: (value: unknown) => T | null) {
  const initial = useContext(InitialPreferences)
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => (key in initial ? JSON.stringify(initial[key]) : null),
  )
  const value = useMemo(() => (raw === null ? fallback : (accept(parse(raw)) ?? fallback)), [raw, fallback, accept])

  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const text = read(key)
      const current = text === null ? fallback : (accept(parse(text)) ?? fallback)
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next
      memory.set(key, resolved)
      write({ ...saved(), ...Object.fromEntries(memory) })
      listeners.forEach((listener) => listener())
    },
    [key, fallback, accept],
  )

  return [value, set] as const
}

const subscribeNever = () => () => {}

/**
 * False while the page hydrates, true from then on — for work that should
 * wait until the browser's own reading of the choices is in (a first load
 * that would otherwise fetch before a choice only the browser knew arrives).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
}
