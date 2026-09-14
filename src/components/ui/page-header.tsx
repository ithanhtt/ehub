import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

/**
 * The two layout pieces repeated on nearly every screen.
 *
 * Everything else in the app composes MUI components directly — wrapping them
 * would add a layer that only re-exports. These two earn their place because
 * they carry spacing and hierarchy decisions that must not drift page to page.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ mb: 3, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h3" component="h1">
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" sx={{ mt: 0.5, maxWidth: 720, color: 'text.secondary' }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Stack>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        px: 3,
        py: 8,
        border: '1px dashed var(--adshub-dashed)',
        borderRadius: 2,
      }}
    >
      {icon ? <Box sx={{ mb: 1.5, color: 'text.disabled', display: 'flex' }}>{icon}</Box> : null}
      <Typography variant="subtitle2">{title}</Typography>
      {description ? (
        <Typography variant="body2" sx={{ mt: 0.75, maxWidth: 440, color: 'text.secondary' }}>
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ mt: 2.5 }}>{action}</Box> : null}
    </Box>
  )
}
