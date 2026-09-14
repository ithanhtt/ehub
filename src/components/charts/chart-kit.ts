import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Shared pieces of the dashboard's hand-built SVG charts: scale ticks, the
 * rounded column shape, a width observer, and the easing that moves marks to
 * new data instead of redrawing them.
 */

export const known = (value: number | null | undefined): value is number => value !== null && value !== undefined

/** 0, 2k, 4k… — a step of 1, 2 or 5 × 10ⁿ giving about four intervals. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1]
  const rough = max / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

/** A column with its data end rounded and its foot square on the baseline. */
export function roundedTop(x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h))
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export type Track = { key: string; values: Array<number | null> }

const TWEEN_MS = 700
const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * Tracks and scale tops, eased from the last render to the new data.
 *
 * A refresh moves marks to their new positions instead of redrawing them, and
 * the scale glides when a new high raises it. A position that did not exist
 * before (the next hour) starts level with its left neighbour, so a line grows
 * out of its last point. Gaps (null) are never tweened. Reduced motion skips
 * the easing.
 */
export function useTweened(tracks: Track[], tops: number[]): { tracks: Track[]; tops: number[] } {
  const [frame, setFrame] = useState({ tracks, tops })
  const last = useRef({ tracks, tops })
  const raf = useRef<number | null>(null)

  const signature = JSON.stringify([tops, tracks.map((t) => [t.key, t.values])])

  useEffect(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    const from = last.current
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      last.current = { tracks, tops }
      setFrame(last.current)
      return
    }

    const starts = tracks.map((track) => {
      const old = from.tracks.find((o) => o.key === track.key)?.values ?? []
      return track.values.map((v, i) => {
        if (v === null) return null
        if (known(old[i])) return old[i] as number
        // New position: grow from the nearest earlier value on screen.
        for (let j = Math.min(i, old.length) - 1; j >= 0; j--) if (known(old[j])) return old[j] as number
        return v
      })
    })
    const fromTops = tops.map((top, i) => from.tops[i] ?? top)

    const began = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - began) / TWEEN_MS)
      const k = easeOut(p)
      const next = {
        tops: tops.map((top, i) => fromTops[i] + (top - fromTops[i]) * k),
        tracks: tracks.map((track, ti) => ({
          ...track,
          values: track.values.map((v, i) => {
            const a = starts[ti][i]
            return v === null || a === null ? v : a + (v - a) * k
          }),
        })),
      }
      last.current = next
      setFrame(next)
      raf.current = p < 1 ? requestAnimationFrame(step) : null
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
    // `signature` stands for tracks and tops: only a change in the data restarts the easing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return frame
}

/** The element's content width, kept current as it resizes. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    // Measured at once, so a chart switched into view draws on its first frame rather than the observer's.
    setWidth(Math.floor(node.getBoundingClientRect().width))
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}
