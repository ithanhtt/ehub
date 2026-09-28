import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import Box from '@mui/material/Box'
import CssBaseline from '@mui/material/CssBaseline'
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript'
import { ThemeProvider } from '@mui/material/styles'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { AmbientBackground } from '@/components/layout/ambient-background'
import { SiteCorner } from '@/modules/site-settings/ui/site-corner'
import { APP_NAME } from '@/core/brand'
import theme from '@/theme'

// The vietnamese subset is not optional here: without it every diacritic in
// the UI falls back to a different face and the text looks visibly patched.
const inter = Inter({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  display: 'swap',
  variable: '--adshub-font-sans',
})

// Icons come from the files beside this layout (favicon.ico, icon.png, apple-icon.png) and manifest.ts.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common')
  return {
    // Pages name themselves ("Dự án"); the template adds " · EHub" to the tab.
    title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
    description: t('tagline'),
    applicationName: APP_NAME,
    appleWebApp: { title: APP_NAME },
  }
}

export const viewport: Viewport = {
  // Tells the browser to theme its own chrome per scheme, and keeps the
  // rendered colour-scheme consistent before hydration.
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1BA36B' },
    { media: '(prefers-color-scheme: dark)', color: '#080D0B' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <body>
        {/*
          Runs before React hydrates and stamps data-mui-color-scheme onto
          <html> from the stored preference. This is what prevents a light
          flash for a dark-mode visitor: the CSS variables are already
          switched by the time the first paint happens.
        */}
        <InitColorSchemeScript attribute="data-mui-color-scheme" defaultMode="system" />
        <AppRouterCacheProvider options={{ key: 'mui', enableCssLayer: true }}>
          <ThemeProvider theme={theme} defaultMode="system" disableTransitionOnChange>
            <CssBaseline />
            <AmbientBackground />
            {/* Sits above the fixed wash so the frosted cards blur it. */}
            <Box sx={{ position: 'relative', zIndex: 1 }}>
              <NextIntlClientProvider locale={locale} messages={messages}>
                {children}
              </NextIntlClientProvider>
            </Box>
            <SiteCorner placement="floating" />
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}
