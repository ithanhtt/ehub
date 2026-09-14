import Box from '@mui/material/Box'
import Divider, { type DividerProps } from '@mui/material/Divider'

/**
 * The two motifs the reference screens repeat, factored out so they stay
 * identical everywhere.
 */

/**
 * A dashed rule.
 *
 * The reference uses dashed lines wherever a card splits into sections, and
 * solid ones nowhere — it is what keeps a card reading as one surface with
 * parts, rather than as several stacked boxes.
 */
export function DashedDivider(props: DividerProps) {
  return <Divider {...props} sx={{ borderStyle: 'dashed', ...props.sx }} />
}

type Tone = 'primary' | 'neutral' | 'success' | 'warning' | 'error' | 'info'

/**
 * An icon inside a soft tinted disc.
 *
 * Carries emphasis without adding a hard edge, which is the point of a flat
 * design: weight comes from tone, not from outlines or shadows. The wash is
 * built from MUI's channel variables, so one expression is correct on both
 * the light and the dark ground.
 */
export function SoftIcon({
  children,
  size = 38,
  tone = 'primary',
}: {
  children: React.ReactNode
  size?: number
  tone?: Tone
}) {
  const isNeutral = tone === 'neutral'

  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: isNeutral ? 'text.secondary' : `${tone}.main`,
        backgroundColor: isNeutral
          ? 'var(--adshub-surface-inset)'
          : `rgba(var(--mui-palette-${tone}-mainChannel) / 0.14)`,
      }}
    >
      {children}
    </Box>
  )
}
