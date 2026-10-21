import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined'
import type { PermissionPromptHandler, PermissionPromptProps } from '../types'
import { parseRabinPromptMessage, RABIN_GRANT_MINUTES } from './promptMessage'

type PendingPrompt = { app: string; message: string; resolve: (allowed: boolean) => void }

const Row: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2}>
    <Typography color="text.secondary" sx={{ flexShrink: 0 }}>{label}</Typography>
    <Typography sx={{ textAlign: 'right', overflowWrap: 'anywhere', ...(mono ? { fontFamily: 'monospace', fontSize: '0.8rem' } : {}) }}>{value}</Typography>
  </Stack>
)

const describeCounterparty = (counterparty: string) =>
  counterparty === 'self' ? 'Only you' : counterparty === 'anyone' ? 'Anyone' : counterparty

const formatBytes = (length: number) => length === 1 ? '1 byte' : `${length.toLocaleString()} bytes`

/** FIFO prompts keep concurrent app calls from replacing an unanswered request. */
export const RabinPermissionPrompt: React.FC<PermissionPromptProps> = (props) => {
  // PermissionPromptHost is outside AppThemeProvider. Keep this portal on the
  // same navy palette and honor the host's explicit light/dark preference.
  const theme = useMemo(() => {
    const mode = props.paletteMode
    return createTheme({
      palette: {
        mode,
        primary: { main: mode === 'light' ? '#1b365d' : '#93b4f4', contrastText: mode === 'light' ? '#ffffff' : '#0d1b3a' },
        secondary: { main: mode === 'light' ? '#2c5282' : '#b2c5e8' },
        background: { default: mode === 'light' ? '#f5f7fb' : '#0f172a', paper: mode === 'light' ? '#ffffff' : '#172238' },
        text: { primary: mode === 'light' ? '#1e293b' : '#eef2fa', secondary: mode === 'light' ? '#607086' : '#a8b5cc' },
        divider: mode === 'light' ? '#e2e8f0' : '#2b3953'
      },
      typography: {
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        h6: { fontWeight: 600, fontSize: '0.95rem' },
        body1: { fontSize: '0.95rem', lineHeight: 1.65 },
        body2: { fontSize: '0.85rem', lineHeight: 1.6 },
        button: { fontWeight: 600, fontSize: '0.875rem' }
      },
      components: {
        MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', borderRadius: 10, padding: '10px 18px' } } },
        MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
        MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 500, fontSize: '0.75rem' } } },
        MuiDialog: { styleOverrides: { paper: { borderRadius: 20, backgroundImage: 'none' } } },
        MuiDialogTitle: { styleOverrides: { root: { fontWeight: 650, padding: '24px 24px 12px' } } },
        MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px 24px' } } },
        MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } }
      },
      shape: { borderRadius: 6 },
      spacing: 8
    })
  }, [props.paletteMode])
  const callbacks = useRef(props)
  callbacks.current = props
  const mounted = useRef(false)
  const queue = useRef<PendingPrompt[]>([])
  const current = useRef<PendingPrompt | null>(null)
  const inFlight = useRef<PendingPrompt | null>(null)
  const processing = useRef(false)
  const originallyFocused = useRef<boolean | undefined>(undefined)
  const [active, setActive] = useState<PendingPrompt | null>(null)

  const advance = useCallback(async function next(): Promise<void> {
    if (!mounted.current || current.current || processing.current) return
    processing.current = true
    if (queue.current.length === 0) {
      const restoreFocus = originallyFocused.current === false
      originallyFocused.current = undefined
      try {
        if (restoreFocus) await callbacks.current.onFocusRelinquished()
      } catch (error) {
        console.error('Unable to restore focus after Rabin permission prompt', error)
      } finally {
        processing.current = false
      }
      if (queue.current.length > 0) void next()
      return
    }

    const request = queue.current.shift()!
    inFlight.current = request
    try {
      if (originallyFocused.current === undefined) {
        originallyFocused.current = await callbacks.current.isFocused()
        if (mounted.current && !originallyFocused.current) await callbacks.current.onFocusRequested()
      }
    } catch (error) {
      console.error('Unable to focus Rabin permission prompt', error)
    } finally {
      inFlight.current = null
      processing.current = false
    }
    if (!mounted.current) {
      request.resolve(false)
      return
    }
    current.current = request
    setActive(request)
  }, [])

  const promptHandler = useCallback<PermissionPromptHandler>((app, message) => {
    if (!mounted.current) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      queue.current.push({ app, message, resolve })
      void advance()
    })
  }, [advance])

  const decide = useCallback((allowed: boolean) => {
    const request = current.current
    if (!request) return
    current.current = null
    setActive(null)
    request.resolve(allowed)
    void advance()
  }, [advance])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      current.current?.resolve(false)
      inFlight.current?.resolve(false)
      queue.current.splice(0).forEach(request => request.resolve(false))
      current.current = null
      if (originallyFocused.current === false) {
        void callbacks.current.onFocusRelinquished().catch(error => console.error('Unable to restore focus', error))
      }
      originallyFocused.current = undefined
    }
  }, [])

  const { id, onRegister, onUnregister } = props
  useEffect(() => {
    onRegister(id, promptHandler)
    return () => onUnregister?.(id)
  }, [id, onRegister, onUnregister, promptHandler])

  const prompt = useMemo(() => active ? parseRabinPromptMessage(active.message) : null, [active])
  if (!active) return null

  const app = active.app || 'Unknown app'
  const isSign = prompt?.type === 'rabin_sign'
  const sharedWith = prompt && prompt.counterparty !== 'self' ? describeCounterparty(prompt.counterparty) : null
  const title = isSign ? `Allow ${app} to sign with a key in your wallet?` : `Allow ${app} to use a signing key in your wallet?`
  const description = !prompt
    ? 'This app asked to use a signing key in your wallet, but the request could not be read.'
    : isSign
      ? 'The app wants your wallet to sign some data. Contracts that trust this key will accept the signature as coming from you.'
      : 'The app wants the public half of a signing key held in your wallet, so that contracts can check signatures made with it.'
  const scope = prompt
    ? `If you allow, ${app} can use any key under “${prompt.logicalProtocolID}”${prompt.securityLevel === 2 && sharedWith ? ' with this counterparty' : ''} for the next ${RABIN_GRANT_MINUTES} minutes without asking again. The private key never leaves your wallet.`
    : ''

  return (
    <ThemeProvider theme={theme}>
    <Dialog
      open
      onClose={() => decide(false)}
      maxWidth="sm"
      fullWidth
      aria-labelledby="rabin-permission-title"
      aria-describedby="rabin-permission-description"
    >
      <DialogTitle id="rabin-permission-title">
        <Stack direction="row" spacing={1.5} alignItems="center">
          <KeyOutlinedIcon color="primary" />
          <Typography component="span" variant="h6">{title}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Chip label={app} variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { py: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' } }} />
          <Typography id="rabin-permission-description" color="text.secondary">{description}</Typography>
          {!prompt && <Alert severity="error">Could not verify the complete request. Deny it and try again.</Alert>}
          {prompt && <Box sx={{ p: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Stack spacing={1}>
              <Row label="Protocol" value={prompt.logicalProtocolID} />
              <Row label="Key name" value={prompt.keyID} />
              <Row label="Key size" value={`${prompt.bits}-bit Rabin`} />
              {sharedWith && <Row label="Counterparty" value={sharedWith} mono={sharedWith.length === 66} />}
              {prompt.privilegedReason && <Row label="Privileged reason" value={prompt.privilegedReason} />}
              {isSign && <Row label="Data to sign" value={formatBytes(prompt.messageLength!)} />}
              {isSign && <Row label="SHA-256 of data" value={prompt.messageSha256} mono />}
            </Stack>
          </Box>}
          {prompt && <Typography variant="body2" color="text.secondary">{scope}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button variant="outlined" onClick={() => decide(false)} autoFocus>Deny</Button>
        <Button variant="contained" onClick={() => decide(true)} disabled={!prompt}>Allow</Button>
      </DialogActions>
    </Dialog>
    </ThemeProvider>
  )
}
