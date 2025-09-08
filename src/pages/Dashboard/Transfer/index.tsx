// src/routes/PeerPayRoute.tsx
import React, { useCallback, useEffect, useMemo, useState, useContext, useRef } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { PeerPayClient, IncomingPayment } from '@bsv/message-box-client'
import { WalletClient } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import { getAccountBalance } from '../../../utils/getAccountBalance'
const MESSAGEBOX_HOST = 'https://messagebox.babbage.systems'
export type PeerPayRouteProps = {
  walletClient?: WalletClient
  defaultRecipient?: string
}

/* --------------------------- Inline: Payment Form -------------------------- */
type PaymentFormProps = {
  peerPay: PeerPayClient
  onSent?: () => void
  defaultRecipient?: string
}

function PaymentForm({ peerPay, onSent, defaultRecipient }: PaymentFormProps) {
  const balanceAPI = getAccountBalance("default") 
	const refreshBalanceNow = balanceAPI.refresh
  const [recipient, setRecipient] = useState(defaultRecipient ?? '')
  const [amount, setAmount] = useState<number>(0)
  const [sending, setSending] = useState(false)

  const canSend = recipient.trim().length > 0 && amount > 0 && !sending

  const send = async () => {
    if (!canSend) return
    try {
      setSending(true)
      await peerPay.sendLivePayment({
        recipient: recipient.trim(), // identity pubkey hex or handle you resolved upstream
        amount, // satoshis
      })
      onSent?.()
      setAmount(0)
			refreshBalanceNow()
    } catch (e) {
      console.error('[PaymentForm] sendLivePayment error:', e)
      alert((e as Error)?.message ?? 'Failed to send payment')
    } finally {
      setSending(false)
    }
  }

  return (
    <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Send Payment
      </Typography>
      <Stack spacing={2}>
        <TextField
          label="Recipient (identity pubkey hex or handle)"
          fullWidth
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="02ab… (recipient identity pubkey)"
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            type="number"
            label="Amount (sats)"
            fullWidth
            value={Number.isFinite(amount) ? amount : ''}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value || 0)))}
            inputProps={{ min: 1, step: 1 }}
          />
        </Stack>
        <Box>
          <Button variant="contained" disabled={!canSend} onClick={send}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  )
}

/* --------------------------- Inline: Payment List -------------------------- */
type PaymentListProps = {
  payments: IncomingPayment[]
  onRefresh: () => void
  peerPay: PeerPayClient
}

function PaymentList({ payments, onRefresh, peerPay }: PaymentListProps) {
	const balanceAPI = getAccountBalance("default") 
	const refreshBalanceNow = balanceAPI.refresh
  const acceptWithRetry = async (p: IncomingPayment) => {
    try {
      await peerPay.acceptPayment(p)
      return true
    } catch (e1) {
      console.error('[PaymentList] acceptPayment raw failed → refetching by id', e1)
      try {
        const list = await peerPay.listIncomingPayments(MESSAGEBOX_HOST)
        const fresh = list.find(x => String(x.messageId) === String(p.messageId))
        if (!fresh) throw new Error('Payment not found on refresh')
        await peerPay.acceptPayment(fresh)
        return true
      } catch (e2) {
        console.error('[PaymentList] acceptPayment refresh retry failed', e2)
        return false
      }
			finally{
				refreshBalanceNow()
			}
    }
  }

  const accept = async (p: IncomingPayment) => {
    try {
			
      const ok = await acceptWithRetry(p)
      if (!ok) throw new Error('Accept failed')
    } catch (e) {
      console.error('[PaymentList] acceptPayment error (final):', e)
      alert((e as Error)?.message ?? 'Failed to accept payment')
    } finally {
      onRefresh()
			refreshBalanceNow()

    }
  }

  return (
    <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h6">Pending Payments</Typography>
        <Button onClick={onRefresh}>Refresh</Button>
      </Box>

      {payments.length === 0 ? (
        <Typography color="text.secondary">No pending payments.</Typography>
      ) : (
        <List sx={{ width: '100%' }}>
          {payments.map((p, idx) => (
            <React.Fragment key={`${p.messageId}-${idx}`}>
              <ListItem
                secondaryAction={
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" onClick={() => accept(p)}>
                      Accept
                    </Button>
                  </Stack>
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip size="small" label={`${p.token.amount} sats`} />
                      <Typography fontFamily="monospace" fontSize="0.9rem">
                        {String(p.messageId).slice(0, 10)}…
                      </Typography>
                    </Stack>
                  }
                  secondary={
                    <Typography variant="body2" color="text.secondary">
                      From: {p.sender?.slice?.(0, 14) ?? 'unknown'}…
                    </Typography>
                  }
                />
              </ListItem>
              <Divider component="li" />
            </React.Fragment>
          ))}
        </List>
      )}
    </Paper>
  )
}

/* ------------------------------- Route View -------------------------------- */
export default function PeerPayRoute({ walletClient, defaultRecipient }: PeerPayRouteProps) {
  const peerPay = useMemo(() => {
    const wc = walletClient ?? new WalletClient()
    return new PeerPayClient({
      walletClient: wc,
      messageBoxHost: MESSAGEBOX_HOST,
      enableLogging: true,
    })
  }, [walletClient])

  const [payments, setPayments] = useState<IncomingPayment[]>([])
  const [loading, setLoading] = useState(false)
  const [snack, setSnack] = useState<{ open: boolean; msg: string; severity: 'success' | 'info' | 'warning' | 'error' }>({
    open: false,
    msg: '',
    severity: 'info',
  })

  const fetchPayments = useCallback(async () => {
    try {
      setLoading(true)
      const list = await peerPay.listIncomingPayments(MESSAGEBOX_HOST)
      setPayments(list)
    } catch (e) {
      console.error('[PeerPayRoute] listIncomingPayments error:', e)
      setSnack({ open: true, msg: (e as Error)?.message ?? 'Failed to load payments', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }, [peerPay])

  useEffect(() => {
    fetchPayments()
  }, [fetchPayments])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        await peerPay.initializeConnection()
        await peerPay.listenForLivePayments({
          overrideHost: MESSAGEBOX_HOST,
          onPayment: (payment) => {
            if (!mounted) return
            setPayments((prev) => [...prev, payment])
            setSnack({ open: true, msg: 'New incoming payment', severity: 'success' })
          },
        })
      } catch (e) {
        console.error('[PeerPayRoute] live listen error:', e)
      }
    })()
    return () => {
      mounted = false
    }
  }, [peerPay])

  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: '100vh', py: 5 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Wallet Peer-to-Peer Payments
        </Typography>

        <Stack spacing={2}>
          <PaymentForm peerPay={peerPay} onSent={fetchPayments} defaultRecipient={defaultRecipient} />

          {loading && <LinearProgress />}

          <PaymentList payments={payments} onRefresh={fetchPayments} peerPay={peerPay} />
        </Stack>

        <Snackbar
          open={snack.open}
          autoHideDuration={3500}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled" sx={{ width: '100%' }}>
            {snack.msg}
          </Alert>
        </Snackbar>
      </Box>
    </Container>
  )
}
