import { useContext, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import { WalletContext } from '../WalletContext'
import { getWalletService } from '../hooks/useWalletService'

const CONFIRM_WORD = 'remove'

/**
 * Remove the open wallet from this device so another can be created or imported.
 * Funds stay on chain; only the user's backup can bring this wallet back.
 */
export default function RemoveWalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { loginType, managers } = useContext(WalletContext)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const modern = loginType === 'mnemonic'
  let profileCount = 1
  try { profileCount = managers.walletManager?.listProfiles?.()?.length || 1 } catch { }

  useEffect(() => {
    if (open) { setTyped(''); setError('') }
  }, [open])

  const remove = async () => {
    if (typed.trim().toLowerCase() !== CONFIRM_WORD || busy) return
    setBusy(true)
    setError('')
    try {
      await getWalletService().removeWalletFromDevice()
      // Start clean on the welcome screen; the vault asks to unlock first.
      window.location.hash = '#/'
      window.location.reload()
    } catch (e: any) {
      setError(e.message || 'Could not remove the wallet.')
      setBusy(false)
    }
  }

  return <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
    <DialogTitle>Remove this wallet from this device?</DialogTitle>
    <DialogContent>
      <Alert severity="warning" sx={{ mb: 2 }}>
        Your {modern ? 'recovery phrase and keys are' : 'saved keys are'} deleted from this device. Your funds stay on the blockchain, but you can only get them back with {modern ? 'your recovery phrase, backup shares,' : 'your original recovery material'} or a wallet data file.
      </Alert>
      {profileCount > 1 && <Typography variant="body2" sx={{ mb: 1.5 }}>All {profileCount} profiles of this wallet are removed from this device.</Typography>}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Wallet history files stay on this computer. Importing the same wallet again reconnects to them. Afterwards you can create a new wallet or import another one.
      </Typography>
      <Button component={RouterLink} to="/dashboard/settings/backup" onClick={onClose} disabled={busy} size="small" sx={{ mb: 2, px: 0 }}>Back up this wallet first</Button>
      <TextField
        fullWidth
        size="small"
        label={`Type "${CONFIRM_WORD}" to confirm`}
        value={typed}
        onChange={event => setTyped(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') void remove() }}
        disabled={busy}
        autoComplete="off"
      />
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button color="error" variant="contained" onClick={() => void remove()} disabled={busy || typed.trim().toLowerCase() !== CONFIRM_WORD}>
        {busy ? 'Removing…' : 'Remove wallet'}
      </Button>
    </DialogActions>
  </Dialog>
}
