/**
 * Consent prompt for the color permission module (BRC-207): `color_send`,
 * `color_signature`, `color_access` and `color_relinquish` (contract §2.5,
 * Revision 3: offline receipts are credited by the host runtime, not prompted).
 *
 * The message is turned into a `ColorConsentView` BEFORE anything is queued.
 * A message the view cannot present faithfully (`InvalidColorRequestError`,
 * or any other failure) is declined without opening a dialog: the user is
 * never asked to approve a figure the wallet could not verify.
 *
 * Prompts are FIFO, so concurrent app calls never replace an unanswered
 * request. A decision is taken once (a double click on Approve is a no-op);
 * closing, Escape and unmounting all answer `false`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import TokenOutlinedIcon from '@mui/icons-material/TokenOutlined'
import type { PermissionPromptHandler, PermissionPromptProps } from '../types'
import { buildColorConsentView, type ColorConsentView } from './consentView'

type PendingPrompt = { app: string; view: ColorConsentView; resolve: (allowed: boolean) => void }

/**
 * Builds the view for `message` and hands it to `enqueue` (the dialog queue).
 * Resolves `true` only for an explicit boolean approval. An invalid message
 * resolves `false` without calling `enqueue` and logs one warning naming the
 * offending field; an `enqueue` failure is also a decline.
 */
export async function handleColorPromptMessage (
  message: string,
  enqueue: (view: ColorConsentView) => Promise<boolean>
): Promise<boolean> {
  let view: ColorConsentView
  try {
    view = buildColorConsentView(message)
  } catch (error) {
    // Matched by name, never instanceof across bundles (D22).
    const name = (error as { name?: unknown } | null)?.name
    const text = (error as { message?: unknown } | null)?.message
    console.warn(
      name === 'InvalidColorRequestError'
        ? 'Declined a color consent request the wallet could not verify:'
        : 'Declined a color consent request that could not be displayed:',
      typeof text === 'string' ? text : String(error)
    )
    return false
  }
  try {
    return (await enqueue(view)) === true
  } catch (error) {
    console.error('Color consent prompt failed; the request is declined', error)
    return false
  }
}

const descriptions: Record<ColorConsentView['type'], string> = {
  color_send: 'This app wants to create a token transaction. Review every asset, output and fee before approving.',
  color_signature: 'This app wants this wallet to sign token inputs of a transaction. Review every asset before approving. This approves these signatures only.',
  color_access: 'This app wants to read your token holdings. Approval lasts for 30 minutes.',
  color_relinquish: 'This app wants to remove this token holding from your wallet.'
}

const HANDOFF_NOTE = 'This wallet signs the transaction and hands it to the recipient. It is submitted to the overlay once the recipient has it.'

const boxSx = { p: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 2 } as const
const monoSx = { fontFamily: 'monospace', overflowWrap: 'anywhere' } as const

const Row: React.FC<{ label: string; value: React.ReactNode; mono?: boolean; strong?: boolean }> = ({ label, value, mono, strong }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2}>
    <Typography color="text.secondary" sx={{ flexShrink: 0 }}>{label}</Typography>
    <Typography fontWeight={strong ? 700 : undefined} sx={{ textAlign: 'right', overflowWrap: 'anywhere', ...(mono ? monoSx : {}) }}>{value}</Typography>
  </Stack>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box sx={boxSx}>
    <Stack spacing={1}>
      <Typography fontWeight={700}>{title}</Typography>
      {children}
    </Stack>
  </Box>
)

