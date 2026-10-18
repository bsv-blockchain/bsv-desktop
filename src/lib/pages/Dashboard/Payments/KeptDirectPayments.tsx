import React, { useEffect, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import AmountDisplay from '../../../components/AmountDisplay'
import { dismissKeptDirectPayment, listKeptDirectPayments, subscribeKeptDirectPayments } from './directPayments'
import type { KeptDirectPaymentInfo, KeptDirectPaymentsList } from './directPayments'
import { canDismissKept, dismissConfirmText, KEPT_UNREADABLE, keptStatusText, keptUnknownText, recoveryDetails } from './directReceipts'

const short = (value: string) => `${value.slice(0, 12)}…${value.slice(-6)}`

/**
 * Direct payments this wallet acknowledged as received but has not added yet (see
 * directPayments.ts), with each one's state; renders nothing when there are none. A payment
 * that needs attention offers its recovery details: its payer will not send it again, and only
 * this device can add it. Once they were copied here, the user may dismiss it, after a
 * confirmation. A stored list, or entries, this version cannot read are left as they are, and
 * said so.
 */
export default function KeptDirectPayments({ identity, chain, sx }: { identity: string; chain: string; sx?: SxProps<Theme> }) {
  const [kept, setKept] = useState<KeptDirectPaymentsList>(() => listKeptDirectPayments(identity, chain))
  const [copied, setCopied] = useState('')
  /** Payments whose recovery details were copied in this view: only these can be dismissed. */
  const [copiedKeys, setCopiedKeys] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState<KeptDirectPaymentInfo | null>(null)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    setCopiedKeys(new Set())
    const read = () => setKept(listKeptDirectPayments(identity, chain))
    read()
    return subscribeKeptDirectPayments(read)
  }, [identity, chain])
  if (kept.payments.length === 0 && !kept.unreadable && kept.unknown === 0) return null
  const copy = async (p: KeptDirectPaymentInfo) => {
    try {
      await navigator.clipboard.writeText(recoveryDetails(p, { identity, chain }))
      setCopied(p.key); setProblem('')
      setCopiedKeys(keys => new Set(keys).add(p.key))
      setTimeout(() => setCopied(current => (current === p.key ? '' : current)), 2000)
    } catch {
      setProblem('Copy failed. Try again; the payment stays on this device.')
    }
  }
  const dismiss = () => {
    if (!confirming) return
    try {
      dismissKeptDirectPayment(identity, chain, confirming.key)
      setProblem('')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    }
    setConfirming(null)
  }
  return <Paper elevation={0} sx={sx}>
    <Typography variant="h6" sx={{ fontWeight: 700 }}>Received, not yet in your wallet</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: .5, mb: 2 }}>Direct payments your wallet acknowledged but has not added yet. They stay on this device, also when you log out or remove the wallet, until your wallet adds them.</Typography>
    {kept.unreadable && <Alert severity="warning" sx={{ mb: 1 }}>{KEPT_UNREADABLE}</Alert>}
    {kept.unknown > 0 && <Alert severity="warning" sx={{ mb: 1 }}>{keptUnknownText(kept.unknown)}</Alert>}
    {problem && <Alert severity="warning" sx={{ mb: 1 }}>{problem}</Alert>}
    {kept.payments.map(p => <Box key={p.key} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 700 }}><AmountDisplay>{p.amount}</AmountDisplay></Typography>
      <Typography color="text.secondary" variant="caption">From {short(p.sender)} · {new Date(p.receivedAt).toLocaleString()}</Typography>
      <Alert severity={p.needsAttention ? 'warning' : 'info'} sx={{ mt: 1 }} action={p.needsAttention ? <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <Button size="small" onClick={() => void copy(p)}>{copied === p.key ? 'Copied' : 'Copy recovery details'}</Button>
        {canDismissKept(p, copiedKeys) && <Button size="small" color="inherit" onClick={() => setConfirming(p)}>Dismiss</Button>}
      </Box> : undefined}>{keptStatusText(p)}</Alert>
    </Box>)}
    <Dialog open={confirming !== null} onClose={() => setConfirming(null)} maxWidth="xs" fullWidth>
      <DialogTitle>Dismiss this payment?</DialogTitle>
      <DialogContent><DialogContentText>{confirming && dismissConfirmText(confirming)}</DialogContentText></DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirming(null)}>Cancel</Button>
        <Button color="error" onClick={dismiss}>Dismiss payment</Button>
      </DialogActions>
    </Dialog>
  </Paper>
}
