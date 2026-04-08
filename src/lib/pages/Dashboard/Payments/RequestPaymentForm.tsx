// src/lib/pages/Dashboard/Payments/RequestPaymentForm.tsx
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { PublicKey, WalletInterface } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import { CurrencyConverter } from '@bsv/amountinator'
import { toast } from 'react-toastify'
import useAsyncEffect from 'use-async-effect'
import { useIdentitySearch } from '@bsv/identity-react'
import { PaymentRequestResponse, IncomingPayment } from '@bsv/message-box-client'

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type OutgoingRequest = {
  requestId: string
  recipient: string
  recipientLabel: string
  amount: number
  description: string
  expiresAt: number
  status: 'pending' | 'paid' | 'declined' | 'expired' | 'cancelled' | 'received'
  amountPaid?: number
  note?: string
  /** The incoming payment associated with a fulfilled request, used for accepting funds. */
  incomingPayment?: IncomingPayment
}

type Props = {
  wallet: WalletInterface
  onRequestSent?: () => void
}

type IdentityOption = {
  identityKey: string
  name?: string
  avatarURL?: string
  badgeLabel?: string
}

/* ------------------------------------------------------------------ */
/* Expiry helpers                                                       */
/* ------------------------------------------------------------------ */

const EXPIRY_OPTIONS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
] as const

