'use client'

import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'

/**
 * A table whose headings stay put while its rows scroll.
 *
 * The table is drawn twice, one copy above the other. The top copy shows only
 * its headings, its rows collapsed; the copy below shows only its rows, its
 * headings collapsed, and is the one that scrolls. Collapsed rows keep their
 * say in the column widths, so the two copies — the same content in the same
 * width — lay out their columns identically, with nothing measured.
 *
 * The rows scroll in a box of their own that starts below the headings, so
 * the browser cuts them off right there as it scrolls: nothing ever passes
 * behind the headings, however fast the scroll, and the headings keep the
 * tables' own look — no fill.
 *
 * Both copies sit in one box that scrolls sideways, so a table wider than the
 * screen moves as one. The rows' box keeps a scrollbar gutter and the
 * headings' box the same, so the two stay the same width. Collapsed parts are
 * neither seen, focused nor read out, so only one copy of each part is live.
 *
 * `maxHeight` caps the rows' box; with `fill` it shrinks instead to the room a
 * flex column leaves it (the fixed-size dialogs).
 */
export function TableScroll({
  children,
  maxHeight,
  fill = false,
  sx,
}: {
  /** The whole table, headings and rows. */
  children: React.ReactNode
  maxHeight?: number | string
  /** Shrink to the room a flex column leaves, rather than to a fixed cap. */
  fill?: boolean
  sx?: SxProps<Theme>
}) {
  const copy = { width: 'max-content', minWidth: '100%', scrollbarGutter: 'stable' } as const
  return (
    <Box
      sx={[
        {
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'auto',
          overflowY: 'hidden',
          maxHeight,
          ...(fill ? { flex: '0 1 auto', minHeight: 0 } : null),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box sx={{ ...copy, flex: 'none', overflowY: 'hidden', '& tbody, & tfoot': { visibility: 'collapse' } }}>
        {children}
      </Box>
      <Box
        data-table-scroll=""
        sx={{ ...copy, flex: '0 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', '& thead': { visibility: 'collapse' } }}
      >
        {children}
      </Box>
    </Box>
  )
}
