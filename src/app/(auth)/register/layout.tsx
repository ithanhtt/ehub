import { getTranslations } from 'next-intl/server'
import Alert from '@mui/material/Alert'
import { titled } from '@/core/metadata'
import { maintenanceState } from '@/modules/site-settings/data/settings'

// The page is a client component, which cannot name itself; its layout does.
export const generateMetadata = titled('auth', 'registerTitle')

/** No new accounts while the app is closed for maintenance: the notice above the form says why. */
export default async function RegisterLayout({ children }: { children: React.ReactNode }) {
  if ((await maintenanceState()).active) {
    const t = await getTranslations('siteSettings.notice')
    return <Alert severity="info">{t('registerClosed')}</Alert>
  }
  return children
}