function getInitials(name: string, identityKey: string): string {
  if (!name || name.trim() === '') return identityKey.slice(0, 2).toUpperCase()
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function statusColor(status: OutgoingRequest['status']): 'success' | 'info' | 'error' | 'default' {
  switch (status) {
    case 'pending': return 'success'
    case 'paid': return 'info'
    case 'received': return 'success'
    case 'declined': return 'error'
    default: return 'default'
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export default function RequestPaymentForm({ wallet, onRequestSent }: Props) {
  const { managers, adminOriginator, peerPayClient, messageBoxUrl, activeProfile } = useContext(WalletContext)

  // Storage key scoped to the current user's identity to prevent cross-account overwrites.
  const storageKey = activeProfile?.identityKey
    ? `payReq_outgoing_${activeProfile.identityKey}`
    : 'payReq_outgoing'

  // Form state
  const [recipient, setRecipient] = useState('')
  const [publicKeyInput, setPublicKeyInput] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [amountInput, setAmountInput] = useState('')
  const [description, setDescription] = useState('')
  const [expiryMs, setExpiryMs] = useState(EXPIRY_OPTIONS[2].ms) // 3 days default
  const [sending, setSending] = useState(false)
  const [currencySymbol, setCurrencySymbol] = useState('$')

  // Outgoing tracker — persisted to localStorage (keyed by identity) so requests survive tab switches
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reload outgoing requests when identity changes (profile switch / re-login).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      setOutgoing(saved ? JSON.parse(saved) : [])
    } catch { setOutgoing([]) }
  }, [storageKey])

  // Persist outgoing requests to localStorage on every change.
  // Exclude incomingPayment (contains transaction data too large for localStorage).
  useEffect(() => {
    const serializable = outgoing.map(({ incomingPayment, ...rest }) => rest)
    localStorage.setItem(storageKey, JSON.stringify(serializable))
  }, [outgoing, storageKey])

  const currencyConverter = new CurrencyConverter(undefined, managers?.settingsManager as any)

  const identitySearch = useIdentitySearch({
    originator: adminOriginator,
    wallet,
    onIdentitySelected: (identity) => {
      if (identity) setRecipient(identity.identityKey)
    }
  })

  useAsyncEffect(async () => {
    await currencyConverter.initialize()
    setCurrencySymbol(currencyConverter.getCurrencySymbol())
  }, [])

  // Poll for responses every 15 seconds when there are pending or paid (unreceived) requests
  const pollResponses = useCallback(async () => {
    if (!peerPayClient || !messageBoxUrl) return
    const hasPending = outgoing.some(r => r.status === 'pending' && r.expiresAt > Date.now())
    const hasPaidUnreceived = outgoing.some(r => r.status === 'paid' && !r.incomingPayment)
    if (!hasPending && !hasPaidUnreceived) return
    try {
      const responses: PaymentRequestResponse[] = await peerPayClient.listPaymentRequestResponses(messageBoxUrl)

      // Also fetch incoming payments to match with fulfilled requests
      let incomingPayments: IncomingPayment[] = []
      if (responses.some(r => r.status === 'paid') || hasPaidUnreceived) {
        incomingPayments = await peerPayClient.listIncomingPayments(messageBoxUrl)
      }

      setOutgoing(prev => prev.map(req => {
        // Don't update already received requests
        if (req.status === 'received') return req

        const match = responses.find(r => r.requestId === req.requestId)
        if (!match) {
          // Try to find incoming payment for already-paid requests missing their payment ref
          if (req.status === 'paid' && !req.incomingPayment) {
            const payment = incomingPayments.find(p => p.sender === req.recipient)
            if (payment) return { ...req, incomingPayment: payment }
          }
          return req
        }

        if (match.status === 'paid') {
          // Find the matching incoming payment from this sender
          const payment = incomingPayments.find(p => p.sender === req.recipient)
          return {
            ...req,
            status: 'paid' as const,
            amountPaid: match.amountPaid,
            note: match.note,
            incomingPayment: payment,
          }
        }
        return {
          ...req,
          status: 'declined' as const,
          note: match.note,
        }
      }))
    } catch {
      // Silently ignore poll errors
    }
  }, [peerPayClient, messageBoxUrl, outgoing])

  // Mark expired requests
  useEffect(() => {
    const tick = setInterval(() => {
      setOutgoing(prev =>
        prev.map(r =>
          r.status === 'pending' && r.expiresAt < Date.now()
            ? { ...r, status: 'expired' }
            : r
        )
      )
    }, 30_000)
    return () => clearInterval(tick)
  }, [])

  // Set up polling: immediate check on mount + interval when there are actionable requests.
  useEffect(() => {
    const needsPoll = outgoing.some(r =>
      r.status === 'pending' || (r.status === 'paid' && !r.incomingPayment)
    )

    if (needsPoll) {
      // Immediate poll on mount / when status changes
      pollResponses()

      // Then continue polling every 15 seconds
      if (!pollRef.current) {
        pollRef.current = setInterval(pollResponses, 15_000)
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [outgoing, pollResponses])

  const handleAmountChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, '')
    setAmountInput(val)
    const sats = await currencyConverter.convertToSatoshis(parseFloat(val) || 0)
    setAmount(sats ?? 0)
  }, [])

  const canRequest =
    recipient.trim().length > 0 &&
    amount > 0 &&
    description.trim().length > 0 &&
    !sending

  const handleSubmit = async () => {
    if (!canRequest || !peerPayClient) return
    try {
      setSending(true)
      const expiresAt = Date.now() + expiryMs
      const { requestId } = await peerPayClient.requestPayment(
        { recipient: recipient.trim(), amount, description: description.trim(), expiresAt },
        messageBoxUrl || undefined
      )
      const label =
        identitySearch.selectedIdentity
          ? (identitySearch.selectedIdentity as IdentityOption).name ||
            (identitySearch.selectedIdentity as IdentityOption).identityKey.slice(0, 14)
          : recipient.slice(0, 14)
      setOutgoing(prev => [
        {
          requestId,
          recipient: recipient.trim(),
          recipientLabel: label,
          amount,
          description: description.trim(),
          expiresAt,
          status: 'pending',
        },
        ...prev,
      ])
      toast.success('Payment request sent!')
      setAmountInput('')
      setAmount(0)
      setDescription('')
      setRecipient('')
      setPublicKeyInput('')
      identitySearch.handleSelect(null, null)
      onRequestSent?.()
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Failed to send payment request'
      toast.error(msg)
    } finally {
      setSending(false)
    }
  }

  const handleCancel = async (req: OutgoingRequest) => {
    if (!peerPayClient) return
    try {
      setCancellingId(req.requestId)
      await peerPayClient.cancelPaymentRequest(
        { recipient: req.recipient, requestId: req.requestId },
        messageBoxUrl || undefined
      )
      setOutgoing(prev =>
        prev.map(r => r.requestId === req.requestId ? { ...r, status: 'cancelled' } : r)
      )
      toast.success('Request cancelled')
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to cancel request')
    } finally {
      setCancellingId(null)
    }
  }

  /** Accept/internalize the payment associated with a fulfilled request. */
  const handleReceive = async (req: OutgoingRequest) => {
    if (!peerPayClient || !req.incomingPayment) return
    try {
      setReceivingId(req.requestId)
      await peerPayClient.acceptPayment(req.incomingPayment)
      setOutgoing(prev =>
        prev.map(r => r.requestId === req.requestId ? { ...r, status: 'received' as const } : r)
      )
      window.dispatchEvent(new CustomEvent('balance-changed'))
      toast.success('Payment received!')
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to receive payment')
    } finally {
      setReceivingId(null)
    }
  }

  return (
    <Stack spacing={2}>
      {/* ---- Form ---- */}
      <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Request Payment
        </Typography>
        <Stack spacing={2}>
          {/* Recipient autocomplete */}
          <Autocomplete
            options={identitySearch.identities}
            loading={identitySearch.isLoading}
            inputValue={identitySearch.inputValue}
            value={identitySearch.selectedIdentity}
            onInputChange={identitySearch.handleInputChange}
            onChange={(event, value) => {
              identitySearch.handleSelect(event, value as any)
              if (value && typeof value !== 'string') {
                setRecipient((value as IdentityOption).identityKey)
                setPublicKeyInput((value as IdentityOption).identityKey)
              } else {
                setRecipient('')
                setPublicKeyInput('')
              }
            }}
            filterOptions={(options: IdentityOption[]) =>
              options.filter(
                (identity, index, array) =>
                  array.findIndex(i => i.identityKey === identity.identityKey) === index
              )
            }
            getOptionLabel={(option) => {
              if (typeof option === 'string') return option
              return (option as IdentityOption).name || (option as IdentityOption).identityKey.slice(0, 16)
            }}
            isOptionEqualToValue={(option, value) => {
              if (typeof option === 'string' || typeof value === 'string') return false
              return (option as IdentityOption).identityKey === (value as IdentityOption).identityKey
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search for Recipient"
                placeholder="Search by name, email, etc."
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {identitySearch.isLoading ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  )
                }}
              />
            )}
            renderOption={(props, option) => {
              if (typeof option === 'string') return null
              const opt = option as IdentityOption
              const { key, ...otherProps } = props as any
              return (
                <li key={key + opt.identityKey} {...otherProps}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                    {opt.avatarURL ? (
                      <Avatar src={opt.avatarURL} alt={opt.name} sx={{ width: 40, height: 40 }} />
                    ) : (
                      <Avatar sx={{ width: 40, height: 40, bgcolor: 'secondary.main', fontSize: '0.875rem', fontWeight: 600 }}>
                        {getInitials(opt.name || '', opt.identityKey)}
                      </Avatar>
                    )}
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>{opt.name || 'Unknown'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                        {opt.identityKey.slice(0, 20)}...
                      </Typography>
                    </Box>
                    {opt.badgeLabel && <Chip size="small" label={opt.badgeLabel} sx={{ ml: 1 }} />}
                  </Box>
                </li>
              )
            }}
            noOptionsText={identitySearch.inputValue ? 'No identities found' : 'Start typing to search'}
            fullWidth
          />

          {/* Direct public key fallback */}
          <TextField
            fullWidth
            label={identitySearch.selectedIdentity ? 'Selected Recipient Identity Key' : 'Or Enter Recipient Public Key'}
            value={publicKeyInput}
            onChange={(e) => {
              const val = e.target.value.trim()
              setPublicKeyInput(val)
              if (val) {
                try {
                  PublicKey.fromString(val)
                  setRecipient(val)
                  identitySearch.handleSelect(null, null)
                } catch {
                  setRecipient('')
                }
              } else {
                setRecipient('')
              }
            }}
            disabled={!!identitySearch.selectedIdentity}
            error={Boolean(publicKeyInput && !recipient && !identitySearch.selectedIdentity)}
            helperText={publicKeyInput && !recipient && !identitySearch.selectedIdentity ? 'Invalid public key' : ''}
          />

          {/* Amount */}
          <TextField
            fullWidth
            label="Amount to Request"
            value={amountInput}
            onChange={handleAmountChange}
            InputProps={{
              startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>
            }}
          />

          {/* Description */}
          <TextField
            fullWidth
            label="Description"
            placeholder="What is this request for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          {/* Expiry */}
          <FormControl fullWidth>
            <InputLabel id="expiry-label">Expires In</InputLabel>
            <Select
              labelId="expiry-label"
              label="Expires In"
              value={expiryMs}
              onChange={(e) => setExpiryMs(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map(opt => (
                <MenuItem key={opt.ms} value={opt.ms}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box>
            <Button
              variant="contained"
              disabled={!canRequest}
              onClick={handleSubmit}
              startIcon={sending ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : null}
            >
              {sending ? 'Sending…' : 'Request Payment'}
            </Button>
          </Box>
        </Stack>
      </Paper>

      {/* ---- Outgoing tracker ---- */}
      {outgoing.length > 0 && (
        <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Sent Requests
          </Typography>
          <Stack spacing={1.5}>
            {outgoing.map(req => (
              <Paper
                key={req.requestId}
                variant="outlined"
                sx={{
                  p: 1.5,
                  opacity: ['expired', 'cancelled'].includes(req.status) ? 0.55 : 1,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.78rem', mb: 0.5 }} noWrap>
                      To: {req.recipientLabel}…
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {req.amount.toLocaleString()} sats
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                      {req.description}
                    </Typography>
                    {req.status === 'paid' && req.amountPaid != null && (
                      <Typography variant="body2" color="info.main" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        Paid: {req.amountPaid.toLocaleString()} sats
                      </Typography>
                    )}
                    {req.note && (
                      <Box sx={{ borderLeft: '3px solid', borderColor: 'divider', pl: 1.5, py: 0.5, mt: 0.5, bgcolor: 'action.hover', borderRadius: '0 4px 4px 0' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          "{req.note}"
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Chip
                      size="small"
                      label={req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      color={statusColor(req.status)}
                    />
                    {req.status === 'pending' && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        disabled={cancellingId === req.requestId}
                        onClick={() => handleCancel(req)}
                        sx={{ fontSize: '0.72rem', py: 0.25, minWidth: 64 }}
                      >
                        {cancellingId === req.requestId ? <CircularProgress size={12} /> : 'Cancel'}
                      </Button>
                    )}
                    {req.status === 'paid' && req.incomingPayment && (
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        disabled={receivingId === req.requestId}
                        onClick={() => handleReceive(req)}
                        startIcon={receivingId === req.requestId ? <CircularProgress size={12} sx={{ color: 'inherit' }} /> : null}
                        sx={{ fontSize: '0.72rem', py: 0.25, minWidth: 64 }}
                      >
                        {receivingId === req.requestId ? 'Receiving…' : 'Receive'}
                      </Button>
                    )}
                    {req.status === 'paid' && !req.incomingPayment && (
                      <Typography variant="caption" color="text.secondary">
                        Waiting for payment…
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </Paper>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  )
}
