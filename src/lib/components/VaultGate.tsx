/**
 * Cold-start gate: unlock or enroll the vault before the wallet tree runs.
 *
 * - hasVault && locked → Unlock (biometrics and/or passphrase)
 * - needsMigration → Enroll (migrate v1 secrets.dat)
 * - vault-needs-enroll event (first secret write) → Enroll
 * - otherwise → children
 *
 * Styled to match Greeter / AppThemeProvider. VaultGate mounts above the
 * wallet tree (and often before AppThemeProvider), so it carries its own
 * ThemeProvider using the same palette tokens as Theme.tsx.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  CssBaseline,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
  Alert,
  Stack,
  ThemeProvider,
  createTheme,
  useMediaQuery,
  InputAdornment,
  IconButton,
} from '@mui/material'
import type { PaletteMode } from '@mui/material'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import AppLogo from './AppLogo'
import * as secrets from '../services/secrets'

type Mode = 'loading' | 'ready' | 'unlock' | 'enroll'

interface Props {
  children: React.ReactNode
  onReady?: () => void
  appName?: string
}

/** Mirror of AppThemeProvider palette so unlock UI matches the rest of the app. */
function buildVaultTheme(mode: PaletteMode) {
  const dark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#93B4F4' : '#1B365D', contrastText: dark ? '#0D1B3A' : '#FFFFFF' },
      background: { default: dark ? '#0F172A' : '#F5F7FB', paper: dark ? '#172238' : '#FFFFFF' },
      text: { primary: dark ? '#EEF2FA' : '#1E293B', secondary: dark ? '#A8B5CC' : '#607086' },
      divider: dark ? '#2B3953' : '#E2E8F0',
    },
    shape: { borderRadius: 12 },
    typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    components: {
      MuiButton: { styleOverrides: { root: { textTransform: 'none', borderRadius: 12, fontWeight: 600, boxShadow: 'none', '&:hover': { boxShadow: 'none' } } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
    },
  })
}

function resolveMode(prefersDark: boolean): PaletteMode {
  try {
    const cached = localStorage.getItem('userTheme')
    if (cached === 'light' || cached === 'dark') return cached
  } catch {
    // ignore
  }
  return prefersDark ? 'dark' : 'light'
}

