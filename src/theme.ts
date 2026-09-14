'use client'

import NextLink from 'next/link'
import { createTheme, alpha } from '@mui/material/styles'

/**
 * The single source of truth for how AdsHub looks.
 *
 * Design language, matching the reference screens:
 *
 *  · Jade green as the one accent, used for the header, section titles and
 *    every affirmative state.
 *  · Flat surfaces — no borders, no drop shadows. Cards separate from the page
 *    by tone alone, which is what makes the layout read as calm at this
 *    information density.
 *  · Frosted glass — cards are slightly translucent over a soft blurred wash
 *    (see components/layout/ambient-background.tsx), so the colour behind them
 *    bleeds through instead of sitting in a flat rectangle.
 *  · Generous corner radius and dashed rules inside cards.
 *
 * Built on MUI's CSS-variable theming (`cssVariables` + `colorSchemes`): every
 * colour becomes a CSS custom property, so both palettes ship in the
 * stylesheet and switching is an attribute change on <html> — no React
 * re-render, and no flash of the wrong theme on first paint.
 */

const FONT_STACK = [
  'var(--adshub-font-sans)',
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',')

const MONO_STACK = [
  'ui-monospace',
  '"Cascadia Code"',
  '"Source Code Pro"',
  'Menlo',
  'Consolas',
  '"DejaVu Sans Mono"',
  'monospace',
].join(',')

/** Radii are set per component rather than derived, so small controls stay crisp. */
const RADIUS = { card: 18, control: 10, inset: 14, dialog: 22, chip: 8 }

/**
 * Opacity of the card fill.
 *
 * High enough that body text keeps its contrast over the ambient wash, low
 * enough that the wash is still visible through the surface. Dropping much
 * below this trades legibility for decoration.
 */
const GLASS = { light: 0.82, dark: 0.72, floating: 0.94 }

