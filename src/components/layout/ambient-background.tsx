import Box from '@mui/material/Box'

/**
 * The soft colour wash behind the whole app.
 *
 * This is the half of the design that the frosted cards need in order to read
 * as glass: without something diffuse behind them, translucency has nothing to
 * show and the surfaces just look faded.
 *
 * Built from layered radial gradients rather than blurred elements. A gradient
 * is already perfectly smooth, so this needs no `filter: blur()` — which would
 * otherwise force a full-page offscreen composite on every scroll and repaint.
 *
 * `fixed` + `pointer-events: none` + `aria-hidden` keep it out of the way of
 * layout, hit-testing and assistive technology alike.
 */
export function AmbientBackground() {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        backgroundColor: 'background.default',
        backgroundImage: `
          radial-gradient(58rem 40rem at 88% 6%,  var(--adshub-blob-a), transparent 70%),
          radial-gradient(46rem 34rem at 6% 92%,  var(--adshub-blob-b), transparent 68%),
          radial-gradient(40rem 30rem at 62% 96%, var(--adshub-blob-c), transparent 66%),
          radial-gradient(34rem 26rem at 24% 34%, var(--adshub-blob-b), transparent 72%)
        `,
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}
