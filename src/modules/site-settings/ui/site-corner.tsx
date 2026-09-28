import Box from '@mui/material/Box'
import { readSiteSettings, templateValues } from '../data/settings'
import { fillTemplate } from '../template'
import type { CornerPlacement } from '../types'
import { cornerSx } from './corner-style'

/**
 * The small note an Administrator may set for the bottom-right of every page
 * — the version ({{version}}), who built the app. Placed twice: the root
 * layout draws the floating one, each page layout (app, sign-in) the footer
 * one at the end of its column; each draws only when it is the placement set.
 */
export async function SiteCorner({ placement }: { placement: CornerPlacement }) {
  const { corner } = await readSiteSettings()
  if (!corner.on || corner.placement !== placement) return null
  const text = fillTemplate(corner.text, await templateValues()).trim()
  if (!text) return null

  if (placement === 'footer') {
    return (
      <Box component="footer" sx={cornerSx('footer')}>
        {text}
      </Box>
    )
  }
  return (
    <Box
      component="aside"
      sx={[
        cornerSx('floating'),
        { position: 'fixed', right: { xs: 8, sm: 12 }, bottom: { xs: 8, sm: 12 }, zIndex: 1200, pointerEvents: 'none' },
      ]}
    >
      {text}
    </Box>
  )
}
