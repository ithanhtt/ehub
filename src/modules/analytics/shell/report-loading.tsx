import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'

/**
 * What a report page shows the moment it is opened (each report route's
 * loading.tsx): its shape — the title, the period row, the figures and two
 * charts — while the route's server part runs and the report's first answer
 * is on its way. Laid out as the page lays out, so nothing jumps when it lands.
 */
export function ReportLoading() {
  return (
    <Stack spacing={2.5} aria-busy="true">
      <Box>
        <Skeleton variant="text" width={220} height={36} />
        <Skeleton variant="text" width={360} height={20} />
      </Box>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Skeleton variant="rounded" width={260} height={36} />
        <Skeleton variant="rounded" width={140} height={36} />
      </Stack>
      <Grid container spacing={2}>
        {Array.from({ length: 4 }, (_, i) => (
          <Grid key={i} size={{ xs: 6, md: 3 }}>
            <Skeleton variant="rounded" height={112} />
          </Grid>
        ))}
        {Array.from({ length: 2 }, (_, i) => (
          <Grid key={`chart-${i}`} size={{ xs: 12, lg: 6 }}>
            <Skeleton variant="rounded" height={300} />
          </Grid>
        ))}
      </Grid>
    </Stack>
  )
}
