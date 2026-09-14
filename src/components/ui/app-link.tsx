'use client'

import NextLink from 'next/link'
import MuiLink, { type LinkProps } from '@mui/material/Link'

/**
 * A text link that does client-side navigation.
 *
 * MUI components are Client Components, so a Server Component cannot pass
 * `component={NextLink}` to one — React would have to serialise a function
 * across the RSC boundary and refuses. Doing the composition here, inside a
 * client module, means server pages only ever pass plain props.
 *
 * Buttons do not need this: the theme sets NextLink as ButtonBase's
 * LinkComponent, so anything button-shaped only needs `href`.
 */
export function AppLink(props: LinkProps<typeof NextLink>) {
  return <MuiLink component={NextLink} {...props} />
}
