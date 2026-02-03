// src/routes/PeerPayRoute.tsx
import React, { useCallback, useEffect, useMemo, useState, useContext } from 'react'
import { useHistory } from 'react-router'
import {
  Alert,
  Avatar,
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
  FormControl,
  CircularProgress,
  Autocomplete,
  Card,
  CardContent,
  Link
} from '@mui/material'
import InputAdornment from '@mui/material/InputAdornment'
import { IncomingPayment } from '@bsv/message-box-client'
import { Utils, WalletClient, Script, PublicKey, WalletInterface } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import { toast } from 'react-toastify'
import { CurrencyConverter } from '@bsv/amountinator'
import useAsyncEffect from 'use-async-effect'
import { WalletProfile } from '../../../types/WalletProfile'
import { OutlinedInput, Tabs, Tab } from '@mui/material'
import { useIdentitySearch } from '@bsv/identity-react'
import MessageBoxConfig from '../../../components/MessageBoxConfig/index.tsx'

/* --------------------------- Inline: Payment Form -------------------------- */
type PaymentFormProps = {
  onSent?: () => void
  wallet: WalletInterface
}
function PaymentForm({ wallet, onSent }: PaymentFormProps) {
  const {managers, messageBoxUrl, activeProfile, peerPayClient, loginType, adminOriginator } = useContext(WalletContext)
  const isDirectKey = loginType === 'direct-key'
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [sending, setSending] = useState(false)
  const [profiles, setProfiles] = useState<WalletProfile[]>([])
  const [currencySymbol, setCurrencySymbol] = useState('$')
  const currencyConverter = new CurrencyConverter(undefined, managers?.settingsManager as any)
  const [input, setInput] = useState('')
  const [tabValue, setTabValue] = useState(0) // 0 = profiles, 1 = anyone
  const [publicKeyInput, setPublicKeyInput] = useState('')

  // Identity search hook for "Send to Anyone" tab
  const identitySearch = useIdentitySearch({
    originator: adminOriginator,
    wallet,
    onIdentitySelected: (identity) => {
      if (identity) {
        setRecipient(identity.identityKey)
      }
    }
  })

  // Generate initials from identity info
  const getInitials = (name: string, identityKey: string): string => {
    if (!name || name.trim() === '') {
      // If no name, use first 2 characters of identity key
      return identityKey.slice(0, 2).toUpperCase()
    }

    const words = name.trim().split(/\s+/)
    if (words.length >= 2) {
      // First letter of first word + first letter of last word
      return (words[0][0] + words[words.length - 1][0]).toUpperCase()
    } else {
      // Single word: take first 2 letters
      return name.slice(0, 2).toUpperCase()
    }
  }

  useAsyncEffect(async () => {
    // Note: Handle errors at a higher layer!
    await currencyConverter.initialize()
    setCurrencySymbol(currencyConverter.getCurrencySymbol())
  }, [])

  const otherProfiles = useMemo(
    () => profiles.filter(p => p.identityKey !== activeProfile?.identityKey),
    [profiles, activeProfile?.identityKey]
  )

  const handleAmountChange = useCallback(async (event) => {
    const input = event.target.value.replace(/[^0-9.]/g, '')
    if (input !== amount) {
      setInput(input)
      const satoshis = await currencyConverter.convertToSatoshis(input)
      setAmount(satoshis)
    }
  }, [])

  useEffect(() => {
    if (isDirectKey) return // No profiles in direct-key mode
    let alive = true
      ; (async () => {
        try {
          if (!managers?.walletManager || !managers.walletManager.listProfiles) return
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
  }, [managers, isDirectKey])

  const canSend = recipient.trim().length > 0 && amount > 0 && !sending

  const send = async () => {
    console.log({ canSend, peerPayClient, amount , recipient, sending })
    if (!canSend || !peerPayClient) throw new Error('peerPayClient is not initialized')
    try {
      setSending(true)
      await peerPayClient.sendPayment({
        recipient: recipient.trim(),
        amount
      })
      onSent?.()
      toast.success('Payment Success!')
      setInput('0')
      // Dispatch custom event to refresh balance
      window.dispatchEvent(new CustomEvent('balance-changed'))
    } catch (e) {
      toast.error('[PaymentForm] sendPayment error:', e as any)
      alert((e as Error)?.message ?? 'Failed to send payment')
    } finally {
      setSending(false)
    }
  }

  type IdentityOption = {
    identityKey: string
    name?: string
    avatarURL?: string
    badgeLabel?: string
  } | string

  type StrictIdentityOption = {
    identityKey: string
  }

  return (
    <Paper elevation={2} sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Create New Payment
      </Typography>
      <Stack spacing={2}>
        {!isDirectKey && (
          <Tabs value={tabValue} onChange={(e, newValue) => {
            setTabValue(newValue)
            setRecipient('')
          }}>
            <Tab label="Pay Someone" />
            <Tab label="Internal Transfer" />
          </Tabs>
        )}

        {(tabValue === 0 || isDirectKey) ? (
          <>
            <Autocomplete
              options={identitySearch.identities}
              loading={identitySearch.isLoading}
              inputValue={identitySearch.inputValue}
              value={identitySearch.selectedIdentity}
              onInputChange={identitySearch.handleInputChange}
              onChange={(event, value) => {
                identitySearch.handleSelect(event, value as any);
                if (value && typeof value !== 'string') {
                  setRecipient(value.identityKey);
                  setPublicKeyInput(value.identityKey); // show selected identity key
                } else {
                  setRecipient('');
                  setPublicKeyInput('');
                }
              }}
              filterOptions={(options: IdentityOption[]) => options.filter((identity: IdentityOption, index, array) => array.findIndex((i: StrictIdentityOption) => i.identityKey === (identity as StrictIdentityOption).identityKey) === index)}
              getOptionLabel={(option) => {
                if (typeof option === 'string') return option
                return option.name || option.identityKey.slice(0, 16)
              }}
              isOptionEqualToValue={(option, value) => {
                if (typeof option === 'string' || typeof value === 'string') return false
                return option.identityKey === value.identityKey
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
                const { key, ...otherProps } = props
                return (
                  <li key={key + option.identityKey} {...otherProps}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                      {option.avatarURL ? (
                        <Avatar
                          src={option.avatarURL}
                          alt={option.name}
                          sx={{ width: 40, height: 40 }}
                        />
                      ) : (
                        <Avatar
                          sx={{
                            width: 40,
                            height: 40,
                            bgcolor: 'primary.main',
                            fontSize: '0.875rem',
                            fontWeight: 600
                          }}
                        >
                          {getInitials(option.name, option.identityKey)}
                        </Avatar>
                      )}
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="body1" sx={{ fontWeight: 500 }}>
                          {option.name || 'Unknown'}
                        </Typography>
                        <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                          {option.identityKey.slice(0, 20)}...
                        </Typography>
                      </Box>
                      {option.badgeLabel && (
                        <Chip
                          size="small"
                          label={option.badgeLabel}
                          sx={{ ml: 1 }}
                        />
                      )}
                    </Box>
                  </li>
                )
              }}
              noOptionsText={identitySearch.inputValue ? "No identities found" : "Start typing to search"}
              fullWidth
            />
            <TextField
              fullWidth
              label={identitySearch.selectedIdentity ? "Selected Recipient Identity Key" : "Or Enter Recipient Public Key"}
              value={publicKeyInput}
              onChange={(e) => {
                const val = e.target.value.trim();
                setPublicKeyInput(val);
                if (val) {
                  try {
                    PublicKey.fromString(val);
                    setRecipient(val);
                    // Clear the autocomplete selection
                    identitySearch.handleSelect(null, null);
                  } catch (error) {
                    setRecipient('');
                  }
                } else {
                  setRecipient('');
                }
              }}
              disabled={!!identitySearch.selectedIdentity}
              error={Boolean(publicKeyInput && !recipient && !identitySearch.selectedIdentity)}
              helperText={publicKeyInput && !recipient && !identitySearch.selectedIdentity ? 'Invalid public key' : ''}
              sx={{ mt: 1 }}
            />
          </>
        ) : (
          <FormControl fullWidth>
            <Select
              label="Destination Profile"
              value={recipient || ''}
              displayEmpty
              onChange={(e) => setRecipient(e.target.value as string)}
              renderValue={(val) => {
                if (!val) return 'Select a profile'
                const p = profiles.find(p => p.identityKey === val)
                return p ? `${p.name} — ${p.identityKey.slice(0, 10)}` : ''
              }}
              input={<OutlinedInput notched={false} />}
            >
              {otherProfiles.map((p) => (
                <MenuItem key={p.identityKey} value={p.identityKey}>
                  {p.name} — {p.identityKey.slice(0, 10)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
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
}

function PaymentList({ payments, onRefresh }: PaymentListProps) {
  // Track loading per messageId so buttons aren't linked
  const { messageBoxUrl, useMessageBox, peerPayClient } = useContext(WalletContext)

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
    if (!peerPayClient) return false
    const id = String(p.messageId)
    setLoadingFor(id, true)
    try {
      await peerPayClient.acceptPayment(p)
      return true
    } catch (e1) {
      toast.error('[PaymentList] acceptPayment raw failed → refetching by id', e1 as any)
      try {
        const list = await peerPayClient.listIncomingPayments(messageBoxUrl)
        const fresh = list.find(x => String(x.messageId) === id)
        if (!fresh) throw new Error('Payment not found on refresh')
        await peerPayClient.acceptPayment(fresh)
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
      // Dispatch custom event to refresh balance on successful payment
      window.dispatchEvent(new CustomEvent('balance-changed'))
    } catch (e) {
      toast.error('[PaymentList] acceptPayment error (final):', e as any)
      alert((e as Error)?.message ?? 'Failed to accept payment')
    } finally {
      onRefresh()
    }
  }

  if (!useMessageBox || !messageBoxUrl) {
    return null
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
export default function PeerPayRoute() {
  const {
    messageBoxUrl,
    managers,
    useMessageBox,
    peerPayClient,
    isHostAnointed,
    anointCurrentHost,
    anointmentLoading
  } = useContext(WalletContext)
  const wallet = managers?.walletManager ? new WalletClient(managers.walletManager, 'desktop.bsvb.tech') : null

  const [payments, setPayments] = useState<IncomingPayment[]>([])
  const [loading, setLoading] = useState(false)
  const [transactions, setTransactions] = useState([])
  const [snack, setSnack] = useState<{ open: boolean; msg: string; severity: 'success' | 'info' | 'warning' | 'error' }>({
    open: false,
    msg: '',
    severity: 'info',
  })

  const fetchPayments = useCallback(async () => {
    try {
      if (!peerPayClient || !messageBoxUrl) return
      setLoading(true)
      const list = await peerPayClient.listIncomingPayments(messageBoxUrl)
      setPayments(list)
    } catch (e) {
      setSnack({ open: true, msg: (e as Error)?.message ?? 'Failed to load payments', severity: 'error' })
    } finally {
      setLoading(false)
    }
  }, [peerPayClient, messageBoxUrl])

  const getPastTransactions = async () => {
    if (!wallet) return

    try {
      const response = await wallet.listActions({
        labels: ['peerpay'],
        labelQueryMode: 'any',
        includeOutputLockingScripts: true,
        includeOutputs: true,
        limit: 100,
      })

      console.log({ response })

      setTransactions((txs) => {
        const set = new Set(txs.map((tx) => tx.txid))
        const pastTxs = response.actions.map((action) => {
          let address = ''
          // Try to find BSV recipient output first
          try {
            address = Utils.toBase58Check(
              Script.fromHex(action.outputs![0].lockingScript!).chunks[2].data as number[]
            )
          } catch (error) {
            console.log({ error })
            address = ''
          }

          return {
            txid: action.txid,
            to: address || 'unknown',
            amount: action.satoshis / 100000000,
          }
        })
        const newTxs = pastTxs.filter((tx) => tx.amount !== 0 && !set.has(tx.txid))
        return [...txs, ...newTxs]
      })
    } catch (error) {
      console.error('Error fetching transactions:', error)
    }
  }

  // If Message Box is not configured, show configuration UI instead
  if (!useMessageBox || !messageBoxUrl || !peerPayClient) {
    return (
      <Container maxWidth="sm">
        <Box sx={{ minHeight: '100vh', py: 5 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            Setup Required
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
            To send and receive payments with other users, enter your Message Box server URL below.
          </Typography>
          <MessageBoxConfig embedded showTitle={false} />
        </Box>
      </Container>
    )
  }

  // If Message Box is configured but host is not anointed, show anoint prompt
  if (!isHostAnointed) {
    return (
      <Container maxWidth="sm">
        <Box sx={{ minHeight: '100vh', py: 5 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            Anoint Host Required
          </Typography>
          <Alert severity="warning" sx={{ mb: 3 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Your Message Box URL is configured, but you need to anoint the host before you can receive payments.
              Anointing broadcasts your identity to the overlay network so others can find and send payments to you.
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              Host: {messageBoxUrl}
            </Typography>
            <Button
              variant="contained"
              onClick={anointCurrentHost}
              disabled={anointmentLoading}
              startIcon={anointmentLoading ? <CircularProgress size={16} /> : null}
            >
              {anointmentLoading ? 'Anointing...' : 'Anoint Host'}
            </Button>
          </Alert>
          <Typography variant="body2" color="textSecondary">
            You can also manage your Message Box configuration in Settings.
          </Typography>
        </Box>
      </Container>
    )
  }

  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: '100vh', py: 5 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Payments
        </Typography>

        <Stack spacing={2}>
          <PaymentForm
            onSent={fetchPayments}
            wallet={wallet}
          />

          {loading && <LinearProgress />}

          <PaymentList payments={payments} onRefresh={fetchPayments} />

          {/* Transaction History Section */}
          <Paper elevation={2} sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 500 }}>
              Transaction History
            </Typography>
            <Divider sx={{ mb: 2 }} />

            <Button variant="outlined" onClick={getPastTransactions} fullWidth sx={{ mb: 2 }}>
              Refresh Transactions
            </Button>

            {transactions.length === 0 ? (
              <Typography variant="body2" color="textSecondary" sx={{ textAlign: 'center', py: 3 }}>
                No transactions yet...
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {transactions.map((tx, index) => (
                  <Card key={index} variant="outlined">
                    <CardContent>
                      <Typography variant="body2" color="textSecondary">
                        <strong>TXID:</strong>{' '}
                        <Link
                          href={`https://whatsonchain.com/tx/${tx.txid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {tx.txid}
                        </Link>
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        <strong>To:</strong> {tx.to || 'N/A'}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        <strong>Amount:</strong> {tx.amount || 'N/A'} BSV
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </Paper>
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
