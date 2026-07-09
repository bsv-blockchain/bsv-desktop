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
  return createTheme({
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            primary: { main: '#1B365D' },
            secondary: { main: '#2C5282' },
            background: { default: '#FFFFFF', paper: '#FFFFFF' },
            text: { primary: '#4A4A4A', secondary: '#4A5568' },
          }
        : {
            primary: { main: '#FFFFFF' },
            secondary: { main: '#487dbf' },
            background: { default: '#1D2125', paper: '#1D2125' },
            text: { primary: '#FFFFFF', secondary: '#888888' },
          }),
    },
    typography: {
      fontFamily: '"Helvetica","Arial",sans-serif',
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: mode === 'light' ? '#FFFFFF' : '#1D2125',
            backgroundImage:
              mode === 'light'
                ? 'linear-gradient(45deg, rgba(27,54,93,0.05), rgba(44,82,130,0.05))'
                : 'linear-gradient(45deg, rgba(27,54,93,0.1), rgba(44,82,130,0.1))',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 2,
            '&.MuiButton-contained': {
              backgroundColor: mode === 'light' ? '#1B365D' : '#FFFFFF',
              color: mode === 'light' ? '#FFFFFF' : '#1B365D',
              '&:hover': {
                backgroundColor: mode === 'light' ? '#2C5282' : '#F6F6F6',
              },
            },
            '&.MuiButton-outlined': {
              borderColor: mode === 'light' ? '#1B365D' : '#FFFFFF',
              color: mode === 'light' ? '#1B365D' : '#FFFFFF',
              '&:hover': {
                backgroundColor:
                  mode === 'light' ? 'rgba(27,54,93,0.04)' : 'rgba(255,255,255,0.08)',
                borderColor: mode === 'light' ? '#2C5282' : '#F6F6F6',
              },
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: mode === 'light' ? '#FFFFFF' : '#1D2125',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor:
                mode === 'light' ? 'rgba(0,0,0,0.23)' : 'rgba(255,255,255,0.23)',
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor:
                mode === 'light' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: mode === 'light' ? '#1B365D' : '#487dbf',
            },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            color: mode === 'light' ? '#4A5568' : '#888888',
            '&.Mui-focused': {
              color: mode === 'light' ? '#1B365D' : '#487dbf',
            },
          },
        },
      },
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

  const isEnroll = gateMode === 'enroll'
  const isUnlock = gateMode === 'unlock'
  const showGate = isEnroll || isUnlock || gateMode === 'loading'
  const showBioUnlock =
    isUnlock &&
    !!status?.biometricsAvailable &&
    !!status?.methods?.includes('se')

  const accentBlue = mode === 'dark' ? '#487dbf' : '#2196F3'
  const logoColor = '#2196F3'

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
        elevation={4}
        sx={{
          p: { xs: 3, sm: 4 },
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: mode === 'dark' ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.06)',
          boxShadow: mode === 'dark'
            ? '0 8px 32px rgba(0,0,0,0.45)'
            : (t) => t.shadows[3],
        }}
      >
        {/* Header — matches Greeter */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box sx={{ mb: 2, width: 80, height: 80 }}>
            <AppLogo rotate size="80px" color={logoColor} />
          </Box>
          <Typography
            variant="h2"
            fontFamily="Helvetica"
            fontSize="1.75em"
            sx={{
              mb: 0.5,
              fontWeight: 'bold',
              background:
                mode === 'dark'
                  ? 'linear-gradient(90deg, #FFFFFF 0%, #F5F5F5 100%)'
                  : 'linear-gradient(90deg, #2196F3 0%, #4569E5 100%)',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {appName}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, color: 'text.secondary' }}>
            <LockOutlinedIcon sx={{ fontSize: 16, color: accentBlue }} />
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
            <CircularProgress sx={{ color: accentBlue }} />
          </Box>
        ) : (
          <Stack spacing={2.5} alignItems="stretch">
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', lineHeight: 1.6 }}>
              {isEnroll
                ? 'Create an unlock passphrase for this device. This is separate from your wallet password or recovery key. When available, biometrics can unlock the vault on launch.'
                : 'Your wallet secrets are encrypted on this device. Unlock with biometrics or your unlock passphrase to continue.'}
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
                  // Biometrics CTA uses brand blue rather than inverted white
                  backgroundColor: accentBlue,
                  color: '#FFFFFF',
                  '&:hover': {
                    backgroundColor: mode === 'dark' ? '#5a8fd0' : '#1B365D',
                  },
                }}
              >
                Unlock with Touch ID
              </Button>
            )}

            {showBioUnlock && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }}
              >
                or use passphrase
              </Typography>
            )}

            <TextField
              label="Unlock passphrase"
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
                  label="Confirm passphrase"
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
                          color: accentBlue,
                          '&.Mui-checked': { color: accentBlue },
                        }}
                      />
                    }
                    label={
                      <Typography variant="body2" color="text.primary">
                        Enable Touch ID unlock on this device
                      </Typography>
                    }
                  />
                )}
                {!status?.biometricsAvailable && (
                  <Alert
                    severity="info"
                    sx={{
                      bgcolor: mode === 'dark' ? 'rgba(72,125,191,0.12)' : undefined,
                      color: mode === 'dark' ? '#bbdefb' : undefined,
                      '& .MuiAlert-icon': { color: accentBlue },
                    }}
                  >
                    No biometric secure element is available on this device. You will unlock with your passphrase only.
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
                    Existing wallet data will be re-encrypted into a protected vault. You must set a passphrase to continue.
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
                'Create vault'
              ) : (
                'Unlock with passphrase'
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
            backgroundImage:
              mode === 'light'
                ? 'linear-gradient(45deg, rgba(27,54,93,0.05), rgba(44,82,130,0.05))'
                : 'linear-gradient(45deg, rgba(27,54,93,0.15), rgba(72,125,191,0.08))',
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
