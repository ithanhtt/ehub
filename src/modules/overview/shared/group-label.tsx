import Typography from '@mui/material/Typography'

/** Names a group of headline numbers, so a source is read before its figures. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="overline" component="h2" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
      {children}
    </Typography>
  )
}