const VaultGate: React.FC<Props> = ({ children, onReady, appName = 'BSV Desktop' }) => {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const mode = useMemo(() => resolveMode(prefersDark), [prefersDark])
  const theme = useMemo(() => buildVaultTheme(mode), [mode])

  const [gateMode, setGateMode] = useState<Mode>('loading')
  const [status, setStatus] = useState<secrets.VaultStatus | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [enableBio, setEnableBio] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const finishReady = useCallback(async () => {
    await secrets.rehydrate()
    setGateMode('ready')
    onReady?.()
  }, [onReady])

  const refresh = useCallback(async () => {
    try {
      const s = await secrets.vaultStatus()
      setStatus(s)
      if (s.needsMigration) {
        setGateMode('enroll')
        setEnableBio(s.biometricsAvailable)
      } else if (s.hasVault && s.locked) {
        setGateMode('unlock')
        setEnableBio(s.biometricsAvailable && s.methods.includes('se'))
      } else {
        if (!s.hasVault) {
          await secrets.hydrate()
          setGateMode('ready')
          onReady?.()
        } else {
          await finishReady()
        }
      }
    } catch (err: any) {
      console.error('[VaultGate] status failed:', err)
      setError(err?.message || 'Failed to read vault status')
      setGateMode('unlock')
    }
  }, [finishReady, onReady])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onNeedsEnroll = () => {
      setGateMode((m) => (m === 'ready' ? 'enroll' : m))
      setError(null)
    }
    const onLocked = () => {
      // Logout / lock: show unlock (biometrics or passphrase), never re-enroll.
      setPassphrase('')
      setConfirm('')
      setError(null)
      setGateMode('unlock')
      void secrets.vaultStatus().then((s) => {
        setStatus(s)
        setEnableBio(s.biometricsAvailable && s.methods.includes('se'))
        // If vault was destroyed somehow, fall back to enroll only when truly missing.
        if (!s.hasVault) {
          setGateMode(s.needsMigration ? 'enroll' : 'ready')
        }
      })
    }
    window.addEventListener('vault-needs-enroll', onNeedsEnroll)
    window.addEventListener('vault-locked', onLocked)
    return () => {
      window.removeEventListener('vault-needs-enroll', onNeedsEnroll)
      window.removeEventListener('vault-locked', onLocked)
    }
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
      setError('Use at least 8 characters for your device password.')
      return
    }
    if (passphrase !== confirm) {
      setError('Device passwords do not match.')
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

  const isEnroll = gateMode === 'enroll'
  const isUnlock = gateMode === 'unlock'
  const showGate = isEnroll || isUnlock || gateMode === 'loading'
  const showBioUnlock =
    isUnlock &&
    !!status?.biometricsAvailable &&
    !!status?.methods?.includes('se')

  const accent = mode === 'dark' ? '#93B4F4' : '#1B365D'
  const logoColor = accent

  const gatePanel = (
    <Container
      maxWidth="sm"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        py: 3,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 4 },
          borderRadius: 4,
          bgcolor: 'background.paper',
          border: mode === 'dark' ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 20px 70px rgba(15, 23, 42, 0.06)',
        }}
      >
        {/* Header — matches Greeter */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box sx={{ mb: 2, width: 80, height: 80 }}>
            <AppLogo size="80px" color={logoColor} />
          </Box>
          <Typography
            variant="h2"
            fontFamily="inherit"
            fontSize="1.75em"
            sx={{
              mb: 0.5,
              fontWeight: 750,
              letterSpacing: -0.8,
            }}
          >
            {appName}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, color: 'text.secondary' }}>
            <LockOutlinedIcon sx={{ fontSize: 16, color: accent }} />
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              {gateMode === 'loading'
                ? 'Loading…'
                : isEnroll
                  ? 'Protect your wallet'
                  : 'Unlock wallet'}
            </Typography>
          </Box>
        </Box>

        {gateMode === 'loading' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress sx={{ color: accent }} />
          </Box>
        ) : (
          <Stack spacing={2.5} alignItems="stretch">
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', lineHeight: 1.6 }}>
              {isEnroll
                ? 'Choose a password to protect your wallet on this computer. Your recovery phrase restores your wallet on other devices.'
                : 'Your wallet is protected on this computer. Unlock it to pick up where you left off.'}
            </Typography>

            {error && (
              <Alert
                severity="error"
                sx={{
                  bgcolor: mode === 'dark' ? 'rgba(211,47,47,0.12)' : undefined,
                  color: mode === 'dark' ? '#ffcdd2' : undefined,
                }}
              >
                {error}
              </Alert>
            )}

            {showBioUnlock && (
              <Button
                variant="contained"
                size="large"
                startIcon={<FingerprintIcon />}
                onClick={handleUnlockBiometrics}
                disabled={busy}
                sx={{
                  py: 1.25,
                  // Match the app's navy primary action.
                  backgroundColor: accent,
                  color: mode === 'dark' ? '#0D1B3A' : '#FFFFFF',
                  '&:hover': {
                    backgroundColor: mode === 'dark' ? '#B3CBFA' : '#2C5282',
                  },
                }}
              >
                Unlock with biometrics
              </Button>
            )}

            {showBioUnlock && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }}
              >
                or use your password
              </Typography>
            )}

            <TextField
              label="Device password"
              type={showPass ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              fullWidth
              autoFocus={!showBioUnlock}
              autoComplete={isEnroll ? 'new-password' : 'current-password'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isEnroll) void handleUnlockPassphrase()
              }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle passphrase visibility"
                      onClick={() => setShowPass((v) => !v)}
                      edge="end"
                      size="small"
                      sx={{ color: 'text.secondary' }}
                    >
                      {showPass ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            {isEnroll && (
              <>
                <TextField
                  label="Confirm device password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  fullWidth
                  autoComplete="new-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleEnroll()
                  }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle confirm visibility"
                          onClick={() => setShowConfirm((v) => !v)}
                          edge="end"
                          size="small"
                          sx={{ color: 'text.secondary' }}
                        >
                          {showConfirm ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                {status?.biometricsAvailable && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={enableBio}
                        onChange={(e) => setEnableBio(e.target.checked)}
                        sx={{
                          color: accent,
                          '&.Mui-checked': { color: accent },
                        }}
                      />
                    }
                    label={
                      <Typography variant="body2" color="text.primary">
                        Use biometrics to unlock this computer
                      </Typography>
                    }
                  />
                )}
                {!status?.biometricsAvailable && (
                  <Alert
                    severity="info"
                    sx={{
                      bgcolor: mode === 'dark' ? 'rgba(147,180,244,0.10)' : undefined,
                      color: mode === 'dark' ? '#D5E2FC' : undefined,
                      '& .MuiAlert-icon': { color: accent },
                    }}
                  >
                    This computer uses your device password to unlock your wallet.
                  </Alert>
                )}
                {status?.needsMigration && (
                  <Alert
                    severity="warning"
                    sx={{
                      bgcolor: mode === 'dark' ? 'rgba(237,108,2,0.12)' : undefined,
                      color: mode === 'dark' ? '#ffe0b2' : undefined,
                    }}
                  >
                    Your existing wallet will be protected with this device password. Your recovery material stays the same.
                  </Alert>
                )}
              </>
            )}

            <Button
              variant={showBioUnlock ? 'outlined' : 'contained'}
              size="large"
              onClick={isEnroll ? handleEnroll : handleUnlockPassphrase}
              disabled={busy || !passphrase || (isEnroll && !confirm)}
              sx={{ py: 1.25 }}
            >
              {busy ? (
                <CircularProgress size={22} sx={{ color: 'inherit' }} />
              ) : isEnroll ? (
                'Protect my wallet'
              ) : (
                'Unlock wallet'
              )}
            </Button>
          </Stack>
        )}
      </Paper>
    </Container>
  )

  // Fully unlocked: don't wrap the app in our theme — AppThemeProvider owns that.
  if (gateMode === 'ready' && !showGate) {
    return <>{children}</>
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Keep wallet tree mounted under enroll overlay so subscriptions survive. */}
      {isEnroll && children}
      {showGate && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: (t) => t.zIndex.modal + 10,
            bgcolor: 'background.default',
            minHeight: '100vh',
          }}
        >
          {gatePanel}
        </Box>
      )}
    </ThemeProvider>
  )
}

export default VaultGate
