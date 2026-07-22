/**
 * Tokens — the token tab of the Transfers page. Send STAS / DSTAS / BSV-21
 * peer-to-peer over MessageBox, mirroring the Payments (PeerPay) tab format:
 *   - inner tabs [ Send | Incoming ]
 *   - the Send tab carries a Transaction History section (past token sends,
 *     tagged with the `peertoken` action label)
 *   - the Incoming tab lists tokens sent to you, each with Accept
 *
 * Holdings load like AssetsPage (STAS/DSTAS via listStasOutputs, BSV-21 via
 * listOutputs); source resolution + BRC-29 derivation stay in the adapters.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  Container, Paper, Stack, Typography, TextField, Button, Chip, Divider, List,
  ListItem, ListItemText, IconButton, Tooltip, MenuItem, Tabs, Tab, Card, CardContent,
  Link, Dialog, DialogTitle, DialogContent, DialogActions, Alert, CircularProgress, Box
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext'
import type { IncomingToken, SendTokenParams } from '@bsv/message-box-client'
import { loadPeerHoldings, type PeerHolding as Holding } from '../../../services/tokens/peer/loadPeerHoldings'
import IdentitySearchField from '../../../components/IdentitySearchField'

interface TokenTx {
  txid: string
  description: string
  satoshis: number
}

export default function PeerTokens() {
  const ctx = useContext(WalletContext) as any
  const stas = ctx?.stas
  const wallet = ctx?.managers?.permissionsManager ?? ctx?.wallet
  const network: string = ctx?.network ?? 'mainnet'
  const useMessageBox: boolean = ctx?.useMessageBox ?? false

  const peerTokens = stas?.peerTokens
  const identityKey: string | undefined = stas?.keyDeriver?.identityKey
  const chain: 'main' | 'test' = stas?.keyDeriver?.chain ?? 'main'
  const originator: string | undefined = ctx?.adminOriginator

  const [tab, setTab] = useState(0)
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loadingHoldings, setLoadingHoldings] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [transactions, setTransactions] = useState<TokenTx[]>([])
  const [incoming, setIncoming] = useState<IncomingToken[]>([])
  const [accepting, setAccepting] = useState<string | null>(null)

  const selected = useMemo(() => holdings.find((h) => h.key === selectedKey), [holdings, selectedKey])

  // ── Load holdings ─────────────────────────────────────────────────────────
  const loadHoldings = useCallback(async () => {
    if (!wallet || !identityKey) return
    setLoadingHoldings(true)
    try {
      setHoldings(await loadPeerHoldings({ wallet, identityKey, chain, originator }))
    } catch (e) {
      console.warn('[Tokens] loadPeerHoldings failed', e)
    } finally {
      setLoadingHoldings(false)
    }
  }, [wallet, identityKey, chain, originator])

  // ── Transaction history (past token sends, tagged `peertoken`) ──────────────
  const getHistory = useCallback(async () => {
    if (!wallet) return
    try {
      const res = await wallet.listActions(
        { labels: ['peertoken'], labelQueryMode: 'any', includeOutputs: true, limit: 100 },
        originator
      )
      setTransactions(
        (res?.actions ?? []).map((a: any) => ({
          txid: a.txid,
          description: a.description ?? '',
          satoshis: a.satoshis ?? 0,
        }))
      )
    } catch (e) {
      console.warn('[Tokens] listActions failed', e)
    }
  }, [wallet, originator])

  // ── Incoming ────────────────────────────────────────────────────────────────
  const refreshIncoming = useCallback(async () => {
    if (!peerTokens) return
    try {
      setIncoming(await peerTokens.listIncomingTokens())
    } catch (e) {
      console.warn('[Tokens] listIncomingTokens failed', e)
    }
  }, [peerTokens])

  useEffect(() => {
    void loadHoldings()
    void getHistory()
    void refreshIncoming()
  }, [loadHoldings, getHistory, refreshIncoming])

  useEffect(() => {
    if (!peerTokens) return
    let active = true
    peerTokens
      .listenForLiveTokens({
        onToken: (t: IncomingToken) => {
          if (!active) return
          setIncoming((prev) => (prev.some((p) => p.messageId === t.messageId) ? prev : [t, ...prev]))
          toast.info(`Incoming ${t.token.protocol} token`)
        },
      })
      .catch((e: any) => console.warn('[Tokens] listen failed', e))
    return () => { active = false }
  }, [peerTokens])

  // ── Send ──────────────────────────────────────────────────────────────────
  const startSend = () => {
    if (!selected) return toast.error('Pick a token to send')
    if (!recipient.trim()) return toast.error('Enter a recipient identity key')
    setConfirmOpen(true)
  }

  const doSend = async () => {
    if (!selected || !peerTokens) return
    setConfirmOpen(false)
    setSending(true)
    try {
      const params: SendTokenParams = {
        recipient: recipient.trim(),
        protocol: selected.protocol,
        source: selected.source,
        amount: amount || selected.amount,
      }
      const sent = await peerTokens.sendToken(params)
      toast.success(`Sent ${selected.protocol} ✓ txid ${sent?.txid ? sent.txid.slice(0, 16) + '…' : '(pending)'}`)
      await loadHoldings()
      await getHistory()
    } catch (e: any) {
      console.error('[Tokens] send failed — full error:', e)
      toast.error(`Send failed: ${String(e?.message ?? e).slice(0, 160)}`)
    } finally {
      setSending(false)
    }
  }

  const accept = async (t: IncomingToken) => {
    if (!peerTokens) return
    setAccepting(t.messageId)
    try {
      const r = await peerTokens.acceptToken(t)
      if (typeof r === 'string') toast.error(r)
      else {
        toast.success(`Accepted ${t.token.protocol} token`)
        setIncoming((prev) => prev.filter((p) => p.messageId !== t.messageId))
        await loadHoldings()
      }
    } catch (e: any) {
      toast.error(`Accept failed: ${e?.message ?? String(e)}`)
    } finally {
      setAccepting(null)
    }
  }

  if (!useMessageBox || !peerTokens) {
    return (
      <Container maxWidth="sm">
        <Box sx={{ minHeight: '100vh', py: 5 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>Tokens</Typography>
          <Alert severity="info">
            MessageBox is not enabled for this wallet. Enable it in wallet configuration to send and
            receive tokens peer-to-peer.
          </Alert>
        </Box>
      </Container>
    )
  }

  const wocTxBase = network === 'mainnet' ? 'https://whatsonchain.com/tx/' : 'https://test.whatsonchain.com/tx/'

  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: '100vh', py: 5 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Tokens</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Sends here go straight to the recipient's identity key over MessageBox and
        arrive in seconds — no waiting for their wallet to scan. The legacy address
        send on the Assets page relies on an indexer lookup and can be slow.
      </Alert>
      <Tabs
        value={tab}
        onChange={(_, v) => { setTab(v); if (v === 1) void refreshIncoming() }}
        variant="fullWidth"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Send tokens" />
        <Tab label="Incoming tokens" />
      </Tabs>

      {/* Tab 0: Send + Transaction History */}
      {tab === 0 && (
        <Stack spacing={2}>
          <Paper elevation={2} sx={{ p: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="h6">Send a token</Typography>
              <Tooltip title="Reload holdings"><span>
                <IconButton size="small" onClick={() => void loadHoldings()} disabled={loadingHoldings}><RefreshIcon fontSize="small" /></IconButton>
              </span></Tooltip>
            </Box>
            <Stack spacing={2}>
              <TextField
                select fullWidth label="Token holding" value={selectedKey}
                onChange={(e) => { setSelectedKey(e.target.value); const h = holdings.find((x) => x.key === e.target.value); setAmount(h?.amount ?? '') }}
                helperText={loadingHoldings ? 'Loading…' : holdings.length === 0 ? 'No token holdings found' : `${holdings.length} holding(s)`}
              >
                {holdings.map((h) => (
                  <MenuItem key={h.key} value={h.key}>{h.protocol.toUpperCase()} — {h.label}</MenuItem>
                ))}
              </TextField>
              {/* Search a recipient by name/handle (MessageBox identity lookup),
                  same as the Payments tab — or paste an identity key below. */}
              {wallet ? (
                <IdentitySearchField
                  wallet={wallet}
                  originator={originator}
                  onSelect={setRecipient}
                  label="Search for a recipient"
                />
              ) : null}
              <TextField
                fullWidth
                label={recipient ? 'Recipient identity key' : '…or paste recipient identity key'}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="03…"
              />
              <TextField
                fullWidth label="Amount (token units)" value={amount} onChange={(e) => setAmount(e.target.value)}
                helperText={'Partial amounts supported (STAS/DSTAS split; BSV-21 makes change)'}
              />
              <Box>
                <Button variant="contained" disabled={sending || !selected} onClick={startSend}
                  startIcon={sending ? <CircularProgress size={16} /> : undefined}>
                  {sending ? 'Working…' : 'Send token'}
                </Button>
              </Box>
            </Stack>
          </Paper>

          {/* Transaction History */}
          <Paper elevation={2} sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 500 }}>Transaction history</Typography>
            <Divider sx={{ mb: 2 }} />
            <Button variant="outlined" onClick={() => void getHistory()} fullWidth sx={{ mb: 2 }}>Refresh history</Button>
            {transactions.length === 0 ? (
              <Typography variant="body2" color="textSecondary" sx={{ textAlign: 'center', py: 3 }}>No token transactions yet</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {transactions.map((tx) => (
                  <Card key={tx.txid} variant="outlined">
                    <CardContent>
                      <Typography variant="body2" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                        <strong>txid:</strong>{' '}
                        <Link href={`${wocTxBase}${tx.txid}`} target="_blank" rel="noopener noreferrer">{tx.txid}</Link>
                      </Typography>
                      {tx.description && (
                        <Typography variant="body2" color="textSecondary"><strong>details:</strong> {tx.description}</Typography>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </Paper>
        </Stack>
      )}

      {/* Tab 1: Incoming tokens */}
      {tab === 1 && (
        <Paper elevation={2} sx={{ p: 2 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="h6">Incoming tokens</Typography>
            <Button size="small" onClick={() => void refreshIncoming()}>Refresh</Button>
          </Box>
          {incoming.length === 0 ? (
            <Typography color="text.secondary">No incoming tokens</Typography>
          ) : (
            <List>
              {incoming.map((t) => (
                <React.Fragment key={t.messageId}>
                  <ListItem secondaryAction={
                    <Button size="small" variant="contained" disabled={accepting === t.messageId} onClick={() => void accept(t)}
                      startIcon={accepting === t.messageId ? <CircularProgress size={16} /> : undefined}>
                      {accepting === t.messageId ? 'Accepting…' : 'Accept'}
                    </Button>
                  }>
                    <ListItemText
                      primary={<Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label={t.token.protocol} />
                        <Typography fontSize="0.9rem">{t.token.amount} · {t.token.assetId.slice(0, 12)}…</Typography>
                      </Stack>}
                      secondary={<Typography variant="body2" color="text.secondary">from {t.sender?.slice?.(0, 14) ?? '?'}…</Typography>}
                    />
                  </ListItem>
                  <Divider component="li" />
                </React.Fragment>
              ))}
            </List>
          )}
        </Paper>
      )}

      {/* Confirm send */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm token send</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Typography variant="body2">Protocol: <b>{selected?.protocol}</b></Typography>
            <Typography variant="body2">Token: <b>{selected?.label}</b></Typography>
            <Typography variant="body2">Amount: <b>{amount || selected?.amount}</b></Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>To: <b>{recipient}</b></Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void doSend()}>Send</Button>
        </DialogActions>
      </Dialog>
      </Box>
    </Container>
  )
}
