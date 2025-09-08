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
  Select,
  MenuItem,
  InputLabel,
  FormControl
} from '@mui/material'
import { PeerPayClient, IncomingPayment } from '@bsv/message-box-client'
import { WalletClient } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'

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
  managers?: any
  activeProfile?: { id?: number[]; name?: string } | null
}

type WalletProfile = {
  id: number[]
  name: string
  createdAt: number | null
  active: boolean
}

function PaymentForm({ peerPay, onSent, defaultRecipient, managers, activeProfile }: PaymentFormProps) {
  const [mode, setMode] = useState<'internal' | 'external'>('internal')
  const [recipient, setRecipient] = useState(defaultRecipient ?? '')
  const [amount, setAmount] = useState<number>(0)
  const [sending, setSending] = useState(false)
	const prevModeRef = useRef<'internal' | 'external'>(mode);

  const [profiles, setProfiles] = useState<WalletProfile[]>([])
  const [destProfileId, setDestProfileId] = useState<string>('') 

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!managers?.walletManager) return
        const list: WalletProfile[] = await managers.walletManager.listProfiles()
        if (!alive) return
        const cloned = list.map(p => ({
          id: [...p.id],
          name: String(p.name),
          createdAt: p.createdAt ?? null,
          active: !!p.active
        }))
        setProfiles(cloned)
      } catch (e) {
        console.error('[PaymentForm] listProfiles error:', e)
      }
    })()
    return () => { alive = false }
  }, [managers])

  const handlePickProfile = async (value: string) => {
    if (!managers?.walletManager) return
    const originalId: number[] | undefined = activeProfile?.id
    const targetId: number[] = JSON.parse(value)
    let newRecipient = ''

    try {
      await managers.walletManager.switchProfile(targetId)
      const pub = await managers.walletManager.getPublicKey({ identityKey: true }, 'Metanet-Desktop')
      newRecipient = String(pub.publicKey || '')
    } catch (e) {
      console.error('[PaymentForm] resolve pubkey failed for selected profile', e)
    } finally {
      if (originalId) {
        try { await managers.walletManager.switchProfile(originalId) } catch {}
      }
      setRecipient(newRecipient)
      setDestProfileId(value)
    }
  }

  const canSend = recipient.trim().length > 0 && amount > 0 && !sending

  const send = async () => {
    if (!canSend) return
    try {
      setSending(true)
      await peerPay.sendLivePayment({
        recipient: recipient.trim(),
        amount
      })
      onSent?.()
      setAmount(0)
    } catch (e) {
      console.error('[PaymentForm] sendLivePayment error:', e)
      alert((e as Error)?.message ?? 'Failed to send payment')
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
		setRecipient('')
	},[mode])
	useEffect(() => {
  const prev = prevModeRef.current;
  if (prev !== mode && mode === 'internal') {
    const first = profiles.find(p => !p.active) ?? profiles[0];
    if (first) {
      const enc = JSON.stringify(first.id);
      void handlePickProfile(enc);
    }
  }
  prevModeRef.current = mode;
}, [mode, profiles]);
  return (
    <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Send Payment
      </Typography>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Button
            variant={mode === 'internal' ? 'contained' : 'outlined'}
            onClick={() => setMode('internal')}
          >
            Internal (My Profiles)
          </Button>
          <Button
            variant={mode === 'external' ? 'contained' : 'outlined'}
            onClick={() => setMode('external')}
          >
            External (Any Pubkey)
          </Button>
        </Stack>

        {mode === 'internal' ? (
          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="dest-profile-label">Destination Profile</InputLabel>
              <Select
                labelId="dest-profile-label"
                label="Destination Profile"
                value={destProfileId}
                onChange={(e) => handlePickProfile(String(e.target.value))}
                renderValue={(val) =>
                  val && val !== '' ? profiles.find(p => JSON.stringify(p.id) === val)?.name ?? 'Select a profile'
                                    : 'Select a profile'
                }
              >
                {profiles.map((p) => {
                  const enc = JSON.stringify(p.id)
                  const idShort = `[${p.id.slice(0, 3).join(',')}${p.id.length > 3 ? '…' : ''}]`
                  return (
                    <MenuItem key={p.name + enc} value={enc}>
                      {p.name} — {idShort}
                    </MenuItem>
                  )
                })}
              </Select>
            </FormControl>

            <TextField
              label="Resolved Recipient Pubkey"
              fullWidth
              value={recipient}
              InputProps={{ readOnly: true }}
              helperText={'Identity pubkey of the selected profile'}
            />
          </Stack>
        ) : (
          <TextField
            label="Recipient (identity pubkey hex or handle)"
            fullWidth
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="02ab… (recipient identity pubkey)"
          />
        )}

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
  const { activeProfile, managers } = useContext(WalletContext)

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
    return () => { mounted = false }
  }, [peerPay])

  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: '100vh', py: 5 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Wallet Peer-to-Peer Payments
        </Typography>

        <Stack spacing={2}>
          <PaymentForm
            peerPay={peerPay}
            onSent={fetchPayments}
            defaultRecipient={defaultRecipient}
            managers={managers}
            activeProfile={activeProfile}
          />

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
