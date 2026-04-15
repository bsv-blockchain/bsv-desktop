// src/lib/pages/Dashboard/Payments/IncomingRequestList.tsx
import React, { useCallback, useContext, useEffect, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { PublicKey, WalletInterface } from '@bsv/sdk'
import { WalletContext } from '../../../WalletContext'
import { IncomingPaymentRequest } from '@bsv/message-box-client'
import { toast } from 'react-toastify'
import { useIdentitySearch } from '@bsv/identity-react'
import { useTranslation } from 'react-i18next'

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

export default function IncomingRequestList({ requests, onRefresh, wallet }: Props) {
  const { t } = useTranslation()
  const { peerPayClient, messageBoxUrl, adminOriginator, activeProfile } = useContext(WalletContext)

  // Storage keys scoped to the current user's identity to prevent cross-account overwrites.
  const idSuffix = activeProfile?.identityKey ? `_${activeProfile.identityKey}` : ''
  const whitelistKey = `payReq_whitelist${idSuffix}`
  const minAmountKey = `payReq_minAmount${idSuffix}`
  const maxAmountKey = `payReq_maxAmount${idSuffix}`
  const whitelistEnabledKey = `payReq_whitelistEnabled${idSuffix}`

  // Per-card state
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [paying, setPaying] = useState<LoadingMap>({})
  const [declining, setDeclining] = useState<LoadingMap>({})

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [permissions, setPermissions] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(whitelistKey) ?? '[]')
    } catch { return [] }
  })
  const [whitelistKeyInput, setWhitelistKeyInput] = useState('')
  const [allowError, setAllowError] = useState('')
  const [minAmount, setMinAmount] = useState(() =>
    localStorage.getItem(minAmountKey) ?? '1000'
  )
  const [maxAmount, setMaxAmount] = useState(() =>
    localStorage.getItem(maxAmountKey) ?? '10000000'
  )
  const [limitsSaved, setLimitsSaved] = useState(false)

  // Whitelist toggle (on/off)
  const [whitelistEnabled, setWhitelistEnabled] = useState(() =>
    localStorage.getItem(whitelistEnabledKey) !== 'false'
  )

  // Identity search for whitelist
  const whitelistIdentitySearch = useIdentitySearch({
    originator: adminOriginator,
    wallet,
    onIdentitySelected: (identity) => {
      if (identity) {
        setWhitelistKeyInput(identity.identityKey)
      }
    }
  })

  /* ---------------------------------------------------------------- */
  /* Settings helpers                                                  */
  /* ---------------------------------------------------------------- */

  /** Persist the whitelist to localStorage. */
  const saveWhitelist = useCallback((list: string[]) => {
    setPermissions(list)
    localStorage.setItem(whitelistKey, JSON.stringify(list))
  }, [whitelistKey])

  const handleToggleSettings = () => {
    setSettingsOpen(prev => !prev)
  }

  const handleToggleWhitelist = (enabled: boolean) => {
    setWhitelistEnabled(enabled)
    localStorage.setItem(whitelistEnabledKey, String(enabled))
  }

  const handleAllow = async () => {
    const key = whitelistKeyInput.trim()
    if (!key) { setAllowError(t('incoming_request_list_identity_key_required')); return }
    if (permissions.includes(key)) { setAllowError(t('incoming_request_list_already_whitelisted')); return }
    setAllowError('')

    // Best-effort server-side permission set (may not persist on all servers).
    if (peerPayClient) {
      try {
        await peerPayClient.allowPaymentRequestsFrom({ identityKey: key })
      } catch (e) {
        console.warn('[IncomingRequestList] Server-side allow failed (non-blocking):', e)
      }
    }

    // Authoritative: persist in localStorage.
    saveWhitelist([...permissions, key])
    setWhitelistKeyInput('')
    whitelistIdentitySearch.handleSelect(null, null)
    toast.success(t('incoming_request_list_identity_whitelisted'))
  }

  const handleBlock = async (identityKey: string) => {
    // Best-effort server-side block.
    if (peerPayClient) {
      try {
        await peerPayClient.blockPaymentRequestsFrom({ identityKey })
      } catch (e) {
        console.warn('[IncomingRequestList] Server-side block failed (non-blocking):', e)
      }
    }

    // Authoritative: remove from localStorage.
    saveWhitelist(permissions.filter(k => k !== identityKey))
    toast.success(t('incoming_request_list_identity_removed'))
  }

  const saveLimits = () => {
    localStorage.setItem(minAmountKey, minAmount)
    localStorage.setItem(maxAmountKey, maxAmount)
    setLimitsSaved(true)
    setTimeout(() => setLimitsSaved(false), 2000)
    toast.success(t('incoming_request_list_limits_saved'))
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
      const note = notes[id] || undefined
      await peerPayClient.fulfillPaymentRequest(
        { request: req, note },
        messageBoxUrl || undefined
      )
      window.dispatchEvent(new CustomEvent('balance-changed'))
      toast.success(t('incoming_request_list_payment_sent'))
      onRefresh()
    } catch (e) {
      toast.error((e as Error)?.message ?? t('incoming_request_list_failed_to_send'))
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
      toast.info(t('incoming_request_list_request_declined'))
      onRefresh()
    } catch (e) {
      toast.error((e as Error)?.message ?? t('incoming_request_list_failed_to_decline'))
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
          <Typography variant="h6">{t('incoming_request_list_title')}</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" variant="outlined" onClick={handleToggleSettings}>
              {settingsOpen ? t('incoming_request_list_hide_settings') : t('incoming_request_list_request_settings')}
            </Button>
            <Button size="small" onClick={onRefresh}>{t('incoming_request_list_refresh')}</Button>
          </Stack>
        </Box>

        <Collapse in={settingsOpen} timeout="auto" unmountOnExit>
          <Divider sx={{ my: 2 }} />

          <Stack spacing={2}>
              {/* Whitelist toggle */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {t('incoming_request_list_identity_whitelist')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('incoming_request_list_whitelist_description')}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    size="small"
                    label={whitelistEnabled ? t('incoming_request_list_on') : t('incoming_request_list_off')}
                    color={whitelistEnabled ? 'success' : 'default'}
                    sx={{ fontWeight: 600, minWidth: 44 }}
                  />
                  <Switch
                    checked={whitelistEnabled}
                    onChange={(e) => handleToggleWhitelist(e.target.checked)}
                  />
                </Stack>
              </Box>

              {/* Whitelist management — only shown when enabled */}
              <Collapse in={whitelistEnabled}>
                <Stack spacing={2}>
                  {/* Identity search for adding */}
                  <Autocomplete
                    options={whitelistIdentitySearch.identities}
                    loading={whitelistIdentitySearch.isLoading}
                    inputValue={whitelistIdentitySearch.inputValue}
                    value={whitelistIdentitySearch.selectedIdentity}
                    onInputChange={whitelistIdentitySearch.handleInputChange}
                    onChange={(event, value) => {
                      whitelistIdentitySearch.handleSelect(event, value as any)
                      if (value && typeof value !== 'string') {
                        setWhitelistKeyInput(value.identityKey)
                      } else {
                        setWhitelistKeyInput('')
                      }
                    }}
                    getOptionLabel={(option) =>
                      typeof option === 'string' ? option : option.name || option.identityKey.slice(0, 16)
                    }
                    isOptionEqualToValue={(option, value) => {
                      if (typeof option === 'string' || typeof value === 'string') return false
                      return option.identityKey === value.identityKey
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        label={t('incoming_request_list_search_to_whitelist')}
                        placeholder={t('incoming_request_list_search_placeholder')}
                      />
                    )}
                    renderOption={(props, option) => {
                      if (typeof option === 'string') return null
                      const { key, ...otherProps } = props
                      return (
                        <li key={key + option.identityKey} {...otherProps}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: '0.75rem' }}>
                              {getInitials(option.identityKey)}
                            </Avatar>
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={500}>{option.name || t('incoming_request_list_unknown')}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                {option.identityKey.slice(0, 20)}...
                              </Typography>
                            </Box>
                          </Box>
                        </li>
                      )
                    }}
                    noOptionsText={whitelistIdentitySearch.inputValue ? t('incoming_request_list_no_identities_found') : t('incoming_request_list_start_typing')}
                    fullWidth
                    size="small"
                  />

                  {/* Direct key input fallback */}
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <TextField
                      fullWidth
                      size="small"
                      label={whitelistIdentitySearch.selectedIdentity ? t('incoming_request_list_selected_identity_key') : t('incoming_request_list_paste_identity_key')}
                      value={whitelistKeyInput}
                      onChange={(e) => {
                        const val = e.target.value.trim()
                        setWhitelistKeyInput(val)
                        setAllowError('')
                        if (!val) return
                        try {
                          PublicKey.fromString(val)
                          whitelistIdentitySearch.handleSelect(null, null)
                        } catch {
                          // Not a valid key yet — allow typing
                        }
                      }}
                      disabled={!!whitelistIdentitySearch.selectedIdentity}
                      error={!!allowError}
                      helperText={allowError}
                    />
                    <Button
                      variant="contained"
                      onClick={handleAllow}
                      disabled={!whitelistKeyInput.trim()}
                      sx={{ whiteSpace: 'nowrap', mt: 0.25 }}
                    >
                      {t('incoming_request_list_allow')}
                    </Button>
                  </Stack>

                  {/* Whitelisted identities list */}
                  {permissions.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('incoming_request_list_no_whitelisted_identities')}
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {permissions.map(key => (
                        <ListItem
                          key={key}
                          disableGutters
                          secondaryAction={
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => handleBlock(key)}
                              color="error"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          }
                        >
                          <ListItemText
                            primary={
                              <Typography variant="body2" fontWeight={500}>
                                {truncateKey(key, 24)}
                              </Typography>
                            }
                            secondary={
                              <Typography variant="caption" sx={{ fontFamily: 'monospace' }} color="text.secondary">
                                {key}
                              </Typography>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </Stack>
              </Collapse>

              <Divider />

              {/* Amount limits */}
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {t('incoming_request_list_amount_limits')}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-end">
                <TextField
                  size="small"
                  label={t('incoming_request_list_min_amount')}
                  type="number"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  fullWidth
                />
                <TextField
                  size="small"
                  label={t('incoming_request_list_max_amount')}
                  type="number"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={saveLimits}
                  sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {limitsSaved ? t('incoming_request_list_saved') : t('incoming_request_list_save')}
                </Button>
              </Stack>
            </Stack>
        </Collapse>
      </Paper>

      {/* ---- Request cards ---- */}
      {requests.length === 0 ? (
        <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('incoming_request_list_no_requests')}</Typography>
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
                    label={isExpired ? t('incoming_request_list_expired') : t('incoming_request_list_pending')}
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
                    {/* Optional note */}
                    <TextField
                      size="small"
                      label={t('incoming_request_list_note_optional')}
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
                        {isPaying ? t('incoming_request_list_paying') : t('incoming_request_list_pay')}
                      </Button>
                      <Button
                        variant="outlined"
                        disabled={isBusy}
                        onClick={() => handleDecline(req)}
                        startIcon={isDeclining ? <CircularProgress size={16} /> : null}
                        sx={{ flexGrow: 1 }}
                      >
                        {isDeclining ? t('incoming_request_list_declining') : t('incoming_request_list_decline')}
                      </Button>
                    </Stack>
                  </>
                )}

                {isExpired && (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    {t('incoming_request_list_expired_message')}
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
