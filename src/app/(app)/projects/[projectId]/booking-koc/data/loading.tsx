import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'

/** Shown at once while the booking data loads: its header, figures, filters and list, as the page lays them out. */
export default function Loading() {
  return (
    <Stack spacing={2.5} aria-busy="true">
      <Box>
        <Skeleton variant="text" width={200} height={36} />
        <Skeleton variant="text" width={380} height={20} />
      </Box>
      <Grid container spacing={1.5}>
        {Array.from({ length: 6 }, (_, i) => (
          <Grid key={i} size={{ xs: 6, md: 2 }}>
            <Skeleton variant="rounded" height={72} />
          </Grid>
        ))}
      </Grid>
      <Skeleton variant="rounded" height={40} />
      <Skeleton variant="rounded" height={420} />
    </Stack>
  )
}
