import type { MetadataRoute } from 'next'
import { APP_NAME } from '@/core/brand'

/** What a phone or desktop uses when EHub is installed as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Trung tâm API cho quảng cáo và đơn hàng',
    lang: 'vi',
    // The root reopens the last project's overview, or lists the projects.
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#1BA36B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
