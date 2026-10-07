import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import TokenOutlinedIcon from '@mui/icons-material/TokenOutlined'
import type { PermissionPromptHandler, PermissionPromptProps } from '../types'

type AmountLine = {
  assetId: string
  tokenName?: string
  display?: string
  sendAmount?: number
  changeAmount?: number
  creditAmount?: number
}

type PromptMessage = {
  type?: string
  action?: string
  context?: string
  assetId?: string
  tokenName?: string
  display?: string
  amount?: number
  outpoint?: string
  lines?: unknown
}

type PendingPrompt = { app: string; message: string; resolve: (allowed: boolean) => void }

/** Never show only the first asset when an approval covers several assets. */
export function sanitizedMandalaLines(raw: unknown, type: string): AmountLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 25) return null
  const amountField = type === 'mandala_credit' ? 'creditAmount' : 'sendAmount'
  for (const line of raw) {
    if (!line || typeof line !== 'object' || typeof line.assetId !== 'string' || !line.assetId) return null
    if (typeof line[amountField] !== 'number' || !Number.isFinite(line[amountField]) || line[amountField] < 0) return null
    if (line.changeAmount !== undefined && (typeof line.changeAmount !== 'number' || !Number.isFinite(line.changeAmount) || line.changeAmount < 0)) return null
    if (line.display !== undefined && typeof line.display !== 'string') return null
    if (line.tokenName !== undefined && typeof line.tokenName !== 'string') return null
  }
  return raw as AmountLine[]
}

function parseMessage(message: string): PromptMessage | null {
  try {
    const value = JSON.parse(message)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

const titles: Record<string, string> = {
  mandala_spend: 'Approve token transaction',
  mandala_credit: 'Receive Mandala tokens',
  mandala_access: 'Share token activity',
  mandala_generic: 'Approve Mandala access',
  mandala_signature: 'Approve token signature'
}

/** FIFO prompts keep concurrent app calls from replacing an unanswered request. */
export const MandalaPermissionPrompt: React.FC<PermissionPromptProps> = (props) => {
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
        console.error('Unable to restore focus after Mandala permission prompt', error)
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
      console.error('Unable to focus Mandala permission prompt', error)
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

  const prompt = useMemo(() => active ? parseMessage(active.message) : null, [active])
  if (!active) return null

  const type = prompt?.type ?? ''
  const isAmountRequest = type === 'mandala_spend' || type === 'mandala_credit'
  const lines = isAmountRequest ? sanitizedMandalaLines(prompt?.lines, type) : null
  const isRemoval = type === 'mandala_access' && prompt?.action === 'relinquishOutput'
  const unresolvedRemoval = isRemoval && (typeof prompt?.assetId !== 'string' || !prompt.assetId || typeof prompt?.outpoint !== 'string' || !prompt.outpoint || typeof prompt?.amount !== 'number' || !Number.isFinite(prompt.amount) || prompt.amount < 0)
  const approvalBlocked = !titles[type] || (isAmountRequest && lines === null) || unresolvedRemoval
  const title = isRemoval
    ? 'Remove token holding'
    : type === 'mandala_generic' && prompt?.context === 'credit'
      ? 'Receive Mandala tokens'
      : type === 'mandala_generic' && prompt?.context === 'spend'
        ? 'Approve token transaction'
        : titles[type] ?? 'Mandala permission request'
  const description = type === 'mandala_spend'
    ? 'This app wants to create a token transaction. Review every asset before approving.'
    : type === 'mandala_credit'
      ? 'This app wants to add the following tokens to your wallet.'
      : isRemoval
        ? 'This app wants to remove this token holding from your wallet.'
        : type === 'mandala_access'
          ? 'This app wants to view your Mandala token balance and activity. Approval lasts for one minute.'
          : type === 'mandala_signature'
            ? 'This app wants to sign with one of your token keys. Only approve if you just asked this app to move tokens. This approves one signature.'
            : prompt?.context === 'credit'
              ? 'This app wants to add Mandala tokens to your wallet. The token amounts could not be decoded for this request.'
              : prompt?.context === 'spend'
                ? 'This app wants to create a Mandala token transaction. The token amounts could not be decoded for this request.'
                : 'This app wants to access Mandala tokens. The token amounts could not be decoded for this request.'

  return (
    <ThemeProvider theme={theme}>
    <Dialog
      open
      onClose={() => decide(false)}
      maxWidth="sm"
      fullWidth
      aria-labelledby="mandala-permission-title"
      aria-describedby="mandala-permission-description"
    >
      <DialogTitle id="mandala-permission-title">
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TokenOutlinedIcon color="primary" />
          <Typography component="span" variant="h6">{title}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Chip label={active.app || 'Unknown app'} variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { py: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' } }} />
          <Typography id="mandala-permission-description" color="text.secondary">{description}</Typography>
          {approvalBlocked && <Alert severity="error">Could not verify the complete request. Deny it and try again.</Alert>}
          {lines?.map((line, index) => (
            <Box key={`${line.assetId}-${index}`} sx={{ p: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Stack spacing={1}>
                <Typography fontWeight={700}>{line.tokenName || `Mandala token${lines.length > 1 ? ` ${index + 1}` : ''}`}</Typography>
                <Stack direction="row" justifyContent="space-between" spacing={2}>
                  <Typography color="text.secondary">{type === 'mandala_credit' ? 'Receive' : 'Send'}</Typography>
                  <Typography fontWeight={700} sx={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{line.display || `${type === 'mandala_credit' ? line.creditAmount : line.sendAmount} base units`}</Typography>
                </Stack>
                {!!line.changeAmount && <Stack direction="row" justifyContent="space-between" spacing={2}>
                  <Typography color="text.secondary">Keep in wallet</Typography>
                  <Typography>{line.changeAmount} base units</Typography>
                </Stack>}
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>Asset ID: {line.assetId}</Typography>
              </Stack>
            </Box>
          ))}
          {isRemoval && <Box sx={{ p: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Stack spacing={1}>
              <Typography fontWeight={700}>{prompt?.tokenName || 'Mandala token'}</Typography>
              <Typography>{prompt?.display || `${prompt?.amount ?? 'Unknown'} base units`}</Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>Asset ID: {prompt?.assetId}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>Outpoint: {prompt?.outpoint}</Typography>
            </Stack>
          </Box>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button variant="outlined" onClick={() => decide(false)} autoFocus>Deny</Button>
        <Button variant="contained" onClick={() => decide(true)} disabled={approvalBlocked}>{isRemoval ? 'Remove holding' : 'Approve'}</Button>
      </DialogActions>
    </Dialog>
    </ThemeProvider>
  )
}
