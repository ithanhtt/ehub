'use client'

import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import OpenInFullOutlined from '@mui/icons-material/OpenInFullOutlined'

/** The one "view it large" control every overview card carries, always in the same corner. */
export function ExpandButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={onClick}>
        <OpenInFullOutlined sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  )
}
