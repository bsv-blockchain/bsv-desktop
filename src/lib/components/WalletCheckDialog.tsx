import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useHistory } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { CheckCircleRounded, ErrorOutlineRounded, RadioButtonUncheckedRounded, RemoveCircleOutlineRounded, WarningAmberRounded } from '@mui/icons-material'
import { WalletContext } from '../WalletContext'
import { getWalletService } from '../hooks/useWalletService'
import { beginUserWalletOperation } from '../services/httpBridgeSession'
import { CHECK_STEPS, runWalletCheck, type CheckStepId, type StepOutcome, type WalletCheckResult } from '../services/walletCheck/runWalletCheck'
import { createWalletCheckPorts, walletCheckDepsFromService } from '../services/walletCheck/ports'
import { createSingleFlight } from '../services/walletCheck/singleFlight'

function StatusIcon({ outcome, active }: { outcome?: StepOutcome; active: boolean }) {
  if (active) return <CircularProgress size={20} aria-label="Checking" />
  if (!outcome) return <RadioButtonUncheckedRounded sx={{ color: 'text.disabled' }} />
  if (outcome.status === 'ok') return <CheckCircleRounded color="success" />
  if (outcome.status === 'skipped') return <RemoveCircleOutlineRounded sx={{ color: 'text.disabled' }} />
  if (outcome.status === 'attention') return <WarningAmberRounded color="warning" />
  return <ErrorOutlineRounded color="error" />
}

/** Shared by every dialog instance: WalletHome unmounts on navigation, but a check keeps running. */
const checkInFlight = createSingleFlight()

export default function WalletCheckDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const history = useHistory()
  const { refreshAppWallet } = useContext(WalletContext)
  const refreshRef = useRef(refreshAppWallet)
  refreshRef.current = refreshAppWallet
  const [outcomes, setOutcomes] = useState<Partial<Record<CheckStepId, StepOutcome>>>({})
  const [active, setActive] = useState<CheckStepId | null>(null)
  const [result, setResult] = useState<WalletCheckResult | null>(null)
  const [failure, setFailure] = useState('')
  const [running, setRunning] = useState(false)
  const [finishing, setFinishing] = useState(false)
  // One check at a time: StrictMode's double effect, re-opening, and "Run again"
  // must never start a second set of repairs while one is still going.
  const runningRef = useRef(false)
  const skipResolvers = useRef(new Map<CheckStepId, () => void>())
  const skippedIds = useRef(new Set<CheckStepId>())

  const run = useCallback(async () => {
    if (runningRef.current) return
    if (!checkInFlight.tryStart()) { setFailure('A check is already running in the background. Give it a minute, then open Troubleshoot again.'); return }
    runningRef.current = true
    setRunning(true)
    skipResolvers.current.clear(); skippedIds.current.clear()
    setOutcomes({}); setResult(null); setFailure(''); setActive(null)
    let release: (() => void) | undefined
    try {
      try { release = beginUserWalletOperation() }
      catch { throw new Error('Your wallet is busy right now. Try again in a moment.') }
      const ports = createWalletCheckPorts(walletCheckDepsFromService(getWalletService(), () => refreshRef.current()))
      const res = await runWalletCheck(ports, {
        onStepStart: id => setActive(id),
        onStepDone: (id, outcome) => { setActive(null); setOutcomes(prev => ({ ...prev, [id]: outcome })) },
      }, {
        isSkipped: id => skippedIds.current.has(id),
        whenSkipped: id => new Promise<void>(resolve => skipResolvers.current.set(id, resolve)),
      })
      setResult(res)
      // A skipped or timed-out step may still be mid-repair: hold the wallet
      // lock (and keep "Run again" hidden) until it actually finishes.
      if (res.pending.length) {
        setFinishing(true)
        await Promise.allSettled(res.pending)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFailure(message.startsWith('Your wallet is busy') ? message : `The check couldn't run: ${message}`)
    } finally {
      release?.()
      runningRef.current = false
      checkInFlight.finish()
      setFinishing(false)
      setRunning(false)
      setActive(null)
    }
  }, [])

  useEffect(() => { if (open) void run() }, [open, run])

  const skip = (id: CheckStepId) => { skippedIds.current.add(id); skipResolvers.current.get(id)?.() }
  const go = (to: string) => { onClose(); history.push(to) }

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="wallet-check-title">
    <DialogTitle id="wallet-check-title">Troubleshoot</DialogTitle>
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Checking your wallet and fixing anything we can. This can take a minute — you can close this window and it will keep going.</Typography>
      {failure && <Alert severity="error" sx={{ mb: 2 }}>{failure}</Alert>}
      <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} gap={1.5}>
        {CHECK_STEPS.map(({ id, title }) => {
          const outcome = outcomes[id]
          return <Stack component="li" key={id} direction="row" gap={1.5} alignItems="flex-start">
            <Box sx={{ pt: 0.25, width: 24, display: 'grid', placeItems: 'center' }}><StatusIcon outcome={outcome} active={active === id} /></Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body1">{title}</Typography>
              {outcome && <Typography variant="body2" color="text.secondary">{outcome.message}</Typography>}
              {outcome?.fixed?.map(f => <Typography key={f} variant="body2" color="success.main">✓ {f}</Typography>)}
              {outcome?.action && <Button size="small" sx={{ px: 0, mt: 0.5 }} onClick={() => go(outcome.action!.to)}>{outcome.action.label}</Button>}
            </Box>
            {active === id && <Button size="small" aria-label={`Skip ${title}`} onClick={() => skip(id)} sx={{ color: 'text.secondary' }}>Skip</Button>}
          </Stack>
        })}
      </Stack>
      {result && <Alert sx={{ mt: 3 }} severity={result.needsYou.length ? (result.allOk ? 'warning' : 'error') : 'success'}>
        {result.needsYou.length === 0 && result.fixed.length === 0 && 'All good. Your wallet is working.'}
        {result.needsYou.length === 0 && result.fixed.length > 0 && `Fixed ${result.fixed.length} thing${result.fixed.length === 1 ? '' : 's'}.`}
        {result.needsYou.length > 0 && `${result.needsYou.length} thing${result.needsYou.length === 1 ? ' needs' : 's need'} you — use the buttons above.`}
      </Alert>}
      {finishing && <Stack direction="row" gap={1} alignItems="center" sx={{ mt: 2 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">Finishing a step in the background…</Typography>
      </Stack>}
    </DialogContent>
    <DialogActions>
      {!running && <Button onClick={() => void run()}>Run again</Button>}
      <Button variant="contained" onClick={onClose}>{running ? 'Close' : 'Done'}</Button>
    </DialogActions>
  </Dialog>
}
