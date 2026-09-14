'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import type { SvgIconComponent } from '@mui/icons-material'
import BoltOutlined from '@mui/icons-material/BoltOutlined'
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined'
import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined'
import GroupOutlined from '@mui/icons-material/GroupOutlined'
import PowerOutlined from '@mui/icons-material/PowerOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import StorageOutlined from '@mui/icons-material/StorageOutlined'
import TuneOutlined from '@mui/icons-material/TuneOutlined'
import { APP_MODULES } from '@/modules'

const ICONS = {
  apiHub: BoltOutlined,
  datasets: StorageOutlined,
  logs: ReceiptLongOutlined,
  connections: PowerOutlined,
  members: GroupOutlined,
  general: TuneOutlined,
} as const

type NavKey = keyof typeof ICONS
/** A menu entry: its label's key in the "nav" messages, where it goes, and its icon. */
type Item = { key: string; href: string; exact?: boolean; icon: SvgIconComponent }

/**
 * Three bands: what people come for (main), the API plumbing, and project
 * settings.
 *
 * The main column lists the app's modules (see src/modules), starting with
 * the overview; each declares its own entry. The API tools — connections, the
 * Hub, datasets, call logs — are setup work someone does once and revisits
 * rarely, so they live folded under Settings rather than in the main column.
 */
function itemsFor(projectId: string): { main: Item[]; api: Item[]; settings: Item[] } {
  const base = `/projects/${projectId}`
  const tool = (key: NavKey, href: string, exact?: boolean): Item => ({ key, href, exact, icon: ICONS[key] })
  return {
    main: APP_MODULES.map(({ nav }) => ({
      key: nav.key,
      href: nav.path ? `${base}/${nav.path}` : base,
      exact: nav.exact,
      icon: nav.icon,
    })),
    api: [
      tool('connections', `${base}/settings/connections`),
      tool('apiHub', `${base}/hub`),
      tool('datasets', `${base}/datasets`),
      tool('logs', `${base}/logs`),
    ],
    settings: [tool('members', `${base}/settings/members`), tool('general', `${base}/settings`, true)],
  }
}

function isActive(pathname: string, item: Item): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href)
}

/** Vertical list for the permanent drawer on wide screens. */
export function ProjectNavList({ projectId }: { projectId: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { main, api, settings } = itemsFor(projectId)
  const apiActive = api.some((item) => isActive(pathname, item))

  // Open while one of its pages is showing, and opened again whenever the
  // user lands on one from elsewhere (a link on the dashboard, say); a manual
  // collapse holds until the next navigation.
  const [group, setGroup] = useState({ path: pathname, open: apiActive })
  if (group.path !== pathname) setGroup({ path: pathname, open: group.open || apiActive })

  const renderItem = (item: Item) => {
    const Icon = item.icon
    const active = isActive(pathname, item)
    return (
      <ListItemButton
        key={item.href}
        component={Link}
        href={item.href}
        selected={active}
        sx={{
          py: 0.75,
          mb: 0.25,
          color: active ? 'primary.main' : 'text.secondary',
          '&:hover': { color: 'text.primary' },
          '&.Mui-selected:hover': { color: 'primary.main' },
        }}
      >
        <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
          <Icon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          slotProps={{
            primary: { variant: 'body2', noWrap: true, sx: { fontWeight: active ? 600 : 500 } },
          }}
        >
          {t(item.key)}
        </ListItemText>
      </ListItemButton>
    )
  }

  return (
    <>
      <List disablePadding>{main.map(renderItem)}</List>
      <Typography
        variant="overline"
        sx={{ display: 'block', px: 2, pt: 2.5, pb: 0.5, color: 'text.disabled' }}
      >
        {t('settings')}
      </Typography>
      <List disablePadding>
        <ListItemButton
          onClick={() => setGroup({ path: pathname, open: !group.open })}
          aria-expanded={group.open}
          sx={{
            py: 0.75,
            mb: 0.25,
            color: apiActive ? 'text.primary' : 'text.secondary',
            '&:hover': { color: 'text.primary' },
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
            <ExtensionOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText
            slotProps={{
              primary: { variant: 'body2', noWrap: true, sx: { fontWeight: apiActive ? 600 : 500 } },
            }}
          >
            {t('apiGroup')}
          </ListItemText>
          <ExpandMoreOutlined
            sx={{
              fontSize: 18,
              color: 'text.disabled',
              transition: 'transform .15s',
              transform: group.open ? 'rotate(180deg)' : 'none',
            }}
          />
        </ListItemButton>
        <Collapse in={group.open}>
          <List disablePadding sx={{ pl: 1.5 }}>
            {api.map(renderItem)}
          </List>
        </Collapse>
        {settings.map(renderItem)}
      </List>
    </>
  )
}

/**
 * Horizontal tabs for narrow screens.
 *
 * A drawer would need a toggle button and open/close state that has to live
 * above both layouts; scrollable tabs give the same reach with none of that,
 * and leave the full width to the Hub's split panes. The API tools sit after
 * the overview, in the same order as the drawer's group.
 */
export function ProjectNavTabs({ projectId }: { projectId: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { main, api, settings } = itemsFor(projectId)
  const all = [...main, ...api, ...settings]

  // Longest match wins, so /settings/connections does not also light up /settings.
  const current =
    all
      .filter((item) => isActive(pathname, item))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? false

  return (
    <Tabs
      value={current}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      sx={{ borderBottom: '1px dashed var(--adshub-dashed)' }}
    >
      {all.map((item) => {
        const Icon = item.icon
        return (
          <Tab
            key={item.href}
            value={item.href}
            component={Link}
            href={item.href}
            icon={<Icon fontSize="small" />}
            iconPosition="start"
            label={t(item.key)}
          />
        )
      })}
    </Tabs>
  )
}
