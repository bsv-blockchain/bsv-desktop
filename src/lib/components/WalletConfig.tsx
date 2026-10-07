import { Box, Button, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'

interface WalletConfigProps {
  autoExpand?: boolean
  hideLoginType?: boolean
  open?: boolean
  onToggle?: () => void
}

/** Compatibility export: configuration now belongs to the running wallet's Settings screen. */
export default function WalletConfig({ open = true }: WalletConfigProps) {
  if (!open) return null
  return <Box sx={{ p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
    <Typography variant="h6" sx={{ mb: 1 }}>Ready by default</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>New wallets use Mainnet, local storage, and Message Box payments. You can change networks and service URLs any time in Settings.</Typography>
    <Button component={RouterLink} to="/dashboard/settings" variant="outlined">Open settings</Button>
  </Box>
}
