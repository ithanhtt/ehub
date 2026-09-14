'use client'

import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import SyncOutlined from '@mui/icons-material/SyncOutlined'

/**
 * "Syncing" beside a card's title, while the data behind it is still being
 * fetched and may be short. Warning-toned, with an icon and a word — never
 * color alone — and the reason on hover.
 */
export function SyncChip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip title={tip}>
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        icon={<SyncOutlined />}
        label={label}
        aria-label={tip}
        sx={{ height: 20, flexShrink: 0, '& .MuiChip-label': { px: 0.75, fontSize: '0.6875rem', fontWeight: 700 }, '& .MuiChip-icon': { fontSize: 14 } }}
      />
    </Tooltip>
  )
}
