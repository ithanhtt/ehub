'use client'

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import DnsOutlined from '@mui/icons-material/DnsOutlined'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import SystemUpdateAltOutlined from '@mui/icons-material/SystemUpdateAltOutlined'

/**
 * The admin area's tab bar: System, Database, System update. Plain links —
 * the theme gives ButtonBase NextLink, so a Tab with an href navigates
 * client-side — with the tab under the current path marked.
 */
const TABS = [
  { href: '/admin/system', key: 'system', icon: <DnsOutlined fontSize="small" /> },
  { href: '/admin/database', key: 'database', icon: <StorageOutlined fontSize="small" /> },
  { href: '/admin/updates', key: 'updates', icon: <SystemUpdateAltOutlined fontSize="small" /> },
] as const

export function AdminTabs() {
  const t = useTranslations('system')
  const pathname = usePathname()
  const current = TABS.find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))?.href ?? false

  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ px: { xs: 1, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
        <Tabs value={current} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label={t('tabs.label')}>
          {TABS.map((tab) => (
            <Tab
              key={tab.href}
              value={tab.href}
              href={tab.href}
              icon={tab.icon}
              iconPosition="start"
              label={tab.key === 'system' ? t('tabs.system') : tab.key === 'database' ? t('tabs.database') : t('tabs.updates')}
              sx={{ minHeight: 48 }}
            />
          ))}
        </Tabs>
      </Box>
    </Box>
  )
}