/** The prompt body. Presentational, no Dialog, so it renders on the server. */
export const ColorConsentDetails: React.FC<{ view: ColorConsentView }> = ({ view }) => {
  const { satoshis, access, relinquish, deploy } = view
  return (
    <Stack spacing={2.5}>
      <Typography id="color-permission-description" color="text.secondary">{descriptions[view.type]}</Typography>
      {view.handoff && <Alert severity="info">{HANDOFF_NOTE}</Alert>}

      {view.assets.map((asset, index) => (
        <Section key={`${asset.assetId}-${index}`} title={asset.name}>
          {asset.operations.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {asset.operations.map((operation, i) => <Chip key={`${operation}-${i}`} size="small" label={operation} />)}
            </Stack>
          )}
          {asset.lines.map((line, i) => (
            <Row key={`${line.label}-${i}`} label={line.label} value={line.amount} strong={line.label === 'Sending'} />
          ))}
          {asset.authorities.map((authority, i) => (
            <Row key={`${authority.label}-${i}`} label={authority.label} value={String(authority.count)} />
          ))}
          <Typography variant="caption" color="text.secondary" sx={monoSx}>Asset ID: {asset.assetId}</Typography>
        </Section>
      ))}

      {deploy && (
        <Section title="New token">
          <Row label="Operation" value={deploy.operation} />
          <Row label="Amount" value={deploy.amount} strong />
          <Row label="Kept by this wallet" value={deploy.owned ? 'Yes' : 'No'} />
        </Section>
      )}

      {view.destinations.length > 0 && (
        <Section title="Outputs">
          {view.destinations.map((destination, i) => (
            <Stack key={`${destination.outputIndex}-${i}`} spacing={0.5}>
              <Row label={`Output ${destination.outputIndex}`} value={`${destination.satoshis} sats`} />
              {destination.token && (
                <>
                  <Row label={destination.token.role === 'authority' ? 'Authority' : 'Tokens'} value={destination.token.amount} />
                  <Typography variant="caption" color="text.secondary" sx={monoSx}>Asset ID: {destination.token.assetId}</Typography>
                </>
              )}
            </Stack>
          ))}
        </Section>
      )}

      {satoshis && (
        <Section title="Satoshis">
          <Row label="Inputs" value={`${satoshis.inputs} sats`} />
          <Row label="Outputs" value={`${satoshis.outputs} sats`} />
          <Row label="Network fee" value={`${satoshis.fee} sats`} strong />
        </Section>
      )}

      {view.signatures.length > 0 && (
        <Section title={`Signatures released: ${view.signatures.length}`}>
          {view.signatures.map((signature, i) => (
            <Typography key={`${signature.outpoint}-${i}`} variant="caption" sx={monoSx}>
              {`Input ${signature.inputIndex}: ${signature.outpoint} (sighash ${signature.sighashType})`}
            </Typography>
          ))}
        </Section>
      )}

      {view.lockTime !== undefined && view.lockTime !== 0 && (
        <Row label="Lock time" value={String(view.lockTime)} />
      )}

      {access && (
        <Section title="Requested access">
          {access.basket !== undefined && <Row label="Basket" value={access.basket} mono />}
          {access.labels !== undefined && <Row label="Labels" value={access.labels.length > 0 ? access.labels.join(', ') : 'none'} mono />}
          {access.role !== undefined && <Row label="Role" value={access.role} />}
          {access.assetId !== undefined && <Typography variant="caption" color="text.secondary" sx={monoSx}>Asset ID: {access.assetId}</Typography>}
        </Section>
      )}

      {relinquish && (
        <Section title="Holding">
          <Row label="Role" value={relinquish.role} />
          <Typography variant="caption" sx={monoSx}>Asset ID: {relinquish.assetId}</Typography>
          <Typography variant="caption" color="text.secondary" sx={monoSx}>Outpoint: {relinquish.outpoint}</Typography>
        </Section>
      )}
    </Stack>
  )
}

/** FIFO prompts keep concurrent app calls from replacing an unanswered request. */
export const ColorPermissionPrompt: React.FC<PermissionPromptProps> = (props) => {
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

  const advance = useCallback(async function next (): Promise<void> {
    if (!mounted.current || current.current || processing.current) return
    processing.current = true
    if (queue.current.length === 0) {
      const restoreFocus = originallyFocused.current === false
      originallyFocused.current = undefined
      try {
        if (restoreFocus) await callbacks.current.onFocusRelinquished()
      } catch (error) {
        console.error('Unable to restore focus after color permission prompt', error)
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
      console.error('Unable to focus color permission prompt', error)
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
    return handleColorPromptMessage(message, view => new Promise<boolean>((resolve) => {
      if (!mounted.current) {
        resolve(false)
        return
      }
      queue.current.push({ app, view, resolve })
      void advance()
    }))
  }, [advance])

  const decide = useCallback((allowed: boolean) => {
    const request = current.current
    if (!request) return
    // Cleared before resolving, so a second click on the same dialog is a no-op.
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

  if (!active) return null
  const { view } = active

  return (
    <ThemeProvider theme={theme}>
      <Dialog
        open
        onClose={() => decide(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="color-permission-title"
        aria-describedby="color-permission-description"
      >
        <DialogTitle id="color-permission-title">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TokenOutlinedIcon color="primary" />
            <Typography component="span" variant="h6">{view.title}</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <Chip label={active.app || 'Unknown app'} variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { py: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' } }} />
            <ColorConsentDetails view={view} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button variant="outlined" onClick={() => decide(false)} autoFocus>Deny</Button>
          <Button variant="contained" onClick={() => decide(true)}>Approve</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}
