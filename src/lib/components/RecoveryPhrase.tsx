import { Box, Typography } from '@mui/material'

export default function RecoveryPhrase({ phrase }: { phrase: string }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' }, gap: 1.25 }}>
      {phrase.trim().split(/\s+/).map((word, index) => (
        <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.35, bgcolor: 'action.hover', borderRadius: 2 }}>
          <Typography sx={{ width: 18, color: 'text.secondary', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{index + 1}</Typography>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{word}</Typography>
        </Box>
      ))}
    </Box>
  )
}
