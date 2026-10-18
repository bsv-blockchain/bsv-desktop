import React, { useEffect, useState } from 'react'
import { Alert, Box, Button, Paper, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import AmountDisplay from '../../../components/AmountDisplay'
import { listKeptDirectPayments, subscribeKeptDirectPayments } from './directPayments'
import type { KeptDirectPaymentInfo, KeptDirectPaymentsList } from './directPayments'
import { KEPT_UNREADABLE, keptStatusText, keptUnknownText, recoveryDetails } from './directReceipts'

const short = (value: string) => `${value.slice(0, 12)}…${value.slice(-6)}`

/**
 * Direct payments this wallet acknowledged as received but has not added yet (see
 * directPayments.ts), with each one's state; renders nothing when there are none. A payment
 * that needs attention offers its recovery details: its payer will not send it again, and only
 * this device can add it. A stored list, or entries, this version cannot read are left as they
 * are, and said so.
 */
export default function KeptDirectPayments({ identity, chain, sx }: { identity: string; chain: string; sx?: SxProps<Theme> }) {
  const [kept, setKept] = useState<KeptDirectPaymentsList>(() => listKeptDirectPayments(identity, chain))
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  useEffect(() => {
    const read = () => setKept(listKeptDirectPayments(identity, chain))
    read()
    return subscribeKeptDirectPayments(read)
  }, [identity, chain])
  if (kept.payments.length === 0 && !kept.unreadable && kept.unknown === 0) return null
  const copy = async (p: KeptDirectPaymentInfo) => {
    try {
      await navigator.clipboard.writeText(recoveryDetails(p, { identity, chain }))
      setCopied(p.key); setCopyError('')
      setTimeout(() => setCopied(current => (current === p.key ? '' : current)), 2000)
    } catch {
      setCopyError('Copy failed. Try again; the payment stays on this device.')
    }
  }
  return <Paper elevation={0} sx={sx}>
    <Typography variant="h6" sx={{ fontWeight: 700 }}>Received, not yet in your wallet</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: .5, mb: 2 }}>Direct payments your wallet acknowledged but has not added yet. They stay on this device, also when you log out or remove the wallet, until your wallet adds them.</Typography>
    {kept.unreadable && <Alert severity="warning" sx={{ mb: 1 }}>{KEPT_UNREADABLE}</Alert>}
    {kept.unknown > 0 && <Alert severity="warning" sx={{ mb: 1 }}>{keptUnknownText(kept.unknown)}</Alert>}
    {copyError && <Alert severity="warning" sx={{ mb: 1 }}>{copyError}</Alert>}
    {kept.payments.map(p => <Box key={p.key} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 700 }}><AmountDisplay>{p.amount}</AmountDisplay></Typography>
      <Typography color="text.secondary" variant="caption">From {short(p.sender)} · {new Date(p.receivedAt).toLocaleString()}</Typography>
      <Alert severity={p.needsAttention ? 'warning' : 'info'} sx={{ mt: 1 }} action={p.needsAttention ? <Button size="small" onClick={() => void copy(p)}>{copied === p.key ? 'Copied' : 'Copy recovery details'}</Button> : undefined}>{keptStatusText(p)}</Alert>
    </Box>)}
  </Paper>
}
