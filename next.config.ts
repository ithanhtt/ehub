import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // PGlite ships a WASM build of Postgres. It must stay outside the bundler
  // and be required at runtime from node_modules, otherwise the .wasm/.data
  // assets are not resolvable on the server.
  serverExternalPackages: ['@electric-sql/pglite'],
}

export default withNextIntl(nextConfig)
