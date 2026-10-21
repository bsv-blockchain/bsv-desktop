import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Autocomplete, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, Paper, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import ArrowOutwardOutlined from '@mui/icons-material/ArrowOutwardOutlined'
import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined'
import QrCodeScannerOutlined from '@mui/icons-material/QrCodeScannerOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import InboxOutlined from '@mui/icons-material/InboxOutlined'
import { useHistory, useLocation } from 'react-router-dom'
import { P2PKH } from '@bsv/sdk'
import { IncomingPaymentRequest } from '@bsv/message-box-client'
import { useIdentitySearch } from '@bsv/identity-react'
import { QRCodeSVG } from 'qrcode.react'
import { WalletContext } from '../../../WalletContext'
import { beginUserWalletOperation } from '../../../services/httpBridgeSession'
import AmountInput from '../../../components/AmountInput'
import AmountDisplay from '../../../components/AmountDisplay'
import { formatSatoshis } from '../../../components/AmountDisplay/amountFormatHelpers'
import AddressReceive from './AddressReceive'
import KeptDirectPayments from './KeptDirectPayments'
import QrScanner from './QrScanner'
import { identityKey, isFaceToFaceCode, networkLabel, parsePaymentTarget, PaymentTarget, peerPayLink, validAmount } from './paymentProtocol'
import { broadcastPayment } from './broadcast'
import { deliverMessageBoxPayment, OutgoingPayment, prepareMessageBoxPayment } from './messageBoxPayments'
import { deliverDirect } from './directPayments'
import { payerReceipt } from './directReceipts'
import { deliveryProblem, liveStatus } from './delivery'
import { fallbackPrompt, payIdentity } from './payFlow'
import { identityName } from '../../../utils/identityNames'
import { addToOutbox, markOutboxDelivered, outboxStorageKey, readOutbox, subscribeOutbox } from './outbox'

const card = { border: '1px solid', borderColor: 'divider', borderRadius: 4, p: { xs: 2.5, md: 4 }, boxShadow: '0 8px 30px rgba(15, 23, 42, 0.035)' }
const short = (value: string) => `${value.slice(0, 12)}…${value.slice(-6)}`
const LIVE_DOT = { on: 'success.main', off: 'text.disabled', starting: 'text.secondary', error: 'error.main' } as const
/** `name`: who is being paid, as the page shows them (their name, or their short key). */
type Review = { target: PaymentTarget; amount: number; request?: IncomingPaymentRequest; name: string }
const IDENTITY_KEY = /^(02|03)[0-9a-f]{64}$/i

