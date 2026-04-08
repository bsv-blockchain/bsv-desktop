// src/lib/pages/Dashboard/Payments/IncomingRequestList.tsx
import React, { useCallback, useContext, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { WalletInterface } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import { IncomingPaymentRequest } from '@bsv/message-box-client'
import { toast } from 'react-toastify'

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function getInitials(identityKey: string): string {
  return identityKey.slice(0, 2).toUpperCase()
}

function truncateKey(key: string, chars = 14): string {
  if (key.length <= chars + 3) return key
  return `${key.slice(0, chars)}…`
}

function formatTimeRemaining(expiresAt: number): string {
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'Expired'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h remaining`
  const mins = Math.floor(diff / (1000 * 60))
  if (hours > 0) return `${hours}h ${mins % 60}m remaining`
  return `${mins}m remaining`
}

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type Props = {
  requests: IncomingPaymentRequest[]
  onRefresh: () => void
  wallet: WalletInterface
}

type LoadingMap = Record<string, boolean>

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export default function IncomingRequestList({ requests, onRefresh }: Props) {
  const { peerPayClient, messageBoxUrl } = useContext(WalletContext)

  // Per-card state
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [paying, setPaying] = useState<LoadingMap>({})
  const [declining, setDeclining] = useState<LoadingMap>({})

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [permissions, setPermissions] = useState<Array<{ identityKey: string; allowed: boolean }>>([])
  const [newAllowKey, setNewAllowKey] = useState('')
  const [allowError, setAllowError] = useState('')
  const [minAmount, setMinAmount] = useState(() =>
    localStorage.getItem('payReq_minAmount') ?? '1000'
  )
  const [maxAmount, setMaxAmount] = useState(() =>
    localStorage.getItem('payReq_maxAmount') ?? '10000000'
  )
  const [limitsSaved, setLimitsSaved] = useState(false)

  /* ---------------------------------------------------------------- */
  /* Settings helpers                                                  */
  /* ---------------------------------------------------------------- */

  const loadPermissions = useCallback(async () => {
    if (!peerPayClient) return
    setSettingsLoading(true)
    try {
      const list = await peerPayClient.listPaymentRequestPermissions()
      setPermissions(list)
      setSettingsLoaded(true)
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to load permissions')
    } finally {
      setSettingsLoading(false)
    }
  }, [peerPayClient])

  const handleToggleSettings = async () => {
    const next = !settingsOpen
    setSettingsOpen(next)
    if (next && !settingsLoaded) {
      await loadPermissions()
    }
  }

  const handleAllow = async () => {
    const key = newAllowKey.trim()
    if (!key) { setAllowError('Identity key is required'); return }
    if (!peerPayClient) return
    setAllowError('')
    try {
      await peerPayClient.allowPaymentRequestsFrom({ identityKey: key })
      setNewAllowKey('')
      await loadPermissions()
      toast.success('Identity allowed')
    } catch (e) {
      setAllowError((e as Error)?.message ?? 'Failed to allow identity')
    }
  }

  const handleBlock = async (identityKey: string) => {
    if (!peerPayClient) return
    try {
      await peerPayClient.blockPaymentRequestsFrom({ identityKey })
      setPermissions(prev => prev.filter(p => p.identityKey !== identityKey))
      toast.success('Identity removed from whitelist')
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to block identity')
    }
  }

  const saveLimits = () => {
    localStorage.setItem('payReq_minAmount', minAmount)
    localStorage.setItem('payReq_maxAmount', maxAmount)
    setLimitsSaved(true)
    setTimeout(() => setLimitsSaved(false), 2000)
    toast.success('Amount limits saved')
    onRefresh()
  }

  /* ---------------------------------------------------------------- */
  /* Pay / Decline                                                     */
  /* ---------------------------------------------------------------- */

  const handlePay = async (req: IncomingPaymentRequest) => {
    if (!peerPayClient) return
    const id = req.messageId
    setPaying(prev => ({ ...prev, [id]: true }))
    try {
      const rawAmt = payAmounts[id]
      const overrideAmount = rawAmt ? parseInt(rawAmt, 10) : undefined
      const note = notes[id] || undefined
      await peerPayClient.fulfillPaymentRequest(
        { request: req, amount: overrideAmount, note },
        messageBoxUrl || undefined
      )
      window.dispatchEvent(new CustomEvent('balance-changed'))
      toast.success('Payment sent!')
      onRefresh()
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to send payment')
    } finally {
      setPaying(prev => { const n = { ...prev }; delete n[id]; return n })
    }
  }

  const handleDecline = async (req: IncomingPaymentRequest) => {
    if (!peerPayClient) return
    const id = req.messageId
    setDeclining(prev => ({ ...prev, [id]: true }))
    try {
      const note = notes[id] || undefined
      await peerPayClient.declinePaymentRequest(
        { request: req, note },
        messageBoxUrl || undefined
      )
      toast.info('Request declined')
      onRefresh()
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Failed to decline request')
    } finally {
      setDeclining(prev => { const n = { ...prev }; delete n[id]; return n })
    }
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <Stack spacing={2}>
      {/* ---- Settings panel ---- */}
      <Paper elevation={2} sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">Incoming Requests</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" variant="outlined" onClick={handleToggleSettings}>
              {settingsOpen ? 'Hide Settings' : 'Request Settings'}
            </Button>
            <Button size="small" onClick={onRefresh}>Refresh</Button>
          </Stack>
        </Box>

        <Collapse in={settingsOpen} timeout="auto" unmountOnExit>
          <Divider sx={{ my: 2 }} />

          {settingsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {!settingsLoading && settingsLoaded && (
            <Stack spacing={2}>
              {/* Whitelist management */}
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Whitelist Management
              </Typography>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <TextField
                  fullWidth
                  size="small"
                  label="Paste Identity Key to Allow"
                  value={newAllowKey}
                  onChange={(e) => { setNewAllowKey(e.target.value); setAllowError('') }}
                  error={!!allowError}
                  helperText={allowError}
                />
                <Button variant="contained" onClick={handleAllow} sx={{ whiteSpace: 'nowrap', mt: 0.25 }}>
                  Allow
                </Button>
              </Stack>

              {permissions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No whitelisted identities yet.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {permissions.filter(p => p.allowed).map(p => (
                    <ListItem key={p.identityKey} disableGutters>
                      <ListItemText
                        primary={
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                            {truncateKey(p.identityKey, 24)}
                          </Typography>
                        }
                      />
                      <ListItemSecondaryAction>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          onClick={() => handleBlock(p.identityKey)}
                          sx={{ fontSize: '0.72rem', py: 0.25 }}
                        >
                          Remove
                        </Button>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}

              <Divider />

              {/* Amount limits */}
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Amount Limits (satoshis)
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-end">
                <TextField
                  size="small"
                  label="Min Amount"
                  type="number"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  inputProps={{ min: 0 }}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="Max Amount"
                  type="number"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  inputProps={{ min: 0 }}
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={saveLimits}
                  sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {limitsSaved ? 'Saved!' : 'Save'}
                </Button>
              </Stack>
            </Stack>
          )}
        </Collapse>
      </Paper>

      {/* ---- Request cards ---- */}
      {requests.length === 0 ? (
        <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No incoming payment requests.</Typography>
        </Paper>
      ) : (
        requests.map(req => {
          const id = req.messageId
          const isExpired = req.expiresAt < Date.now()
          const isPaying = !!paying[id]
          const isDeclining = !!declining[id]
          const isBusy = isPaying || isDeclining

          return (
            <Paper
              key={id}
              elevation={2}
              sx={{
                p: 2,
                opacity: isExpired ? 0.55 : 1,
                borderLeft: isExpired ? '4px solid #9e9e9e' : '4px solid #4caf50',
              }}
            >
              <Stack spacing={1.5}>
                {/* Header row */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Avatar
                    sx={{
                      width: 38,
                      height: 38,
                      bgcolor: isExpired ? 'grey.500' : 'primary.main',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(req.sender)}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }} noWrap>
                      {truncateKey(req.sender)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatTimeRemaining(req.expiresAt)}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={isExpired ? 'Expired' : 'Pending'}
                    color={isExpired ? 'default' : 'success'}
                    sx={{ flexShrink: 0 }}
                  />
                </Box>

                {/* Amount — prominent */}
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  {req.amount.toLocaleString()} <Typography component="span" variant="body1" color="text.secondary">sats</Typography>
                </Typography>

                {/* Description quote block */}
                <Box
                  sx={{
                    borderLeft: '3px solid',
                    borderColor: 'divider',
                    pl: 1.5,
                    py: 0.5,
                    bgcolor: 'action.hover',
                    borderRadius: '0 4px 4px 0',
                  }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    "{req.description}"
                  </Typography>
                </Box>

                {!isExpired && (
                  <>
                    {/* Inline amount override */}
                    <TextField
                      size="small"
                      label="Amount to Pay (sats)"
                      placeholder={String(req.amount)}
                      value={payAmounts[id] ?? ''}
                      onChange={(e) => setPayAmounts(prev => ({ ...prev, [id]: e.target.value.replace(/[^0-9]/g, '') }))}
                      type="number"
                      inputProps={{ min: 1 }}
                      helperText="Leave blank to pay requested amount"
                      disabled={isBusy}
                    />

                    {/* Optional note */}
                    <TextField
                      size="small"
                      label="Note (optional)"
                      value={notes[id] ?? ''}
                      onChange={(e) => setNotes(prev => ({ ...prev, [id]: e.target.value }))}
                      disabled={isBusy}
                    />

                    {/* Actions */}
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        color="success"
                        disabled={isBusy}
                        onClick={() => handlePay(req)}
                        startIcon={isPaying ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : null}
                        sx={{ flexGrow: 1 }}
                      >
                        {isPaying ? 'Paying…' : 'Pay'}
                      </Button>
                      <Button
                        variant="outlined"
                        disabled={isBusy}
                        onClick={() => handleDecline(req)}
                        startIcon={isDeclining ? <CircularProgress size={16} /> : null}
                        sx={{ flexGrow: 1 }}
                      >
                        {isDeclining ? 'Declining…' : 'Decline'}
                      </Button>
                    </Stack>
                  </>
                )}

                {isExpired && (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    This request has expired and can no longer be fulfilled.
                  </Alert>
                )}
              </Stack>
            </Paper>
          )
        })
      )}
    </Stack>
  )
}
