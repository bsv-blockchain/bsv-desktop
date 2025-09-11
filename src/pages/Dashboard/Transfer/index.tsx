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
  FormControl,
  CircularProgress
} from '@mui/material'
import InputAdornment from '@mui/material/InputAdornment'
import { PeerPayClient, IncomingPayment } from '@bsv/message-box-client'
import { PubKeyHex, WalletClient } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import { toast } from 'react-toastify'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'
import { MESSAGEBOX_HOST } from '../../../config'
import { CurrencyConverter } from 'amountinator'
import useAsyncEffect from 'use-async-effect'
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
  active: boolean,
  identityKey: PubKeyHex
}

function PaymentForm({ peerPay, onSent, defaultRecipient, managers, activeProfile }: PaymentFormProps) {
  const [recipient, setRecipient] = useState(defaultRecipient ?? '')
  const [amount, setAmount] = useState<number>(0)
  const [sending, setSending] = useState(false)
  const [profiles, setProfiles] = useState<WalletProfile[]>([])
  const [destProfileId, setDestProfileId] = useState<string>('')
  const [currencySymbol, setCurrencySymbol] = useState('$')
  const currencyConverter = new CurrencyConverter()
  const [input, setInput] = useState('')
  useAsyncEffect(async () => {
    // Note: Handle errors at a higher layer!
    await currencyConverter.initialize()
    setCurrencySymbol(currencyConverter.getCurrencySymbol())
  }, [])

  const handleAmountChange = useCallback(async (event) => {
    const input = event.target.value.replace(/[^0-9.]/g, '')
    if (input !== amount) {
      setInput(input)
      const satoshis = await currencyConverter.convertToSatoshis(input)
      setAmount(satoshis)
    }
  }, [])

  useEffect(() => {
    let alive = true
      ; (async () => {
        try {
          if (!managers?.walletManager) return
          const list: WalletProfile[] = await managers.walletManager.listProfiles()
          if (!alive) return
          const cloned = list.map(p => ({
            id: [...p.id],
            name: String(p.name),
            createdAt: p.createdAt ?? null,
            active: !!p.active,
            identityKey: p.identityKey
          }))
          setProfiles(cloned)
        } catch (e) {
          toast.error('[PaymentForm] listProfiles error:', e as any)
        }
      })()
    return () => { alive = false }
  }, [managers])

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
      toast.error('[PaymentForm] sendLivePayment error:', e as any)
      alert((e as Error)?.message ?? 'Failed to send payment')
    } finally {
      setSending(false)
    }
  }

  return (
    <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Transfer
      </Typography>
      <Stack spacing={2}>
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel id="dest-profile-label">Destination Profile</InputLabel>
            <Select
              labelId="dest-profile-label"
              label="Destination Profile"
              value={recipient || ''}                 // recipient is the identityKey string
              displayEmpty
              onChange={(e) => setRecipient(e.target.value as string)}
              renderValue={(val) => {
                if (!val) return ''
                const p = profiles.find(p => p.identityKey === val)  // <- fix
                return p ? `${p.name} — ${p.identityKey.slice(0, 10)}` : ''
              }}
            >
              {profiles.map((p) => (
                <MenuItem key={p.identityKey} value={p.identityKey}>
                  {p.name} — {p.identityKey.slice(0, 10)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Enter Amount"
            variant="outlined"
            value={input}
            onChange={handleAmountChange}
            InputProps={{
              startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>
            }}
            fullWidth
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
  // Track loading per messageId so buttons aren't linked
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({})

  const setLoadingFor = (id: string, on: boolean) => {
    setLoadingById(prev => {
      if (on) return { ...prev, [id]: true }
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const acceptWithRetry = async (p: IncomingPayment) => {
    const id = String(p.messageId)
    setLoadingFor(id, true)
    try {
      await peerPay.acceptPayment(p)
      return true
    } catch (e1) {
      toast.error('[PaymentList] acceptPayment raw failed → refetching by id', e1 as any)
      try {
        const list = await peerPay.listIncomingPayments(MESSAGEBOX_HOST)
        const fresh = list.find(x => String(x.messageId) === id)
        if (!fresh) throw new Error('Payment not found on refresh')
        await peerPay.acceptPayment(fresh)
        return true
      } catch (e2) {
        toast.error('[PaymentList] acceptPayment refresh retry failed', e2 as any)
        return false
      } finally {
        setLoadingFor(id, false)
      }
    } finally {
      // Ensure we clear loading even on the success path
      setLoadingFor(id, false)
    }
  }

  const accept = async (p: IncomingPayment) => {
    try {
      const ok = await acceptWithRetry(p)
      if (!ok) throw new Error('Accept failed')
    } catch (e) {
      toast.error('[PaymentList] acceptPayment error (final):', e as any)
      alert((e as Error)?.message ?? 'Failed to accept payment')
    } finally {
      onRefresh()
    }
  }

  return (
    <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h6">Pending Transfer</Typography>
        <Button onClick={onRefresh}>Refresh</Button>
      </Box>

      {payments.length === 0 ? (
        <Typography color="text.secondary">No pending transfers.</Typography>
      ) : (
        <List sx={{ width: '100%' }}>
          {payments.map((p) => {
            const id = String(p.messageId)
            const isLoading = !!loadingById[id]
            return (
              <React.Fragment key={id}>
                <ListItem
                  secondaryAction={
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={
                          isLoading ? <CircularProgress size={16} sx={{ color: 'black' }} /> : null
                        }
                        disabled={isLoading}
                        onClick={() => accept(p)}
                      >
                        {isLoading ? 'Receiving' : 'receive'}
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label={`${p.token.amount} sats`} />
                        <Typography fontFamily="monospace" fontSize="0.9rem">
                          {id.slice(0, 10)}…
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
            )
          })}
        </List>
      )}
    </Paper>
  )
}

/* ------------------------------- Route View -------------------------------- */
export default function PeerPayRoute({ walletClient, defaultRecipient }: PeerPayRouteProps) {
  const { activeProfile, managers, adminOriginator } = useContext(WalletContext)

  const peerPay = useMemo(() => {
    const wc = managers.permissionsManager
    return new PeerPayClient({
      walletClient: wc,
      messageBoxHost: MESSAGEBOX_HOST,
      enableLogging: true,
      originator: adminOriginator
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
      ; (async () => {
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
          // silently handle errors
        }
      })()
    return () => { mounted = false }
  }, [peerPay])

  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: '100vh', py: 5 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Wallet Transfer
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
