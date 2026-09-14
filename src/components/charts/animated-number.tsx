'use client'

import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'

/**
 * A number that counts to its new value instead of jumping — the running
 * total of a live sales screen.
 *
 * It only ever travels between real values: each update animates from what
 * is on screen to the figure the server just confirmed, and never runs ahead
 * of it. With reduced motion requested, the value is simply replaced.
 *
 * An increase shows the step ("+1,2 Tr") beside the number, long enough to
 * be read: about eight seconds, then a slow fade. Increases that land while
 * it is showing add to it — two orders a few seconds apart read "+2" with a
 * small pop, rather than flickering from one "+1" to another — and start the
 * eight seconds again. While `pinned` (the pointer rests on the tile) it
 * stays.
 *
 * Digits are tabular while counting: proportional figures would make the
 * number shiver sideways as every digit changes width on each frame.
 */

const DURATION_MS = 1200
/** How long the "+…" badge stays fully readable after the latest increase. */
const STEP_HOLD_MS = 8000
/** Then how long it takes to fade out. */
const STEP_FADE_MS = 1000

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The value as it should read this frame, easing towards `target`. */
export function useTweenedNumber(target: number, duration = DURATION_MS): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    const start = from.current
    if (start === target || prefersReducedMotion() || !Number.isFinite(start)) {
      from.current = target
      setShown(target)
      return
    }
    const began = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / duration)
      const value = start + (target - start) * easeOutCubic(progress)
      from.current = value
      setShown(value)
      frame.current = progress < 1 ? requestAnimationFrame(step) : null
    }
    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [target, duration])

  return shown
}

/**
 * The badge: the increase it shows (summed while it stays up), which showing
 * it is (`run` — a new one slides in), how many increases it has gathered
 * (`bump` — each after the first pops), and whether it is fading out.
 */
type Step = { amount: number; run: number; bump: number; fading: boolean }

export function AnimatedNumber({
  value,
  format,
  formatStep,
  integer = false,
  pinned = false,
}: {
  value: number
  format: (value: number) => string
  /** How to write an increase in the "+…" badge; omit for no badge. */
  formatStep?: (step: number) => string
  /** Round every frame (order counts), so no fractional order ever shows. */
  integer?: boolean
  /** Keep the badge up — while the pointer rests on the number's tile. */
  pinned?: boolean
}) {
  const shown = useTweenedNumber(value)
  const [step, setStep] = useState<Step | null>(null)
  const previous = useRef(value)
  const withBadge = formatStep !== undefined

  // Only a change of value counts — not a re-render — so the page's one-second clock never resets anything.
  useEffect(() => {
    const amount = value - previous.current
    previous.current = value
    if (amount <= 0 || !withBadge) return
    setStep((current) =>
      current && !current.fading
        ? { ...current, amount: current.amount + amount, bump: current.bump + 1 }
        : { amount, run: (current?.run ?? 0) + 1, bump: 1, fading: false },
    )
  }, [value, withBadge])

  // Readable for STEP_HOLD_MS after the latest increase, unless pinned; then it fades.
  const run = step?.run
  const bump = step?.bump
  const fading = step?.fading ?? false
  const showing = step !== null
  useEffect(() => {
    if (!showing || fading || pinned) return
    const hold = setTimeout(() => setStep((current) => (current ? { ...current, fading: true } : current)), STEP_HOLD_MS)
    return () => clearTimeout(hold)
  }, [showing, fading, pinned, run, bump])

  // A pointer arriving mid-fade brings it back.
  useEffect(() => {
    if (pinned) setStep((current) => (current?.fading ? { ...current, fading: false } : current))
  }, [pinned])

  useEffect(() => {
    if (!fading) return
    const done = setTimeout(() => setStep(null), STEP_FADE_MS)
    return () => clearTimeout(done)
  }, [fading, run])

  return (
    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'baseline', gap: 0.75 }}>
      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {format(integer ? Math.round(shown) : shown)}
      </Box>
      {step && formatStep ? (
        <Box
          key={step.run}
          component="span"
          aria-hidden
          sx={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'success.main',
            whiteSpace: 'nowrap',
            opacity: step.fading ? 0 : 1,
            transform: step.fading ? 'translateY(-4px)' : 'none',
            transition: `opacity ${STEP_FADE_MS}ms ease-in, transform ${STEP_FADE_MS}ms ease-in`,
            animation: 'adshub-step-in .35s ease-out',
            '@keyframes adshub-step-in': {
              from: { opacity: 0, transform: 'translateY(4px)' },
              to: { opacity: 1, transform: 'none' },
            },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', transition: 'none' },
          }}
        >
          <Box
            key={step.bump}
            component="span"
            sx={{
              display: 'inline-block',
              animation: step.bump > 1 ? 'adshub-step-bump .4s ease-out' : 'none',
              '@keyframes adshub-step-bump': {
                '0%': { transform: 'scale(1.3)' },
                '100%': { transform: 'scale(1)' },
              },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            +{formatStep(step.amount)}
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