export default function Payments() {
  const context = useContext(WalletContext)
  const { managers, chain, activeProfile, adminOriginator, peerPayClient, messageBoxUrl, useMessageBox, isHostAnointed, anointCurrentHost, anointmentLoading, switchingNetwork, directPay, messageBoxReceived, retryMessageBoxPayment, settings } = context
  const wallet = managers.permissionsManager
  const scope = useMemo(() => ({ wallet, chain }), [wallet, chain])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const location = useLocation(), history = useHistory()
  const requestedTab = new URLSearchParams(location.search).get('tab')
  const tab = requestedTab === 'receive' ? requestedTab : 'send'
  const setTab = (value: string) => history.replace({ pathname: location.pathname, search: value === 'send' ? '' : `?tab=${value}` })
  const [identity, setIdentity] = useState(activeProfile?.identityKey || '')
  const [recipient, setRecipient] = useState('')
  const [recipientLabel, setRecipientLabel] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeSeverity, setNoticeSeverity] = useState<'success' | 'warning'>('success')
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  /** The live attempt could not reach the recipient: the review asks before using their message box. */
  const [fallback, setFallback] = useState<'offline' | 'link_failed' | null>(null)
  /** A live attempt is under way; Cancel aborts its dial. */
  const [reaching, setReaching] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const dialAbort = useRef<AbortController | null>(null)
  const [scan, setScan] = useState(false)
  const [receiveKind, setReceiveKind] = useState('wallet')
  const [requestAmount, setRequestAmount] = useState<number | null>(null)
  const [requestRecipient, setRequestRecipient] = useState('')
  const [requestDescription, setRequestDescription] = useState('')
  const [copied, setCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [requests, setRequests] = useState<IncomingPaymentRequest[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [inboxError, setInboxError] = useState('')
  const [inboxBusy, setInboxBusy] = useState('')
  const [retrying, setRetrying] = useState('')
  const [identityLabel, setIdentityLabel] = useState('')
  const [outgoing, setOutgoing] = useState<OutgoingPayment[]>([])
  /** Saved payments are stored but cannot be read: nothing new can be saved (see outbox.ts). */
  const [outboxUnreadable, setOutboxUnreadable] = useState(false)
  const [allowedKey, setAllowedKey] = useState('')
  const refreshLock = useRef(false)
  const mutationLock = useRef(false)
  const outboxKey = identity ? outboxStorageKey(identity, chain) : null
  const messageBoxAvailable = !!peerPayClient && useMessageBox && !!messageBoxUrl
  /** Live sending needs a client with a signaler; without one, Pay goes straight to the message box. */
  const directSendable = !!directPay.client && directPay.via !== null
  /** A wallet identity can be paid live or through the message box; this says why neither works. */
  const identityIssue = !messageBoxAvailable && !directSendable ? deliveryProblem('messagebox', { messageBoxAvailable, directPay }) : ''
  const formatAmount = (sats: number) => formatSatoshis(sats, false, true, null, String(settings?.currency || '').toUpperCase())
  const live = liveStatus(directPay)
  /** The outcome of the user's own action: it replaces any earlier error. */
  const notify = useCallback((message: string) => { setNotice(message); setNoticeSeverity('success'); setError('') }, [])
  const closeScan = useCallback(() => setScan(false), [])
  const identitySearch = useIdentitySearch({ wallet, originator: adminOriginator, onIdentitySelected: selected => { if (selected) { setRecipient(selected.identityKey); setRecipientLabel(selected.name || short(selected.identityKey)) } } })

  // A dial still reaching someone is for the wallet and network that were open: abort it (nothing is made before it connects).
  useEffect(() => { dialAbort.current?.abort(); setReview(null); setRecipient(''); setRecipientLabel(''); setAmount(null); setError(''); setNotice(''); }, [wallet, chain])
  useEffect(() => () => dialAbort.current?.abort(), [])
  // Arrivals are announced app-wide by PaymentToasts; message box payments are taken by MessageBoxAutoReceiver.
  useEffect(() => { setFallback(null); setCancelling(false) }, [review])
  useEffect(() => { let alive = true; setIdentityLabel(''); if (identity) void identityName(wallet, adminOriginator, identity).then(name => { if (alive) setIdentityLabel(name) }); return () => { alive = false } }, [wallet, adminOriginator, identity])
  useEffect(() => { let alive = true; setIdentity(''); if (wallet) wallet.getPublicKey({ identityKey: true }, adminOriginator).then(result => { if (alive) setIdentity(result.publicKey) }).catch(error => { if (alive) setError(error.message || 'Your wallet identity could not be loaded.') }); return () => { alive = false } }, [wallet, chain, adminOriginator])
  useEffect(() => { setOutgoing([]); setOutboxUnreadable(false); if (!outboxKey) return; const rows = readOutbox(outboxKey); setOutboxUnreadable(!rows); if (rows) setOutgoing(rows) }, [outboxKey])
  // Show writes made elsewhere in this window too, such as a delivery that outlived an earlier visit to this page.
  useEffect(() => { if (!outboxKey) return; return subscribeOutbox(key => { if (key === outboxKey) setOutgoing(readOutbox(key) ?? []) }) }, [outboxKey])
  /** Every outbox write is one of outbox.ts's, which start from the rows stored at that moment; the page then shows what was stored. */
  const writeOutbox = useCallback((write: (key: string) => OutgoingPayment[]) => { if (!outboxKey) throw new Error('Your wallet identity is still loading.'); setOutgoing(write(outboxKey)) }, [outboxKey])
  const addOutgoing = useCallback((row: OutgoingPayment) => writeOutbox(key => addToOutbox(key, row)), [writeOutbox])
  const markOutgoingDelivered = useCallback((txid: string) => writeOutbox(key => markOutboxDelivered(key, txid)), [writeOutbox])
  const target = useMemo(() => { try { return parsePaymentTarget(recipient, chain) } catch { return null } }, [recipient, chain])
  const targetError = useMemo(() => { if (!recipient.trim()) return ''; try { parsePaymentTarget(recipient, chain); return '' } catch (error) { return (error as Error).message } }, [recipient, chain])
  const looksLikeCode = /^[a-z][a-z0-9+.-]*:/i.test(recipient) || /^(0[23][a-f0-9]{10,}|[1mn][1-9A-HJ-NP-Za-km-z]{24,})$/i.test(recipient)
  const changeRecipient = (_event: React.SyntheticEvent, value: string, reason: string) => {
    if (reason === 'clear') { setRecipient(''); setRecipientLabel(''); identitySearch.handleInputChange(null, '', 'clear'); return }
    if (reason !== 'input') return
    if (isFaceToFaceCode(value)) { identitySearch.handleInputChange(null, '', 'clear'); adoptCode(value); return }
    setRecipient(value); setRecipientLabel(''); setError('')
    let direct = false
    try { parsePaymentTarget(value, chain); direct = true } catch { direct = /^[a-z][a-z0-9+.-]*:/i.test(value) || /^(0[23][a-f0-9]{10,}|[1mn][1-9A-HJ-NP-Za-km-z]{24,})$/i.test(value) }
    // A pasted identity key is still looked up, so its owner's name can be shown and chosen.
    const search = !direct || IDENTITY_KEY.test(value.trim())
    identitySearch.handleInputChange(null, search ? value : '', search ? 'input' : 'clear')
  }
  /** Search results, plus a pasted identity key nobody's certificates name, shown by its short key. */
  const recipientOptions = useMemo(() => {
    const key = recipient.trim().toLowerCase()
    const found = identitySearch.identities
    if (recipientLabel || !IDENTITY_KEY.test(key) || found.some(option => option.identityKey.toLowerCase() === key)) return found
    return [...found, { name: '', avatarURL: '', abbreviatedKey: '', identityKey: key, badgeIconURL: '', badgeLabel: '', badgeClickURL: '' }]
  }, [identitySearch.identities, recipient, recipientLabel])
  const fixedAmount = target?.amount
  /** Paying this wallet's own identity, such as after scanning its own Receive code. */
  const ownIdentity = target?.kind === 'identity' && !!identity && target.recipient === identity
  const sendAmount = fixedAmount ?? amount
  // Always a link, as BSV Wallet shows it: it names the message box only when there is one, so senders can always pay live.
  const receiveLink = useMemo(() => { try { return identity ? peerPayLink(identity, useMessageBox && messageBoxUrl ? messageBoxUrl : undefined, requestAmount ?? undefined) : '' } catch { return '' } }, [useMessageBox, identity, messageBoxUrl, requestAmount])
  /** A scanned or pasted code. A face-to-face code (kilobytes long) stays the recipient, for its amount, but the field shows its payee. */
  const adoptCode = useCallback((value: string) => { setError(''); setNotice(''); setRecipient(value); setRecipientLabel(''); try { const parsed = parsePaymentTarget(value, chain); if (parsed.amount !== undefined) setAmount(parsed.amount); if (isFaceToFaceCode(value)) { setRecipientLabel(short(parsed.recipient)); void identityName(wallet, adminOriginator, parsed.recipient).then(name => { if (name) setRecipientLabel(label => label === short(parsed.recipient) ? name : label) }) } } catch (error) { if (isFaceToFaceCode(value)) setRecipient(''); setError((error as Error).message) } }, [chain, wallet, adminOriginator])

  const refresh = useCallback(async () => {
    if (!peerPayClient || !messageBoxAvailable || switchingNetwork || refreshLock.current) return
    refreshLock.current = true; setRefreshing(true)
    try {
      // Payment requests only: payments are taken app-wide (MessageBoxAutoReceiver).
      const [result] = await Promise.allSettled([peerPayClient.listIncomingPaymentRequests(messageBoxUrl)])
      if (scopeRef.current !== scope) return
      if (result.status === 'fulfilled') setRequests(result.value)
      setInboxError(result.status === 'rejected' ? result.reason?.message || 'The message box could not be reached. Try refreshing.' : '')
    } finally { refreshLock.current = false; setRefreshing(false) }
  }, [peerPayClient, messageBoxAvailable, messageBoxUrl, switchingNetwork, scope])
  useEffect(() => { setRequests([]); void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh() }, 20_000); return () => clearInterval(timer) }, [refresh])

  const deliver = async (payment: OutgoingPayment) => {
    if (!wallet || !peerPayClient) throw new Error('Connect a message box in Settings before sending.')
    const release = beginUserWalletOperation()
    try {
      await broadcastPayment(wallet, payment.txid, adminOriginator)
      await deliverMessageBoxPayment(peerPayClient, payment)
      if (payment.request) {
        await peerPayClient.sendMessage({ recipient: payment.recipient, messageBox: 'payment_request_responses', body: JSON.stringify({ requestId: payment.request.requestId, status: 'paid', amountPaid: payment.amount }) }, payment.host)
        await peerPayClient.acknowledgeMessage({ messageIds: [payment.request.messageId], host: messageBoxUrl })
      }
      markOutgoingDelivered(payment.txid)
      window.dispatchEvent(new CustomEvent('balance-changed'))
    } finally { release() }
  }
  /**
   * Pays the reviewed payment. A wallet identity is paid live first (when this wallet can dial)
   * and through the message box otherwise; when the live attempt could not reach them, nothing
   * was made and the review asks before `send(true)` uses their message box. Payment requests
   * are always paid through the message box, which answers them.
   */
  const send = async (viaMessageBox = false) => {
    if (!review || !wallet || mutationLock.current || switchingNetwork) return
    // A failed fallback keeps its prompt, so Send to message box can be tried again.
    mutationLock.current = true; setBusy(true); setError(''); setNotice(''); if (!viaMessageBox) setFallback(null)
    let prepared = false
    let sent = 'Payment sent.'
    let release: (() => void) | undefined
    const dial = new AbortController()
    try {
      release = beginUserWalletOperation()
      const verifiedTarget = parsePaymentTarget(review.target.recipient, chain)
      if (verifiedTarget.kind !== review.target.kind || !validAmount(review.amount)) throw new Error('Check the recipient and amount again before sending.')
      if (review.target.kind === 'identity') {
        const target = review.target
        const messageBox = messageBoxAvailable ? async () => {
          if (review.request) {
            const fresh = (await peerPayClient!.listIncomingPaymentRequests(messageBoxUrl)).find(request => request.messageId === review.request!.messageId)
            if (!fresh || fresh.sender !== target.recipient || fresh.amount !== review.amount || fresh.requestId !== review.request.requestId || fresh.expiresAt <= Date.now()) throw new Error('This request has changed or expired. Refresh your inbox before paying.')
            if (outgoing.some(payment => payment.request?.requestId === fresh.requestId && payment.recipient === fresh.sender)) throw new Error('You have already prepared this payment. Retry its delivery from Saved payments.')
          }
          // The saved row, not the returned one: deliver needs its `request` to answer the request.
          let payment: OutgoingPayment | undefined
          await prepareMessageBoxPayment(wallet, target.recipient, review.amount, adminOriginator, target.host, original => { payment = { ...original, via: 'messagebox' as const, ...(review.request ? { request: { requestId: review.request.requestId, messageId: review.request.messageId } } : {}) }; addOutgoing(payment); prepared = true })
          await deliver(payment!)
        } : undefined
        const direct = !viaMessageBox && !review.request && directSendable ? async () => {
          dialAbort.current = dial; setReaching(true)
          try {
            const { ack } = await deliverDirect({ client: directPay.client!, wallet, originator: adminOriginator, recipient: target.recipient, amount: review.amount, host: target.host, persist: row => { addOutgoing(row); prepared = true; dialAbort.current = null; setReaching(false) }, markDelivered: markOutgoingDelivered, signal: dial.signal })
            return { ackStatus: ack.status }
          } finally { dialAbort.current = null; setReaching(false) }
        } : undefined
        const outcome = await payIdentity({ direct, messageBox, name: review.name })
        // Cancelled while reaching them: nothing was made, so there is nothing to say.
        if (dial.signal.aborted && !prepared && outcome.kind !== 'paid_live') { setReview(null); return }
        // One payment, one transaction: never offer the message box once this payment exists.
        if (outcome.kind === 'ask_fallback' && prepared) throw new Error('It could not be delivered directly.')
        if (outcome.kind === 'ask_fallback') { setFallback(outcome.reason); return }
        if (outcome.kind === 'failed') throw new Error(outcome.message)
        sent = outcome.kind === 'paid_live'
          ? `Paid ${review.name} ${formatAmount(review.amount)} · live${outcome.ackStatus === 'accepted' ? '' : `. ${payerReceipt(outcome.ackStatus as 'received')}`}`
          : `Sent to ${review.name}'s message box. They'll get it next time they open their wallet.`
      } else {
        await wallet.createAction({ description: 'Sent BSV to address', outputs: [{ lockingScript: new P2PKH().lock(review.target.recipient).toHex(), satoshis: review.amount, outputDescription: 'BSV payment' }], labels: ['legacy', 'outbound', `to-address:${review.target.recipient}`] }, adminOriginator)
      }
      setReview(null); setRecipient(''); setRecipientLabel(''); setAmount(null); notify(sent); window.dispatchEvent(new CustomEvent('balance-changed')); void refresh()
    } catch (error) { setError(prepared ? `Your payment is saved below. Retry its delivery; do not send a new payment. ${(error as Error).message}` : (error as Error).message || 'The payment could not be sent.'); if (prepared) setReview(null) } finally { release?.(); mutationLock.current = false; setBusy(false) }
  }
  const cancelReaching = () => { if (!dialAbort.current) return; setCancelling(true); dialAbort.current.abort() }
  const retryDirect = async (payment: OutgoingPayment) => {
    if (!wallet || mutationLock.current || switchingNetwork) return
    mutationLock.current = true; setBusy(true); setError(''); setNotice('')
    let release: (() => void) | undefined
    try {
      const problem = deliveryProblem('direct', { messageBoxAvailable, directPay })
      if (problem) throw new Error(problem)
      release = beginUserWalletOperation()
      const { ack } = await deliverDirect({ client: directPay.client!, wallet, originator: adminOriginator, recipient: payment.recipient, amount: payment.amount, existing: payment, persist: () => {}, markDelivered: markOutgoingDelivered })
      notify(`Saved payment delivered. ${payerReceipt(ack.status)}`); window.dispatchEvent(new CustomEvent('balance-changed'))
    } catch (error) { setError((error as Error).message || 'Delivery is still pending.') } finally { release?.(); mutationLock.current = false; setBusy(false) }
  }
  const retryReceived = async (messageId: string) => {
    if (retrying || switchingNetwork) return
    setRetrying(messageId)
    try { await retryMessageBoxPayment(messageId) } finally { setRetrying('') }
  }
  const sendRequest = async () => {
    if (!peerPayClient || !validAmount(requestAmount) || busy) return
    setBusy(true); setError('')
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      const key = identityKey(requestRecipient)
      await peerPayClient.requestPayment({ recipient: key, amount: requestAmount, description: requestDescription.trim() || 'BSV payment request', expiresAt: Date.now() + 86400_000 })
      notify('Payment request sent. It expires in 24 hours.'); setRequestRecipient(''); setRequestDescription('')
    } catch (error) { setError((error as Error).message || 'The request could not be sent.') } finally { release?.(); setBusy(false) }
  }
  const pending = outgoing.filter(row => !row.delivered)
  const savedForReview = review?.target.kind === 'identity' ? pending.find(row => row.recipient === review.target.recipient) : undefined
  if (!wallet) return <Alert severity="info">Unlock your wallet to make payments.</Alert>
  return <Box sx={{ maxWidth: 1100, mx: 'auto', pb: 5 }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}><Box><Typography variant="h1" sx={{ fontWeight: 750, letterSpacing: '-.04em' }}>Payments</Typography><Typography color="text.secondary" sx={{ mt: .75 }}>Send and receive BSV.</Typography></Box><Chip size="small" label={networkLabel(chain)} variant="outlined" /></Stack>
    {notice && <Alert severity={noticeSeverity} onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
    {/* While the review dialog is open it shows the error itself. */}
    {error && !review && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
    {outboxUnreadable && <Alert severity="warning" sx={{ mb: 2 }}>Saved payments on this device could not be read. They are left as they are, and payments to wallet identities cannot be saved until they can be read. Check Activity before sending again.</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.3fr) minmax(0, .9fr)' }, gap: 3, alignItems: 'start' }}>
      <Paper elevation={0} sx={card}>
        <Tabs value={tab} onChange={(_, value) => { setTab(value); setError('') }} variant="fullWidth" sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }} aria-label="Payment options"><Tab label="Send" value="send" icon={<ArrowOutwardOutlined sx={{ fontSize: 19 }} />} iconPosition="start" /><Tab label="Receive" value="receive" icon={<ArrowDownwardOutlined sx={{ fontSize: 19 }} />} iconPosition="start" /></Tabs>
        {tab === 'send' && <Stack spacing={3}>
          <Autocomplete freeSolo options={recipientOptions} loading={identitySearch.isLoading} inputValue={recipientLabel || recipient} value={null} filterOptions={options => options} getOptionLabel={(option: any) => typeof option === 'string' ? option : option.name || short(option.identityKey)} onInputChange={changeRecipient} onChange={(_, value) => { if (value && typeof value !== 'string') { setRecipient(value.identityKey); setRecipientLabel(value.name || short(value.identityKey)) } }} noOptionsText="Enter an identity key or address" renderOption={(props, option) => <li {...props} key={option.identityKey}><Avatar src={option.avatarURL} sx={{ width: 34, height: 34, mr: 1.5, bgcolor: 'primary.light' }}>{(option.name || option.identityKey).slice(0, 2).toUpperCase()}</Avatar><Box><Typography variant="body2" sx={{ fontWeight: 650 }}>{option.name || short(option.identityKey)}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{[option.badgeLabel, option.name ? short(option.identityKey) : ''].filter(Boolean).join(' · ') || 'Identity key'}</Typography></Box></li>} renderInput={params => <TextField {...params} label="Recipient" placeholder="Name, @handle, email, or identity key" error={!!recipient && !target && looksLikeCode} helperText={recipientLabel && target ? short(target.recipient) : recipient && !target ? looksLikeCode ? targetError : 'Choose a person from the list, or paste their identity key.' : 'A name, identity key, payment link, or BSV address.'} InputProps={{ ...params.InputProps, endAdornment: <>{identitySearch.isLoading && <CircularProgress size={18} />}{params.InputProps.endAdornment}<IconButton aria-label="Scan a payment code" title="Scan a payment code" edge="end" onClick={() => setScan(true)}><QrCodeScannerOutlined /></IconButton></> }} />} />
          <AmountInput valueSats={sendAmount} onChangeSats={setAmount} label="Amount" fullWidth disabled={fixedAmount !== undefined} helperText={fixedAmount !== undefined ? 'Set by the recipient’s payment link.' : undefined} />
          {ownIdentity && <Alert severity="warning">This is your own wallet. Choose someone else to pay.</Alert>}
          {target?.kind === 'identity' && identityIssue && <Alert severity="warning">{identityIssue}</Alert>}
          <Button variant="contained" size="large" endIcon={<ArrowOutwardOutlined />} disabled={!target || ownIdentity || !validAmount(sendAmount) || busy || switchingNetwork || !identity || target.kind === 'identity' && !!identityIssue} onClick={() => { setNotice(''); setError(''); setReview({ target, amount: sendAmount!, name: recipientLabel || short(target.recipient) }) }}>Review payment</Button>
        </Stack>}
        {tab === 'receive' && <Stack spacing={3}>
          <ToggleButtonGroup fullWidth exclusive value={receiveKind} onChange={(_, value) => { if (value) setReceiveKind(value) }} aria-label="Receive payment type"><ToggleButton value="wallet">Wallet payment</ToggleButton><ToggleButton value="address">BSV address</ToggleButton></ToggleButtonGroup>
          {receiveKind === 'address' ? identity && <AddressReceive key={`${identity}:${chain}`} identity={identity} onSuccess={notify} /> : <>
            {identity && <Box sx={{ textAlign: 'center' }}>
              <Box sx={{ display: 'inline-flex', p: 1.5, bgcolor: '#fff', borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>{receiveLink ? <QRCodeSVG value={receiveLink} size={240} level="M" marginSize={2} aria-label="Your payment QR code" /> : <Box sx={{ width: 240, height: 240, display: 'grid', placeItems: 'center', px: 3 }}><Typography color="text.secondary" variant="body2">Enter a positive amount or leave it blank.</Typography></Box>}</Box>
              {identityLabel && <Typography sx={{ fontWeight: 700, mt: 2 }}>{identityLabel}</Typography>}
              <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 12, mt: identityLabel ? .5 : 2, color: 'text.secondary' }}>{identity}</Typography>
              <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 1.5 }}><Button startIcon={<ContentCopyOutlined />} onClick={async () => { try { await navigator.clipboard.writeText(identity); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 2000) } catch { setError('Copy failed. Select your identity key above and copy it.') } }}>{keyCopied ? 'Identity key copied' : 'Copy identity key'}</Button><Button startIcon={<ContentCopyOutlined />} disabled={!receiveLink} onClick={async () => { try { await navigator.clipboard.writeText(receiveLink); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setError('Copy failed. Select your identity key above and copy it.') } }}>{copied ? 'Payment link copied' : 'Copy payment link'}</Button></Stack>
            </Box>}
            <AmountInput fullWidth label="Amount to request (optional)" valueSats={requestAmount} onChangeSats={setRequestAmount} helperText="Leave blank to let the sender choose." />
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 2, border: '1px solid', borderColor: live.tone === 'on' ? 'success.main' : 'divider', borderRadius: 2.5 }} aria-live="polite"><Box sx={{ width: 10, height: 10, mt: .75, borderRadius: '50%', flexShrink: 0, bgcolor: LIVE_DOT[live.tone] }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 700 }}>{live.title}</Typography>{live.body && <Typography variant="body2" color="text.secondary" sx={{ mt: .25 }}>{live.body}</Typography>}</Box>{(live.tone === 'off' || live.tone === 'error') && <Button size="small" onClick={() => history.push('/dashboard/settings/advanced')}>Settings</Button>}</Box>
            {!messageBoxAvailable ? <Alert severity="info">Connect a message box in Settings to receive payments while this app is closed.</Alert> : <>
              {!isHostAnointed && <Alert severity="info" action={<Button size="small" disabled={anointmentLoading || switchingNetwork} onClick={async () => { let release: (() => void) | undefined; try { release = beginUserWalletOperation(); await anointCurrentHost(); notify('Your wallet can now be discovered for payments.') } catch (error) { setError((error as Error).message) } finally { release?.() } }}>Enable</Button>}>Enable wallet discovery to receive payments from people who only have your identity key. A network fee applies.</Alert>}
              <Divider /><Box component="details"><Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 650 }}>Send someone a payment request</Typography><Stack spacing={2} sx={{ pt: 2 }}><TextField label="Their identity key" fullWidth value={requestRecipient} onChange={event => setRequestRecipient(event.target.value)} /><TextField label="What is it for?" fullWidth value={requestDescription} inputProps={{ maxLength: 200 }} onChange={event => setRequestDescription(event.target.value)} /><Button variant="outlined" disabled={!validAmount(requestAmount) || !requestRecipient || busy || switchingNetwork} onClick={sendRequest}>{busy ? 'Sending…' : 'Send request · expires in 24 hours'}</Button><Typography variant="caption" color="text.secondary">The recipient must allow payment requests from your identity. Completed payments appear in your inbox.</Typography></Stack></Box>
            </>}
          </>}
        </Stack>}
      </Paper>
      <Stack spacing={3}>
        {pending.length > 0 && <Paper elevation={0} sx={card}><Typography variant="h6" sx={{ fontWeight: 700 }}>Saved payments</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5, mb: 2 }}>Retry delivery of the original payment, through the message box or directly. Each retry uses the same transaction.</Typography>{pending.map(payment => <Box key={payment.txid} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}><Typography sx={{ fontWeight: 700 }}><AmountDisplay>{payment.amount}</AmountDisplay></Typography><Typography color="text.secondary" variant="caption">To {short(payment.recipient)} · {payment.via === 'direct' ? 'sent directly' : 'sent via message box'}</Typography><Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}><Button size="small" variant="outlined" disabled={busy || !messageBoxAvailable || switchingNetwork} onClick={async () => { if (mutationLock.current) return; mutationLock.current = true; setBusy(true); try { await deliver(payment); notify('Saved payment delivered.'); void refresh() } catch (error) { setError((error as Error).message || 'Delivery is still pending.') } finally { mutationLock.current = false; setBusy(false) } }}>Retry via message box</Button>{!payment.request && <Button size="small" variant="outlined" disabled={busy || !!deliveryProblem('direct', { messageBoxAvailable, directPay }) || switchingNetwork} onClick={() => void retryDirect(payment)}>Retry directly</Button>}</Stack></Box>)}</Paper>}
        {identity && <KeptDirectPayments identity={identity} chain={chain} sx={card} />}
        <Paper elevation={0} sx={card}><Typography variant="h6" sx={{ fontWeight: 700 }}>Arrived while you were away</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5, mb: 2 }}>Payments left in your message box are added to your wallet automatically.</Typography>
          {messageBoxReceived.length === 0 ? <Box sx={{ textAlign: 'center', py: 3 }}><InboxOutlined sx={{ fontSize: 38, color: 'text.disabled' }} /><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{messageBoxAvailable ? 'Nothing yet. Payments sent while you are offline will be listed here.' : 'Connect a message box in Settings to receive payments while you are away.'}</Typography></Box> : <Stack spacing={1.5}>{messageBoxReceived.slice(0, 20).map(record => <Box key={record.messageId} sx={{ border: '1px solid', borderColor: record.status === 'failed' ? 'warning.main' : 'divider', borderRadius: 2.5, p: 2 }}><Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}><Typography sx={{ fontWeight: 700 }}><AmountDisplay>{record.amount}</AmountDisplay></Typography><Typography variant="caption" color="text.secondary">{new Date(record.at).toLocaleString()}</Typography></Stack><Typography variant="caption" color="text.secondary">From {short(record.sender)} · {record.status === 'received' ? 'added to your wallet' : 'not added yet'}</Typography>{record.status === 'failed' && <><Typography variant="body2" color="warning.main" sx={{ mt: .5 }}>{record.error || 'This payment could not be added to your wallet.'}</Typography><Button size="small" variant="outlined" sx={{ mt: 1 }} disabled={!!retrying || switchingNetwork} onClick={() => void retryReceived(record.messageId)}>{retrying === record.messageId ? 'Retrying…' : 'Retry'}</Button></>}</Box>)}</Stack>}
        </Paper>
        <Paper elevation={0} sx={card}><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}><Typography variant="h6" sx={{ fontWeight: 700 }}>Payment requests</Typography><Button size="small" startIcon={refreshing ? <CircularProgress size={15} /> : <RefreshOutlined />} onClick={() => void refresh()} disabled={!messageBoxAvailable || refreshing || switchingNetwork}>Refresh</Button></Stack>
          {inboxError && <Alert severity="warning" sx={{ mb: 2 }}>{inboxError}</Alert>}
          {!messageBoxAvailable ? <Typography color="text.secondary" variant="body2">Payment requests will appear here when your message box is connected.</Typography> : requests.length === 0 ? <Box sx={{ textAlign: 'center', py: 3 }}><Typography sx={{ fontWeight: 650 }}>All caught up</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>Requests for payment appear here.</Typography></Box> : <Stack spacing={2}>{requests.map(request => <Box key={request.messageId} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, p: 2 }}><Typography variant="caption" color="text.secondary">Request from {short(request.sender)}</Typography><Typography sx={{ fontSize: 20, fontWeight: 700, mt: .5 }}><AmountDisplay>{request.amount}</AmountDisplay></Typography><Typography variant="body2" sx={{ mt: .5 }}>{request.description}</Typography><Stack direction="row" spacing={1} sx={{ mt: 1.5 }}><Button size="small" variant="outlined" disabled={busy || switchingNetwork || request.expiresAt <= Date.now() || outgoing.some(payment => payment.request?.requestId === request.requestId && payment.recipient === request.sender)} onClick={() => { setError(''); setReview({ target: { kind: 'identity', recipient: request.sender }, amount: request.amount, request, name: short(request.sender) }) }}>Review & pay</Button><Button size="small" disabled={!!inboxBusy || switchingNetwork} onClick={async () => { setInboxBusy(request.messageId); let release: (() => void) | undefined; try { release = beginUserWalletOperation(); await peerPayClient!.declinePaymentRequest({ request }); notify('Request declined.'); void refresh() } catch (error) { setError((error as Error).message) } finally { release?.(); setInboxBusy('') } }}>Decline</Button></Stack></Box>)}</Stack>}
          {messageBoxAvailable && <Box component="details" sx={{ mt: 2 }}><Typography component="summary" variant="body2" color="text.secondary" sx={{ cursor: 'pointer' }}>Allow payment requests from someone</Typography><Stack spacing={1.5} sx={{ mt: 2 }}><TextField size="small" label="Identity key" value={allowedKey} onChange={event => setAllowedKey(event.target.value)} /><Button size="small" variant="outlined" disabled={!allowedKey || busy || switchingNetwork} onClick={async () => { setBusy(true); let release: (() => void) | undefined; try { release = beginUserWalletOperation(); await peerPayClient!.allowPaymentRequestsFrom({ identityKey: identityKey(allowedKey) }); notify('Payment requests allowed for this identity.'); setAllowedKey('') } catch (error) { setError((error as Error).message) } finally { release?.(); setBusy(false) } }}>Allow requests</Button></Stack></Box>}
        </Paper>
        <Box sx={{ px: 1, display: 'flex', gap: 1.5 }}><CheckCircleOutline sx={{ color: 'primary.main', fontSize: 21, mt: .3 }} /><Typography variant="body2" color="text.secondary">You review every payment before it leaves your wallet. Switch networks and manage your message box in Settings.</Typography></Box>
      </Stack>
    </Box>
    <QrScanner open={scan} onClose={closeScan} onRead={adoptCode} />
    <Dialog open={!!review} onClose={() => { if (!busy) setReview(null) }} fullWidth maxWidth="xs"><DialogTitle>Review your payment</DialogTitle><DialogContent><Stack spacing={2.5}><Box><Typography variant="body2" color="text.secondary">You’re sending</Typography><Typography variant="h3" sx={{ fontWeight: 750, mt: .5 }}><AmountDisplay>{review?.amount || 0}</AmountDisplay></Typography><Typography variant="caption" color="text.secondary">{review?.amount.toLocaleString()} satoshis + network fee</Typography></Box><Divider /><Box><Typography variant="body2" color="text.secondary">To {review?.target.kind === 'identity' ? 'wallet identity' : 'BSV address'}</Typography>{review?.target.kind === 'identity' && review.name !== short(review.target.recipient) && <Typography sx={{ fontWeight: 700, mt: .5 }}>{review.name}</Typography>}<Typography variant="body2" sx={{ fontFamily: 'monospace', mt: .75, wordBreak: 'break-all' }}>{review?.target.recipient}</Typography></Box><Typography variant="body2" color="text.secondary">Network: {networkLabel(chain)}. Confirm the recipient and network before sending.</Typography>{savedForReview && <Alert severity="warning">A payment of {savedForReview.amount.toLocaleString()} satoshis to this wallet is saved but was never delivered. Retry it from Saved payments instead of sending a new one.</Alert>}{fallback && review && <Alert severity="warning">{fallbackPrompt(fallback, review.name)}</Alert>}{error && <Alert severity="error">{error}</Alert>}</Stack></DialogContent><DialogActions sx={{ p: 2.5 }}>{fallback ? <><Button disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button variant="contained" disabled={busy || switchingNetwork} onClick={() => void send(true)}>{busy ? 'Sending…' : 'Send to message box'}</Button></> : <><Button disabled={busy && (!reaching || cancelling)} onClick={() => { if (reaching) cancelReaching(); else setReview(null) }}>{reaching ? cancelling ? 'Cancelling…' : 'Cancel' : 'Back'}</Button><Button variant="contained" disabled={busy || switchingNetwork} onClick={() => void send()}>{busy ? reaching ? `Reaching ${review?.name}…` : 'Sending…' : 'Pay'}</Button></>}</DialogActions></Dialog>
  </Box>
}
