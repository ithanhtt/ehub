'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { APP_NAME } from '@/core/brand'
import logo from './ehub-logo.png'

const MARK = 34
const BAR = 26
/** The bag's handle green, so the wordmark belongs to the mark. */
const INK = '#109138'
/** A springy ease that overshoots a little, for the bag. */
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
/** The shortest gap between two light sweeps, so hovering back and forth stays calm. */
const SWEEP_GAP_MS = 1600

/** A filled circle as an image, pinned at its exact size — true to the pixel, unlike a radial-gradient edge. */
const circle = (size: number) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${size} ${size}'%3E%3Ccircle cx='${size / 2}' cy='${size / 2}' r='${size / 2}'/%3E%3C/svg%3E")`

/*
 * The disc and the bar as ONE silhouette: a disc on the left, a bar from its
 * centre to the right, and a round cap at the bar's end. Every layer of the
 * logo — shadow, glass, sheen — is cut from this same mask, so a translucent
 * fill never doubles up where the disc and the bar overlap. The two circles
 * are SVG, not gradients: a gradient's soft edge makes the cap a fraction
 * smaller than the bar, and the join shows as a step.
 */
const SHAPE = [circle(MARK), circle(BAR), 'linear-gradient(#000, #000)'].join(', ')
const SHAPE_SIZE = `${MARK}px ${MARK}px, ${BAR}px ${BAR}px, calc(100% - ${(MARK + BAR) / 2}px) ${BAR}px`
const SHAPE_POSITION = `0 50%, 100% 50%, ${MARK / 2}px 50%`
const silhouette = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  WebkitMaskImage: SHAPE,
  maskImage: SHAPE,
  WebkitMaskSize: SHAPE_SIZE,
  maskSize: SHAPE_SIZE,
  WebkitMaskPosition: SHAPE_POSITION,
  maskPosition: SHAPE_POSITION,
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
} as const

const LIFT = { transform: `translateY(-1.5px) rotate(-8deg) scale(1.06)` }
const STILL = { '@media (prefers-reduced-motion: reduce)': { animation: 'none', transition: 'none' } }

/**
 * The logo as one block of frosted glass, in the same material as the app's
 * floating surfaces: the bag on a disc, joined to a shorter bar that carries
 * the wordmark. Light in both colour schemes, so the ink is fixed.
 *
 * It moves a little, and only when there is a reason: the bag pops in and a
 * band of light crosses the glass once when the page loads; hovering (or
 * focusing the link) lifts the bag and sends the light across again. None of
 * it runs for people who ask for reduced motion.
 */
export function Brand({ href }: { href?: string }) {
  // Bumping the key remounts the sheen, which replays its sweep.
  const [sweep, setSweep] = useState(0)
  const lastSweep = useRef(0)
  const replay = () => {
    const now = performance.now()
    if (now - lastSweep.current < SWEEP_GAP_MS) return
    lastSweep.current = now
    setSweep((count) => count + 1)
  }

  const content = (
    <Box
      onPointerEnter={replay}
      sx={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        height: MARK,
        isolation: 'isolate',
        '&:hover [data-brand-bag]': LIFT,
      }}
    >
      {/* A soft shadow under the whole silhouette: blurred on a wrapper, so the mask cannot clip the blur away. */}
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, filter: 'blur(2.5px)', transform: 'translateY(1.5px)' }}>
        <Box sx={{ ...silhouette, bgcolor: 'rgba(0, 0, 0, 0.18)' }} />
      </Box>

      {/* The glass. Opaque where there is no backdrop-filter, or the reader turned transparency off. */}
      <Box
        aria-hidden
        sx={{
          ...silhouette,
          background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.8))',
          backdropFilter: 'blur(16px) saturate(160%)',
          WebkitBackdropFilter: 'blur(16px) saturate(160%)',
          '@supports not (backdrop-filter: blur(1px))': { background: '#FFFFFF' },
          '@media (prefers-reduced-transparency: reduce)': { background: '#FFFFFF' },
        }}
      />

      <Box sx={{ position: 'relative', width: MARK, height: MARK, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
        <Box
          component="span"
          data-brand-bag=""
          sx={{
            display: 'inline-flex',
            transition: `transform 0.45s ${SPRING}`,
            // "backwards", not "both": holding the last frame would pin the transform and block the hover lift.
            animation: `adshub-brand-pop 0.6s ${SPRING} 0.1s backwards`,
            '@keyframes adshub-brand-pop': {
              from: { transform: 'scale(0.7) rotate(-12deg)', opacity: 0 },
              to: { transform: 'none', opacity: 1 },
            },
            ...STILL,
          }}
        >
          {/* Already sized for this spot; the optimiser would only re-encode it. */}
          <Image src={logo} alt="" width={22} height={22} loading="eager" unoptimized />
        </Box>
      </Box>
      <Typography
        variant="h5"
        component="span"
        sx={{ position: 'relative', pl: 0.75, pr: 1.5, lineHeight: 1, letterSpacing: '-0.02em', color: INK }}
      >
        {APP_NAME}
      </Typography>

      {/* The band of light, over glass, bag and wordmark alike; overlay brightens whatever it crosses. */}
      <Box
        key={sweep}
        aria-hidden
        sx={{
          ...silhouette,
          mixBlendMode: 'overlay',
          backgroundImage:
            'linear-gradient(105deg, transparent 32%, rgba(255, 255, 255, 0.9) 46%, rgba(255, 255, 255, 0.9) 50%, transparent 64%)',
          backgroundSize: '300% 100%',
          backgroundRepeat: 'no-repeat',
          animation: `adshub-brand-sheen 1.1s ease-in-out ${sweep === 0 ? '0.45s' : '0s'} both`,
          '@keyframes adshub-brand-sheen': {
            from: { backgroundPosition: '100% 0' },
            to: { backgroundPosition: '0% 0' },
          },
          '@media (prefers-reduced-motion: reduce)': { display: 'none' },
        }}
      />
    </Box>
  )

  if (!href) return content

  return (
    <Box
      component={Link}
      href={href}
      aria-label={APP_NAME}
      onFocus={replay}
      sx={{
        textDecoration: 'none',
        display: 'inline-flex',
        borderRadius: `${MARK / 2}px`,
        '&:focus-visible [data-brand-bag]': LIFT,
      }}
    >
      {content}
    </Box>
  )
}
