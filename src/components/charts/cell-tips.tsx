'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Popper from '@mui/material/Popper'
import type { SxProps, Theme } from '@mui/material/styles'
import { TIP_SURFACE } from './chart-tooltip'

/**
 * One hover card for a whole grid of cells — an hour strip, a table of hours
 * — instead of a Tooltip on every cell.
 *
 * A table of 60 products × 24 hours is 1 440 cells: a Tooltip each is 1 440
 * components mounted, listening and re-rendered with the table, which is what
 * made switching its tabs and measures stall. Here the cells only carry
 * `data-tip` (a key the caller reads back), the grid listens once, and a single
 * card follows the cell under the pointer — or the cell tapped, on a phone,
 * until the next tap. Same card as every other hover (chart-tooltip.tsx).
 */
export function CellTips({ render, children, sx }: { render: (key: string) => ReactNode; children: ReactNode; sx?: SxProps<Theme> }) {
  const [active, setActive] = useState<{ el: HTMLElement; key: string } | null>(null)
  const touch = useRef(false)

  const cellOf = (event: ReactPointerEvent<HTMLElement>) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    return el && event.currentTarget.contains(el) ? el : null
  }
  const show = (el: HTMLElement | null) =>
    setActive((current) => {
      if (!el) return current === null ? current : null
      const key = el.dataset.tip ?? ''
      return current?.el === el && current.key === key ? current : { el, key }
    })

  const content = active ? render(active.key) : null
  return (
    <Box
      sx={sx}
      onPointerOver={(event) => {
        if (event.pointerType === 'mouse') show(cellOf(event))
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') show(null)
      }}
      onPointerDown={(event) => {
        touch.current = event.pointerType !== 'mouse'
        if (!touch.current) return
        const el = cellOf(event)
        // A second tap on the same cell closes it.
        setActive((current) => (el && current?.el !== el ? { el, key: el.dataset.tip ?? '' } : null))
      }}
    >
      {children}
      <Popper
        open={Boolean(active && content)}
        anchorEl={active?.el ?? null}
        placement="top"
        modifiers={[
          { name: 'offset', options: { offset: [0, 8] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.tooltip, pointerEvents: 'none' }}
      >
        <Box sx={{ ...TIP_SURFACE, maxWidth: 320 }}>{content}</Box>
      </Popper>
    </Box>
  )
}
