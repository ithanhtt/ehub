import Box from '@mui/material/Box'
import { requireSystemAdmin } from '@/core/auth/session'
import { db, isEmbeddedDatabase } from '@/core/db/client'
import { titled } from '@/core/metadata'
import { listTables } from '@/modules/system-admin/data/db-inspect'
import { DatabasePanel } from '@/modules/system-admin/ui/database-panel'

export const generateMetadata = titled('system', 'db.title')

/**
 * Database — platform Administrators only: every table with its rows, a
 * row editor for tables with a primary key, and a SQL console that reads by
 * default. Secret columns are masked everywhere (see system-admin/secrets.ts).
 */
export default async function DatabasePage() {
  await requireSystemAdmin()
  const tables = await listTables(db)
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, maxWidth: 1400, mx: 'auto' }}>
      <DatabasePanel initialTables={tables} embedded={isEmbeddedDatabase} />
    </Box>
  )
}
