import type { CornerPlacement } from '../types'

/**
 * How the corner note looks, shared by the note itself and the Settings
 * page's preview. 'floating' stays in the bottom-right corner of the screen
 * as the page scrolls, faint, letting clicks through; 'footer' sits at the
 * foot of the page, right-aligned — at the bottom of the screen on a short
 * page, after the content on a long one.
 */
const TEXT = {
  color: 'text.secondary',
  fontSize: 11,
  lineHeight: 1.5,
  textAlign: 'right',
  whiteSpace: 'pre-line',
  overflowWrap: 'anywhere',
} as const

export function cornerSx(placement: CornerPlacement) {
  if (placement === 'footer') return { ...TEXT, px: { xs: 2, md: 3 }, py: 1.5, opacity: 0.8 } as const
  return {
    ...TEXT,
    px: 1,
    py: 0.25,
    borderRadius: 1,
    bgcolor: 'background.paper',
    opacity: 0.72,
    boxShadow: 1,
    maxWidth: { xs: 'calc(100vw - 16px)', sm: 360 },
  } as const
}
