/**
 * Cold-start gate: unlock or enroll the vault before the wallet tree runs.
 *
 * - hasVault && locked → Unlock (biometrics and/or passphrase)
 * - needsMigration → Enroll (migrate v1 secrets.dat)
 * - vault-needs-enroll event (first secret write) → Enroll
 * - otherwise → children
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
  Alert,
  Stack,
} from '@mui/material'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import LockIcon from '@mui/icons-material/Lock'
import * as secrets from '../services/secrets'

type Mode = 'loading' | 'ready' | 'unlock' | 'enroll'

interface Props {
  children: React.ReactNode
  onReady?: () => void
}

const VaultGate: React.FC<Props> = ({ children, onReady }) => {
  const [mode, setMode] = useState<Mode>('loading')
  const [status, setStatus] = useState<secrets.VaultStatus | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [enableBio, setEnableBio] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const finishReady = useCallback(async () => {
    await secrets.rehydrate()
    setMode('ready')
    onReady?.()
  }, [onReady])

  const refresh = useCallback(async () => {
    try {
      const s = await secrets.vaultStatus()
      setStatus(s)
      if (s.needsMigration) {
        setMode('enroll')
        setEnableBio(s.biometricsAvailable)
      } else if (s.hasVault && s.locked) {
        setMode('unlock')
        setEnableBio(s.biometricsAvailable && s.methods.includes('se'))
      } else {
        // No vault yet (new user) or already unlocked
        if (!s.hasVault) {
          await secrets.hydrate()
          setMode('ready')
          onReady?.()
        } else {
          await finishReady()
        }
      }
    } catch (err: any) {
      console.error('[VaultGate] status failed:', err)
      setError(err?.message || 'Failed to read vault status')
      setMode('unlock')
    }
  }, [finishReady, onReady])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onNeedsEnroll = () => {
      setMode((m) => (m === 'ready' ? 'enroll' : m))
      setError(null)
    }
    window.addEventListener('vault-needs-enroll', onNeedsEnroll)
    return () => window.removeEventListener('vault-needs-enroll', onNeedsEnroll)
  }, [])

  const handleUnlockPassphrase = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await secrets.unlockWithPassphrase(passphrase)
      if (r.ok === false) {
        setError(r.error)
        return
      }
      setPassphrase('')
      await finishReady()
    } catch (err: any) {
      setError(err?.message || 'Unlock failed')
    } finally {
      setBusy(false)
    }
  }

  const handleUnlockBiometrics = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await secrets.unlockWithBiometrics()
      if (r.ok === false) {
        setError(r.error)
        return
      }
      await finishReady()
    } catch (err: any) {
      setError(err?.message || 'Biometric unlock failed')
    } finally {
      setBusy(false)
    }
  }

  const handleEnroll = async () => {
    if (passphrase.length < 8) {
      setError('Unlock passphrase must be at least 8 characters.')
      return
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await secrets.enrollVault({
        passphrase,
        enableBiometrics: enableBio && !!status?.biometricsAvailable,
        initialSecrets: secrets.cacheSnapshot(),
      })
      if (r.ok === false) {
        setError(r.error)
        return
      }
      setPassphrase('')
      setConfirm('')
      await finishReady()
    } catch (err: any) {
      setError(err?.message || 'Enrollment failed')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'loading') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  // Keep children mounted whenever possible so WalletService React subscriptions
  // stay attached and in-flight login is not torn down by enroll/unlock UI.
  const isEnroll = mode === 'enroll'
  const isUnlock = mode === 'unlock'
  const showGate = isEnroll || isUnlock
  const showBioUnlock =
    isUnlock &&
    !!status?.biometricsAvailable &&
    !!status?.methods?.includes('se')

  return (
    <>
      {(mode === 'ready' || isEnroll) && children}
      {showGate && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: (t) => t.zIndex.modal + 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 2,
            bgcolor: 'background.default',
          }}
        >
          <Paper elevation={3} sx={{ p: 4, maxWidth: 440, width: '100%' }}>
            <Stack spacing={2} alignItems="stretch">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LockIcon color="primary" />
                <Typography variant="h5" component="h1">
                  {isEnroll ? 'Protect your wallet' : 'Unlock wallet'}
                </Typography>
              </Box>

              <Typography variant="body2" color="text.secondary">
                {isEnroll
                  ? 'Create an unlock passphrase for this device. This is separate from your wallet password or recovery key. When available, biometrics can unlock the vault on launch.'
                  : 'Your wallet secrets are encrypted. Unlock with biometrics or your device unlock passphrase to continue.'}
              </Typography>

              {error && <Alert severity="error">{error}</Alert>}

              {showBioUnlock && (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<FingerprintIcon />}
                  onClick={handleUnlockBiometrics}
                  disabled={busy}
                >
                  Unlock with Touch ID
                </Button>
              )}

              <TextField
                label="Unlock passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                fullWidth
                autoComplete={isEnroll ? 'new-password' : 'current-password'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isEnroll) void handleUnlockPassphrase()
                }}
              />

              {isEnroll && (
                <>
                  <TextField
                    label="Confirm passphrase"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    fullWidth
                    autoComplete="new-password"
                  />
                  {status?.biometricsAvailable && (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={enableBio}
                          onChange={(e) => setEnableBio(e.target.checked)}
                        />
                      }
                      label="Enable Touch ID unlock on this device"
                    />
                  )}
                  {!status?.biometricsAvailable && (
                    <Alert severity="info">
                      No biometric secure element is available on this device. You will unlock with your passphrase only.
                    </Alert>
                  )}
                  {status?.needsMigration && (
                    <Alert severity="warning">
                      Existing wallet data will be re-encrypted into a protected vault. You must set a passphrase to continue.
                    </Alert>
                  )}
                </>
              )}

              <Button
                variant={showBioUnlock ? 'outlined' : 'contained'}
                size="large"
                onClick={isEnroll ? handleEnroll : handleUnlockPassphrase}
                disabled={busy || !passphrase}
              >
                {busy ? <CircularProgress size={22} /> : isEnroll ? 'Create vault' : 'Unlock with passphrase'}
              </Button>
            </Stack>
          </Paper>
        </Box>
      )}
    </>
  )
}

export default VaultGate