const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },

  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#1BA36B', light: '#4CC291', dark: '#127A50', contrastText: '#FFFFFF' },
        secondary: { main: '#3B82F6' },
        success: { main: '#159A62' },
        warning: { main: '#B4690E' },
        error: { main: '#D93A3A' },
        info: { main: '#3B82F6' },
        // Neutral warm grey ground, as in the reference; the colour comes from
        // the ambient wash rather than from the page background itself.
        background: { default: '#EFF1F0', paper: '#FFFFFF' },
        text: { primary: '#1A1F1C', secondary: '#5D6763', disabled: '#8C9691' },
        divider: '#E3E7E5',
      },
    },

    dark: {
      palette: {
        primary: { main: '#3FD397', light: '#7BE3BA', dark: '#1BA36B', contrastText: '#06120C' },
        secondary: { main: '#60A5FA' },
        success: { main: '#4ADE80' },
        warning: { main: '#FBBF24' },
        error: { main: '#F87171' },
        info: { main: '#60A5FA' },
        // Near-black with a green cast rather than pure black: pure #000 makes
        // the frosted surfaces impossible to read and looks harsh on OLED.
        background: { default: '#080D0B', paper: '#121A16' },
        text: { primary: '#E9EFEB', secondary: '#9AA8A1', disabled: '#6B7873' },
        divider: '#1F2A25',
      },
    },
  },

  shape: { borderRadius: 10 },

  typography: {
    fontFamily: FONT_STACK,
    fontSize: 14,
    h1: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h4: { fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontSize: '0.9375rem', fontWeight: 700 },
    h6: { fontSize: '0.875rem', fontWeight: 700 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.8125rem', lineHeight: 1.65 },
    caption: { fontSize: '0.75rem' },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    overline: { fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em' },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        /*
         * Tokens the palette has no slot for. Declared as plain CSS variables
         * per scheme rather than through palette augmentation: they are only
         * ever read from `sx`, and this keeps them switching with the theme
         * without a module declaration to maintain.
         *
         * next/font owns --adshub-font-sans; declaring it here too would make
         * which definition wins depend on stylesheet order.
         */
        ':root': {
          colorScheme: 'light',
          '--adshub-surface-inset': '#F4F6F5',
          '--adshub-surface-glass': `rgba(255, 255, 255, ${GLASS.light})`,
          '--adshub-surface-floating': `rgba(255, 255, 255, ${GLASS.floating})`,
          '--adshub-dashed': '#D6DBD8',
          '--adshub-soft-tint': 'rgba(27, 163, 107, 0.10)',
          '--adshub-blob-a': 'rgba(27, 163, 107, 0.20)',
          '--adshub-blob-b': 'rgba(76, 194, 145, 0.16)',
          '--adshub-blob-c': 'rgba(244, 190, 140, 0.14)',
          '--adshub-header-overlay': 'rgba(255, 255, 255, 0.13)',
          '--adshub-scrollbar': 'rgba(26, 31, 28, 0.2)',
          '--adshub-scrollbar-hover': 'rgba(26, 31, 28, 0.36)',
          // Chart series: slots 1–3 of the dataviz reference palette, validated
          // all-pairs on the light card surface (CVD ΔE 9.2, normal-vision 24.0).
          // Slot 3 sits at 2.82:1 here, so every chart using it offers a table
          // view with the exact figures.
          '--adshub-series-1': '#2a78d6',
          '--adshub-series-2': '#eb6834',
          '--adshub-series-3': '#1baf7a',
          // Sequential ramp for magnitude (the heatmap): one hue, light to dark,
          // steps 150–600 of the reference blue; 0 is an empty cell.
          '--adshub-seq-0': '#EDF0EE',
          '--adshub-seq-1': '#cde2fb',
          '--adshub-seq-2': '#9ec5f4',
          '--adshub-seq-3': '#6da7ec',
          '--adshub-seq-4': '#3987e5',
          '--adshub-seq-5': '#256abf',
          '--adshub-seq-6': '#184f95',
        },
        '[data-mui-color-scheme="dark"]': {
          colorScheme: 'dark',
          '--adshub-surface-inset': '#18211D',
          '--adshub-surface-glass': `rgba(18, 26, 22, ${GLASS.dark})`,
          '--adshub-surface-floating': `rgba(20, 29, 24, ${GLASS.floating})`,
          '--adshub-dashed': '#2A362F',
          '--adshub-soft-tint': 'rgba(63, 211, 151, 0.14)',
          '--adshub-blob-a': 'rgba(27, 163, 107, 0.26)',
          '--adshub-blob-b': 'rgba(45, 212, 191, 0.16)',
          '--adshub-blob-c': 'rgba(180, 105, 14, 0.14)',
          '--adshub-header-overlay': 'rgba(255, 255, 255, 0.09)',
          '--adshub-scrollbar': 'rgba(233, 239, 235, 0.18)',
          '--adshub-scrollbar-hover': 'rgba(233, 239, 235, 0.32)',
          // The same three hues stepped for the dark card surface (validated there, not flipped).
          '--adshub-series-1': '#3987e5',
          '--adshub-series-2': '#d95926',
          '--adshub-series-3': '#199e70',
          // The same ramp selected for the dark surface: few orders recede into
          // it, many come forward light.
          '--adshub-seq-0': '#1B2520',
          '--adshub-seq-1': '#104281',
          '--adshub-seq-2': '#1c5cab',
          '--adshub-seq-3': '#2a78d6',
          '--adshub-seq-4': '#5598e7',
          '--adshub-seq-5': '#86b6ef',
          '--adshub-seq-6': '#b7d3f6',
        },

        /*
         * Some people disable transparency at the OS level, and some browsers
         * have no backdrop-filter. Both need an opaque fallback, or the
         * frosted cards turn into unreadable washes.
         */
        '@media (prefers-reduced-transparency: reduce)': {
          ':root': {
            '--adshub-surface-glass': '#FFFFFF',
            '--adshub-surface-floating': '#FFFFFF',
          },
          '[data-mui-color-scheme="dark"]': {
            '--adshub-surface-glass': '#121A16',
            '--adshub-surface-floating': '#141D18',
          },
        },
        '@supports not (backdrop-filter: blur(1px))': {
          ':root': { '--adshub-surface-glass': 'rgba(255, 255, 255, 0.96)' },
          '[data-mui-color-scheme="dark"]': { '--adshub-surface-glass': 'rgba(18, 26, 22, 0.96)' },
        },

        html: { WebkitFontSmoothing: 'antialiased', height: '100%' },
        body: { height: '100%' },

        /*
         * Scrollbars: a soft rounded thumb, no track, no arrow buttons.
         *
         * Chromium ignores every ::-webkit-scrollbar rule on an element once
         * scrollbar-width or scrollbar-color applies to it (Chrome 121+) and
         * draws the raw system bar, arrows included. The standard properties
         * are therefore fenced off to Firefox, the one engine that needs them.
         */
        '*::-webkit-scrollbar': { width: 12, height: 12 },
        '*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          borderRadius: 999,
          // The transparent border insets the thumb so it floats clear of the edge.
          border: '3px solid transparent',
          backgroundClip: 'padding-box',
          backgroundColor: 'var(--adshub-scrollbar)',
        },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: 'var(--adshub-scrollbar-hover)' },
        '@supports (-moz-appearance: none)': {
          '*': { scrollbarWidth: 'thin', scrollbarColor: 'var(--adshub-scrollbar) transparent' },
        },
      },
    },

    // Anything button-shaped (Button, IconButton, CardActionArea,
    // ListItemButton, Tab) routes through ButtonBase, so setting the link
    // component once here makes `href` do client-side navigation everywhere —
    // including from Server Components, which cannot pass one themselves.
    MuiButtonBase: {
      defaultProps: { LinkComponent: NextLink },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: RADIUS.control, paddingInline: 16 },
        sizeSmall: { paddingInline: 12 },
        // Flat design: an outlined button is a 1px rule and green text, never
        // a filled pill with a shadow.
        outlined: { borderWidth: 1.5, '&:hover': { borderWidth: 1.5 } },
      },
    },

    MuiIconButton: {
      styleOverrides: { root: { borderRadius: RADIUS.control } },
    },

    /*
     * The frosted surface.
     *
     * Every Paper is translucent and blurs what is behind it, which is what
     * lets the ambient wash show through the cards instead of stopping at
     * their edges. `variant="outlined"` is repurposed as the inset tonal
     * surface from the reference — a flat grey block, no rule.
     */
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: 'none',
          borderRadius: RADIUS.card,
          backgroundColor: 'var(--adshub-surface-glass)',
          backdropFilter: 'blur(14px) saturate(150%)',
        },
        outlined: {
          backgroundColor: 'var(--adshub-surface-inset)',
          backdropFilter: 'none',
          borderRadius: RADIUS.inset,
        },
        // Menus and popovers float over content, so they need to stay legible.
        elevation8: {
          backgroundColor: 'var(--adshub-surface-floating)',
          backdropFilter: 'blur(20px) saturate(160%)',
          boxShadow: '0 18px 44px -22px rgb(0 0 0 / 0.34)',
        },
      },
    },

    MuiCard: {
      styleOverrides: { root: { overflow: 'visible' } },
    },

    /*
     * Card titles are the green uppercase section labels from the reference.
     * A dashed rule closes the header, which is the app's signature divider.
     */
    MuiCardHeader: {
      defaultProps: {
        slotProps: {
          title: { variant: 'subtitle2' },
          subheader: { variant: 'caption' },
        },
      },
      styleOverrides: {
        root: ({ theme: t }) => ({
          padding: t.spacing(2, 2.5),
          borderBottom: '1px dashed var(--adshub-dashed)',
        }),
        title: ({ theme: t }) => ({
          color: t.vars ? t.vars.palette.primary.main : t.palette.primary.main,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontSize: '0.75rem',
          fontWeight: 700,
        }),
      },
    },

    MuiCardContent: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          padding: t.spacing(2.5),
          '&:last-child': { paddingBottom: t.spacing(2.5) },
        }),
      },
    },

    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS.control,
          backgroundColor: 'var(--adshub-surface-inset)',
          // Flat inputs: a tonal fill carries the field, and the outline only
          // appears on hover and focus.
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--adshub-dashed)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1.5 },
        },
        input: { '&::placeholder': { opacity: 0.55 } },
      },
    },

    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.875rem' } } },
    MuiFormHelperText: { styleOverrides: { root: { marginLeft: 0, fontSize: '0.75rem' } } },

    MuiDivider: {
      styleOverrides: {
        root: { borderColor: 'var(--adshub-dashed)' },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: RADIUS.chip, fontWeight: 700 },
        sizeSmall: { height: 22, fontSize: '0.6875rem' },
        outlined: { borderColor: 'var(--adshub-dashed)' },
      },
      /*
       * Soft tonal chips rather than saturated fills — the reference uses a
       * pale green block with a deep green label.
       *
       * `variants` matches on props. MUI v9 dropped the compound class keys
       * (there is no `filledPrimary` any more), so prop matching is now the
       * way to style a variant/colour combination.
       */
      variants: [
        {
          props: { variant: 'filled', color: 'primary' },
          style: {
            backgroundColor: 'var(--adshub-soft-tint)',
            color: 'var(--mui-palette-primary-dark)',
          },
        },
        {
          props: { variant: 'filled', color: 'success' },
          style: {
            backgroundColor: 'rgba(var(--mui-palette-success-mainChannel) / 0.14)',
            color: 'var(--mui-palette-success-main)',
          },
        },
        {
          props: { variant: 'filled', color: 'error' },
          style: {
            backgroundColor: 'rgba(var(--mui-palette-error-mainChannel) / 0.14)',
            color: 'var(--mui-palette-error-main)',
          },
        },
        {
          props: { variant: 'filled', color: 'warning' },
          style: {
            backgroundColor: 'rgba(var(--mui-palette-warning-mainChannel) / 0.16)',
            color: 'var(--mui-palette-warning-main)',
          },
        },
      ],
    },

    MuiTab: {
      styleOverrides: {
        root: { minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.8125rem' },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44 },
        indicator: { height: 2.5, borderRadius: 2 },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: '1px dashed var(--adshub-dashed)', fontSize: '0.8125rem' },
        head: ({ theme: t }) => ({
          fontWeight: 700,
          fontSize: '0.6875rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: t.vars ? t.vars.palette.text.secondary : t.palette.text.secondary,
          backgroundColor: 'transparent',
        }),
        // A header pinned over rows scrolling beneath it needs an opaque fill, or the two lines of
        // text show through each other: the paper tone, which the frosted cards sit closest to.
        stickyHeader: ({ theme: t }) => ({
          backgroundColor: t.vars ? t.vars.palette.background.paper : t.palette.background.paper,
        }),
      },
    },

    MuiAlert: {
      defaultProps: { variant: 'standard' },
      styleOverrides: {
        root: {
          borderRadius: RADIUS.inset,
          fontSize: '0.8125rem',
          alignItems: 'flex-start',
          border: 'none',
        },
        icon: { paddingTop: 9 },
      },
      /*
       * One tint strength for all four severities.
       *
       * MUI's own standard backgrounds are mixed per palette colour and come
       * out at visibly different weights, which reads as inconsistent next to
       * flat cards. A single 13% wash of each severity's own hue keeps the
       * alerts a family while still colour-coding them.
       *
       * These land after the frosted fill that MuiPaper.root sets (Alert is
       * built on Paper), which is what lets them take effect.
       */
      variants: (
        [
          ['error', 'error'],
          ['warning', 'warning'],
          ['info', 'info'],
          ['success', 'success'],
        ] as const
      ).map(([severity, tone]) => ({
        props: { severity, variant: 'standard' as const },
        style: {
          backgroundColor: `rgba(var(--mui-palette-${tone}-mainChannel) / 0.13)`,
          color: `var(--mui-palette-${tone}-main)`,
        },
      })),
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS.control,
          '&.Mui-selected': { backgroundColor: 'var(--adshub-soft-tint)' },
          '&.Mui-selected:hover': { backgroundColor: 'var(--adshub-soft-tint)' },
        },
      },
    },

    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: { tooltip: { fontSize: '0.75rem', borderRadius: 8 } },
    },

    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999 } } },
    MuiSwitch: { defaultProps: { color: 'primary' } },

    MuiDialog: {
      defaultProps: { fullWidth: true, maxWidth: 'sm' },
      styleOverrides: {
        paper: { backgroundImage: 'none', borderRadius: RADIUS.dialog },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        dividers: { borderTop: '1px dashed var(--adshub-dashed)', borderBottom: 'none' },
      },
    },

    /*
     * A solid green header with two faint light discs, as in the reference.
     * The discs are gradients rather than elements so the AppBar stays a
     * single node and nothing can overlap the toolbar content.
     */
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'primary' },
      styleOverrides: {
        colorPrimary: ({ theme: t }) => ({
          zIndex: t.zIndex.drawer + 1,
          border: 'none',
          backgroundColor: t.vars ? t.vars.palette.primary.main : t.palette.primary.main,
          backgroundImage: `
            radial-gradient(circle at 78% -40%, var(--adshub-header-overlay) 0 42%, transparent 43%),
            radial-gradient(circle at 92% 130%, var(--adshub-header-overlay) 0 30%, transparent 31%),
            radial-gradient(circle at 14% 160%, var(--adshub-header-overlay) 0 22%, transparent 23%)
          `,
          color: t.vars ? t.vars.palette.primary.contrastText : t.palette.primary.contrastText,
          backdropFilter: 'none',
        }),
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: { border: 'none', borderRadius: 0, backgroundColor: 'transparent', backdropFilter: 'none' },
      },
    },

    MuiAvatar: {
      styleOverrides: {
        rounded: { borderRadius: 12 },
      },
    },

    MuiSkeleton: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          backgroundColor: t.vars
            ? `rgba(${t.vars.palette.text.primaryChannel} / 0.07)`
            : alpha(t.palette.text.primary, 0.07),
        }),
      },
    },
  },
})

export { MONO_STACK, RADIUS }
export default theme
