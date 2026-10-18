import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Autocomplete, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, InputAdornment, Paper, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import ArrowOutwardOutlined from '@mui/icons-material/ArrowOutwardOutlined'
import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined'
import QrCodeScannerOutlined from '@mui/icons-material/QrCodeScannerOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import InboxOutlined from '@mui/icons-material/InboxOutlined'
import { useHistory, useLocation } from 'react-router-dom'
import { P2PKH } from '@bsv/sdk'
import { IncomingPayment, IncomingPaymentRequest } from '@bsv/message-box-client'
import { useIdentitySearch } from '@bsv/identity-react'
import { QRCodeSVG } from 'qrcode.react'
import { WalletContext } from '../../../WalletContext'
import { beginUserWalletOperation } from '../../../services/httpBridgeSession'
import AmountInput from '../../../components/AmountInput'
import AmountDisplay from '../../../components/AmountDisplay'
import AddressReceive from './AddressReceive'
import NearbyPayments from './NearbyPayments'
import KeptDirectPayments from './KeptDirectPayments'
import QrScanner from './QrScanner'
import { identityKey, isDirectCode, networkLabel, parsePaymentTarget, PaymentTarget, peerPayLink, validAmount } from './paymentProtocol'
import { broadcastNearbyPayment } from './nearbyProtocol'
import { deliverMessageBoxPayment, OutgoingPayment, prepareMessageBoxPayment } from './messageBoxPayments'
import { deliverDirect } from './directPayments'
import { payerReceipt, receivedNotice } from './directReceipts'
import { DELIVERY_HELP, Delivery, deliveryProblem, directStatusLine } from './delivery'
import type { DirectOutbox } from './directCodes'
import { addToOutbox, markOutboxDelivered, outboxStorageKey, readOutbox, subscribeOutbox } from './outbox'

const card = { border: '1px solid', borderColor: 'divider', borderRadius: 4, p: { xs: 2.5, md: 4 }, boxShadow: '0 8px 30px rgba(15, 23, 42, 0.035)' }
const short = (value: string) => `${value.slice(0, 12)}…${value.slice(-6)}`
type Review = { target: PaymentTarget; amount: number; request?: IncomingPaymentRequest; delivery: Delivery }

export default function Payments() {
  const context = useContext(WalletContext)
  const { managers, chain, activeProfile, adminOriginator, peerPayClient, messageBoxUrl, useMessageBox, isHostAnointed, anointCurrentHost, anointmentLoading, switchingNetwork, directPay } = context
  const wallet = managers.permissionsManager
  const scope = useMemo(() => ({ wallet, chain }), [wallet, chain])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const location = useLocation(), history = useHistory()
  const requestedTab = new URLSearchParams(location.search).get('tab')
  const tab = requestedTab === 'receive' || requestedTab === 'nearby' ? requestedTab : 'send'
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
  const [delivery, setDelivery] = useState<Delivery>('messagebox')
  const [scan, setScan] = useState(false)
  const [nearbyRequest, setNearbyRequest] = useState('')
  const [receiveKind, setReceiveKind] = useState('wallet')
  const [requestAmount, setRequestAmount] = useState<number | null>(null)
  const [requestRecipient, setRequestRecipient] = useState('')
  const [requestDescription, setRequestDescription] = useState('')
  const [copied, setCopied] = useState(false)
  const [incoming, setIncoming] = useState<IncomingPayment[]>([])
  const [requests, setRequests] = useState<IncomingPaymentRequest[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [inboxError, setInboxError] = useState('')
  const [inboxBusy, setInboxBusy] = useState('')
  const [outgoing, setOutgoing] = useState<OutgoingPayment[]>([])
  const [allowedKey, setAllowedKey] = useState('')
  const refreshLock = useRef(false)
  const mutationLock = useRef(false)
  const outboxKey = identity ? outboxStorageKey(identity, chain) : null
  const messageBoxAvailable = !!peerPayClient && useMessageBox && !!messageBoxUrl
  const directAvailable = !!directPay.client
  const deliveryIssue = deliveryProblem(delivery, { messageBoxAvailable, directPay })
  const directLine = directStatusLine(directPay)
  /** The outcome of the user's own action: it replaces any earlier error. */
  const notify = useCallback((message: string) => { setNotice(message); setNoticeSeverity('success'); setError('') }, [])
  /** News from elsewhere (a payment arrived): it leaves an error, such as "do not send a new payment", in place. */
  const announce = useCallback(({ text, severity }: { text: string; severity: 'success' | 'warning' }) => { setNotice(text); setNoticeSeverity(severity) }, [])
  const closeScan = useCallback(() => setScan(false), [])
  const identitySearch = useIdentitySearch({ wallet, originator: adminOriginator, onIdentitySelected: selected => { if (selected) { setRecipient(selected.identityKey); setRecipientLabel(selected.name || short(selected.identityKey)) } } })

  useEffect(() => { setReview(null); setRecipient(''); setRecipientLabel(''); setAmount(null); setDelivery('messagebox'); setNearbyRequest(''); setError(''); setNotice(''); }, [wallet, chain])
  useEffect(() => { const onReceived = (event: Event) => announce(receivedNotice((event as CustomEvent<Record<string, unknown> | undefined>).detail ?? {})); window.addEventListener('direct-payment-received', onReceived); return () => window.removeEventListener('direct-payment-received', onReceived) }, [announce])
  useEffect(() => { let alive = true; setIdentity(''); if (wallet) wallet.getPublicKey({ identityKey: true }, adminOriginator).then(result => { if (alive) setIdentity(result.publicKey) }).catch(error => { if (alive) setError(error.message || 'Your wallet identity could not be loaded.') }); return () => { alive = false } }, [wallet, chain, adminOriginator])
  useEffect(() => { setOutgoing([]); if (!outboxKey) return; const rows = readOutbox(outboxKey); if (rows) setOutgoing(rows); else setError('Saved payments could not be read. Check Activity before sending again.') }, [outboxKey])
  // Show writes made elsewhere in this window too, such as a delivery that outlived an earlier visit to this page.
  useEffect(() => { if (!outboxKey) return; return subscribeOutbox(key => { if (key === outboxKey) setOutgoing(readOutbox(key) ?? []) }) }, [outboxKey])
  /** Every outbox write is one of outbox.ts's, which start from the rows stored at that moment; the page then shows what was stored. */
  const writeOutbox = useCallback((write: (key: string) => OutgoingPayment[]) => { if (!outboxKey) throw new Error('Your wallet identity is still loading.'); setOutgoing(write(outboxKey)) }, [outboxKey])
  const addOutgoing = useCallback((row: OutgoingPayment) => writeOutbox(key => addToOutbox(key, row)), [writeOutbox])
  const markOutgoingDelivered = useCallback((txid: string) => writeOutbox(key => markOutboxDelivered(key, txid)), [writeOutbox])
  const nearbyOutbox = useMemo<DirectOutbox>(() => ({ rows: outgoing, add: addOutgoing, markDelivered: markOutgoingDelivered }), [outgoing, addOutgoing, markOutgoingDelivered])
  const target = useMemo(() => { try { return parsePaymentTarget(recipient, chain) } catch { return null } }, [recipient, chain])
  const targetError = useMemo(() => { if (!recipient.trim()) return ''; try { parsePaymentTarget(recipient, chain); return '' } catch (error) { return (error as Error).message } }, [recipient, chain])
  const looksLikeCode = /^[a-z][a-z0-9+.-]*:/i.test(recipient) || /^(0[23][a-f0-9]{10,}|[1mn][1-9A-HJ-NP-Za-km-z]{24,})$/i.test(recipient)
  const changeRecipient = (_event: React.SyntheticEvent, value: string, reason: string) => {
    if (reason === 'clear') { setRecipient(''); setRecipientLabel(''); identitySearch.handleInputChange(null, '', 'clear'); return }
    if (reason !== 'input') return
    if (value.startsWith('bsvpay1:') || isDirectCode(value)) { identitySearch.handleInputChange(null, '', 'clear'); adoptCode(value); return }
    setRecipient(value); setRecipientLabel(''); setError('')
    let direct = false
    try { parsePaymentTarget(value, chain); direct = true } catch { direct = /^[a-z][a-z0-9+.-]*:/i.test(value) || /^(0[23][a-f0-9]{10,}|[1mn][1-9A-HJ-NP-Za-km-z]{24,})$/i.test(value) }
    identitySearch.handleInputChange(null, direct ? '' : value, direct ? 'clear' : 'input')
  }
  const fixedAmount = target?.amount
  const sendAmount = fixedAmount ?? amount
  const receiveLink = useMemo(() => { try { return useMessageBox && identity && messageBoxUrl ? peerPayLink(identity, messageBoxUrl, requestAmount ?? undefined) : '' } catch { return '' } }, [useMessageBox, identity, messageBoxUrl, requestAmount])
  const adoptCode = useCallback((value: string) => { setError(''); setNotice(''); if (value.startsWith('bsvpay1:') || isDirectCode(value)) { setNearbyRequest(value); history.replace({ pathname: location.pathname, search: '?tab=nearby' }); return } setRecipient(value); setRecipientLabel(''); try { const parsed = parsePaymentTarget(value, chain); if (parsed.amount !== undefined) setAmount(parsed.amount) } catch (error) { setError((error as Error).message) } }, [history, location.pathname, chain])

  const refresh = useCallback(async () => {
    if (!peerPayClient || !messageBoxAvailable || switchingNetwork || refreshLock.current) return
    refreshLock.current = true; setRefreshing(true)
    try {
      const results = await Promise.allSettled([peerPayClient.listIncomingPayments(messageBoxUrl), peerPayClient.listIncomingPaymentRequests(messageBoxUrl)])
      if (scopeRef.current !== scope) return
      if (results[0].status === 'fulfilled') setIncoming(results[0].value)
      if (results[1].status === 'fulfilled') setRequests(results[1].value)
      const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined
      setInboxError(failed ? failed.reason?.message || 'The message box could not be reached. Try refreshing.' : '')
    } finally { refreshLock.current = false; setRefreshing(false) }
  }, [peerPayClient, messageBoxAvailable, messageBoxUrl, switchingNetwork, scope])
  useEffect(() => { setIncoming([]); setRequests([]); void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh() }, 20_000); return () => clearInterval(timer) }, [refresh])

  const deliver = async (payment: OutgoingPayment) => {
    if (!wallet || !peerPayClient) throw new Error('Connect a message box in Settings before sending.')
    const release = beginUserWalletOperation()
    try {
      await broadcastNearbyPayment(wallet, payment.txid, adminOriginator)
      await deliverMessageBoxPayment(peerPayClient, payment)
      if (payment.request) {
        await peerPayClient.sendMessage({ recipient: payment.recipient, messageBox: 'payment_request_responses', body: JSON.stringify({ requestId: payment.request.requestId, status: 'paid', amountPaid: payment.amount }) }, payment.host)
        await peerPayClient.acknowledgeMessage({ messageIds: [payment.request.messageId], host: messageBoxUrl })
      }
      markOutgoingDelivered(payment.txid)
      window.dispatchEvent(new CustomEvent('balance-changed'))
    } finally { release() }
  }
  const send = async () => {
    if (!review || !wallet || mutationLock.current || switchingNetwork) return
    mutationLock.current = true; setBusy(true); setError(''); setNotice('')
    let prepared = false
    let sent = 'Payment sent.'
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      const verifiedTarget = parsePaymentTarget(review.target.recipient, chain)
      if (verifiedTarget.kind !== review.target.kind || !validAmount(review.amount)) throw new Error('Check the recipient and amount again before sending.')
      if (review.target.kind === 'identity') {
        const problem = deliveryProblem(review.delivery, { messageBoxAvailable, directPay })
        if (problem) throw new Error(problem)
        if (review.delivery === 'direct') {
          const { ack } = await deliverDirect({ client: directPay.client!, wallet, originator: adminOriginator, recipient: review.target.recipient, amount: review.amount, host: review.target.host, persist: row => { addOutgoing(row); prepared = true }, markDelivered: markOutgoingDelivered })
          sent = `Payment sent. ${payerReceipt(ack.status)}`
        } else {
          if (review.request) {
            const fresh = (await peerPayClient!.listIncomingPaymentRequests(messageBoxUrl)).find(request => request.messageId === review.request!.messageId)
            if (!fresh || fresh.sender !== review.target.recipient || fresh.amount !== review.amount || fresh.requestId !== review.request.requestId || fresh.expiresAt <= Date.now()) throw new Error('This request has changed or expired. Refresh your inbox before paying.')
            if (outgoing.some(payment => payment.request?.requestId === fresh.requestId && payment.recipient === fresh.sender)) throw new Error('You have already prepared this payment. Retry its delivery from Saved payments.')
          }
          // The saved row, not the returned one: deliver needs its `request` to answer the request.
          let payment: OutgoingPayment | undefined
          await prepareMessageBoxPayment(wallet, review.target.recipient, review.amount, adminOriginator, review.target.host, original => { payment = { ...original, via: 'messagebox' as const, ...(review.request ? { request: { requestId: review.request.requestId, messageId: review.request.messageId } } : {}) }; addOutgoing(payment); prepared = true })
          await deliver(payment!)
        }
      } else {
        await wallet.createAction({ description: 'Sent BSV to address', outputs: [{ lockingScript: new P2PKH().lock(review.target.recipient).toHex(), satoshis: review.amount, outputDescription: 'BSV payment' }], labels: ['legacy', 'outbound', `to-address:${review.target.recipient}`] }, adminOriginator)
      }
      setReview(null); setRecipient(''); setRecipientLabel(''); setAmount(null); notify(sent); window.dispatchEvent(new CustomEvent('balance-changed')); void refresh()
    } catch (error) { setError(prepared ? `Your payment is saved below. Retry its delivery; do not send a new payment. ${(error as Error).message}` : (error as Error).message || 'The payment could not be sent.'); if (prepared) setReview(null) } finally { release?.(); mutationLock.current = false; setBusy(false) }
  }
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
  const receivePayment = async (payment: IncomingPayment) => {
    if (!peerPayClient || inboxBusy || switchingNetwork) return
    setInboxBusy(payment.messageId); setError('')
    let release: (() => void) | undefined
    try { release = beginUserWalletOperation(); await peerPayClient.acceptPayment(payment); notify('Payment added to your wallet.'); window.dispatchEvent(new CustomEvent('balance-changed')); void refresh() } catch (error) { setError((error as Error).message || 'This payment could not be received. Try again.') } finally { release?.(); setInboxBusy('') }
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
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}><Box><Typography variant="h1" sx={{ fontWeight: 750, letterSpacing: '-.04em' }}>Payments</Typography><Typography color="text.secondary" sx={{ mt: .75 }}>Pay an address, a wallet, or someone nearby.</Typography></Box><Chip size="small" label={networkLabel(chain)} variant="outlined" /></Stack>
    {notice && <Alert severity={noticeSeverity} onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
    {/* While the review dialog is open it shows the error itself. */}
    {error && !review && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.3fr) minmax(0, .9fr)' }, gap: 3, alignItems: 'start' }}>
      <Paper elevation={0} sx={card}>
        <Tabs value={tab} onChange={(_, value) => { setTab(value); setError('') }} variant="fullWidth" sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }} aria-label="Payment options"><Tab label="Send" value="send" icon={<ArrowOutwardOutlined sx={{ fontSize: 19 }} />} iconPosition="start" /><Tab label="Receive" value="receive" icon={<ArrowDownwardOutlined sx={{ fontSize: 19 }} />} iconPosition="start" /><Tab label="Nearby" value="nearby" icon={<QrCodeScannerOutlined sx={{ fontSize: 19 }} />} iconPosition="start" /></Tabs>
        {tab === 'send' && <Stack spacing={3}>
          <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Who are we paying?</Typography><Typography color="text.secondary" variant="body2" sx={{ mt: .5 }}>A wallet identity, payment link, or BSV address.</Typography></Box>
          <Autocomplete freeSolo options={identitySearch.identities} loading={identitySearch.isLoading} inputValue={recipientLabel || recipient} value={null} filterOptions={options => options} getOptionLabel={(option: any) => typeof option === 'string' ? option : option.name || option.identityKey} onInputChange={changeRecipient} onChange={(_, value) => { if (value && typeof value !== 'string') { setRecipient(value.identityKey); setRecipientLabel(value.name || short(value.identityKey)) } }} noOptionsText="Enter an identity key or address" renderOption={(props, option) => <li {...props} key={option.identityKey}><Avatar src={option.avatarURL} sx={{ width: 34, height: 34, mr: 1.5, bgcolor: 'primary.light' }}>{(option.name || option.identityKey).slice(0, 2).toUpperCase()}</Avatar><Box><Typography variant="body2" sx={{ fontWeight: 650 }}>{option.name || 'Wallet identity'}</Typography><Typography variant="caption" color="text.secondary">{short(option.identityKey)}</Typography></Box></li>} renderInput={params => <TextField {...params} label="Recipient" placeholder="Name, identity, address, or payment link" error={!!recipient && !target && looksLikeCode} helperText={recipientLabel ? `Wallet identity · ${short(recipient)}` : target ? target.kind === 'identity' ? `Wallet payment · ${delivery === 'direct' ? 'delivered directly to their wallet' : 'delivered through the message box'}` : 'Address payment · sent on the BSV network' : recipient ? looksLikeCode ? targetError : 'Select a person from the search results, or paste their identity key.' : undefined} InputProps={{ ...params.InputProps, endAdornment: <>{identitySearch.isLoading && <CircularProgress size={18} />}{params.InputProps.endAdornment}</> }} />} />
          <Button variant="outlined" startIcon={<QrCodeScannerOutlined />} onClick={() => setScan(true)}>Scan a payment code</Button>
          <AmountInput valueSats={sendAmount} onChangeSats={setAmount} label="Amount" fullWidth disabled={fixedAmount !== undefined} helperText={fixedAmount !== undefined ? 'This amount comes from the recipient’s payment request.' : 'Network fees are added when the payment is created.'} />
          {target?.kind === 'identity' && <Box><Typography variant="body2" sx={{ fontWeight: 650, mb: 1 }}>Delivery</Typography><ToggleButtonGroup fullWidth exclusive size="small" aria-label="Delivery" value={delivery} onChange={(_, value) => { if (value) setDelivery(value) }}><ToggleButton value="messagebox">Message box</ToggleButton><ToggleButton value="direct" disabled={!directAvailable}>Direct</ToggleButton></ToggleButtonGroup><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: .75 }}>{DELIVERY_HELP[delivery]}</Typography>{!directAvailable && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Direct is unavailable: {deliveryProblem('direct', { messageBoxAvailable, directPay })}</Typography>}</Box>}
          {target?.kind === 'identity' && delivery === 'messagebox' && target.host && <Alert severity="info">Delivery server: {new URL(target.host).host}</Alert>}
          {target?.kind === 'identity' && deliveryIssue && <Alert severity="warning">{deliveryIssue}</Alert>}
          <Button variant="contained" size="large" endIcon={<ArrowOutwardOutlined />} disabled={!target || !validAmount(sendAmount) || busy || switchingNetwork || !identity || target.kind === 'identity' && !!deliveryIssue} onClick={() => { setNotice(''); setError(''); setReview({ target, amount: sendAmount!, delivery }) }}>Review payment</Button>
        </Stack>}
        {tab === 'receive' && <Stack spacing={3}>
          <ToggleButtonGroup fullWidth exclusive value={receiveKind} onChange={(_, value) => { if (value) setReceiveKind(value) }} aria-label="Receive payment type"><ToggleButton value="wallet">Wallet payment</ToggleButton><ToggleButton value="address">BSV address</ToggleButton></ToggleButtonGroup>
          {receiveKind === 'address' ? identity && <AddressReceive key={`${identity}:${chain}`} identity={identity} onSuccess={notify} /> : <>
            <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Your wallet, one scan away</Typography><Typography color="text.secondary" variant="body2" sx={{ mt: .5 }}>Share your payment link with another BSV Wallet. The sender can pay your identity directly.</Typography></Box>
            <Alert severity={directLine.severity} action={directLine.severity === 'success' ? undefined : <Button size="small" onClick={() => history.push('/dashboard/settings/advanced')}>Settings</Button>}>{directLine.text}</Alert>
            {!messageBoxAvailable ? <Alert severity="info">Connect a message box in Settings to share a payment link, or receive using a BSV address above.</Alert> : <>
              <AmountInput fullWidth label="Amount to request (optional)" valueSats={requestAmount} onChangeSats={setRequestAmount} helperText="Leave blank to let the sender choose." />
              <Box sx={{ textAlign: 'center', py: 1 }}>{receiveLink ? <QRCodeSVG value={receiveLink} size={240} level="M" marginSize={2} /> : <Typography color="text.secondary">{requestAmount !== null && !validAmount(requestAmount) ? 'Enter a positive amount or leave it blank.' : 'Your payment link is not ready yet.'}</Typography>}</Box>
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}><Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 12 }}>{identity}</Typography><Button fullWidth startIcon={<ContentCopyOutlined />} disabled={!receiveLink} onClick={async () => { try { await navigator.clipboard.writeText(receiveLink); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setError('Copy failed. Select your identity key above and copy it.') } }}>{copied ? 'Payment link copied' : 'Copy payment link'}</Button></Box>
              {!isHostAnointed && <Alert severity="info" action={<Button size="small" disabled={anointmentLoading || switchingNetwork} onClick={async () => { let release: (() => void) | undefined; try { release = beginUserWalletOperation(); await anointCurrentHost(); notify('Your wallet can now be discovered for payments.') } catch (error) { setError((error as Error).message) } finally { release?.() } }}>Enable</Button>}>Enable wallet discovery to receive payments from people who only have your identity key. A network fee applies.</Alert>}
              <Divider /><Box component="details"><Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 650 }}>Send someone a payment request</Typography><Stack spacing={2} sx={{ pt: 2 }}><TextField label="Their identity key" fullWidth value={requestRecipient} onChange={event => setRequestRecipient(event.target.value)} /><TextField label="What is it for?" fullWidth value={requestDescription} inputProps={{ maxLength: 200 }} onChange={event => setRequestDescription(event.target.value)} /><Button variant="outlined" disabled={!validAmount(requestAmount) || !requestRecipient || busy || switchingNetwork} onClick={sendRequest}>{busy ? 'Sending…' : 'Send request · expires in 24 hours'}</Button><Typography variant="caption" color="text.secondary">The recipient must allow payment requests from your identity. Completed payments appear in your inbox.</Typography></Stack></Box>
            </>}
          </>}
        </Stack>}
        {tab === 'nearby' && identity && <NearbyPayments key={`${identity}:${chain}:${nearbyRequest}`} identity={identity} onSuccess={notify} initialRequest={nearbyRequest && !isDirectCode(nearbyRequest) ? nearbyRequest : undefined} initialDirectCode={isDirectCode(nearbyRequest) ? nearbyRequest : undefined} outbox={nearbyOutbox} />}
      </Paper>
      <Stack spacing={3}>
        {pending.length > 0 && <Paper elevation={0} sx={card}><Typography variant="h6" sx={{ fontWeight: 700 }}>Saved payments</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5, mb: 2 }}>Retry delivery of the original payment, through the message box or directly. Each retry uses the same transaction.</Typography>{pending.map(payment => <Box key={payment.txid} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}><Typography sx={{ fontWeight: 700 }}><AmountDisplay>{payment.amount}</AmountDisplay></Typography><Typography color="text.secondary" variant="caption">To {short(payment.recipient)} · {payment.via === 'direct' ? 'sent directly' : 'sent via message box'}</Typography><Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}><Button size="small" variant="outlined" disabled={busy || !messageBoxAvailable || switchingNetwork} onClick={async () => { if (mutationLock.current) return; mutationLock.current = true; setBusy(true); try { await deliver(payment); notify('Saved payment delivered.'); void refresh() } catch (error) { setError((error as Error).message || 'Delivery is still pending.') } finally { mutationLock.current = false; setBusy(false) } }}>Retry via message box</Button>{!payment.request && <Button size="small" variant="outlined" disabled={busy || !!deliveryProblem('direct', { messageBoxAvailable, directPay }) || switchingNetwork} onClick={() => void retryDirect(payment)}>Retry directly</Button>}</Stack></Box>)}</Paper>}
        {identity && <KeptDirectPayments identity={identity} chain={chain} sx={card} />}
        <Paper elevation={0} sx={card}><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}><Typography variant="h6" sx={{ fontWeight: 700 }}>Your inbox</Typography><Button size="small" startIcon={refreshing ? <CircularProgress size={15} /> : <RefreshOutlined />} onClick={() => void refresh()} disabled={!messageBoxAvailable || refreshing || switchingNetwork}>Refresh</Button></Stack>
          {inboxError && <Alert severity="warning" sx={{ mb: 2 }}>{inboxError}</Alert>}
          {!messageBoxAvailable ? <Typography color="text.secondary" variant="body2">Wallet payments will appear here when your message box is connected.</Typography> : incoming.length === 0 && requests.length === 0 ? <Box sx={{ textAlign: 'center', py: 4 }}><InboxOutlined sx={{ fontSize: 38, color: 'text.disabled' }} /><Typography sx={{ fontWeight: 650, mt: 1.5 }}>All caught up</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>Incoming payments and requests appear here.</Typography></Box> : <Stack spacing={2}>{incoming.map(payment => <Box key={payment.messageId} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, p: 2 }}><Typography variant="caption" color="text.secondary">Payment from {short(payment.sender)}</Typography><Typography sx={{ fontSize: 20, fontWeight: 700, mt: .5 }}><AmountDisplay>{payment.token.amount}</AmountDisplay></Typography><Button variant="contained" size="small" sx={{ mt: 1.5 }} disabled={!!inboxBusy || switchingNetwork} onClick={() => void receivePayment(payment)}>{inboxBusy === payment.messageId ? 'Receiving…' : 'Add to wallet'}</Button></Box>)}{requests.map(request => <Box key={request.messageId} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, p: 2 }}><Typography variant="caption" color="text.secondary">Request from {short(request.sender)}</Typography><Typography sx={{ fontSize: 20, fontWeight: 700, mt: .5 }}><AmountDisplay>{request.amount}</AmountDisplay></Typography><Typography variant="body2" sx={{ mt: .5 }}>{request.description}</Typography><Stack direction="row" spacing={1} sx={{ mt: 1.5 }}><Button size="small" variant="outlined" disabled={busy || switchingNetwork || request.expiresAt <= Date.now() || outgoing.some(payment => payment.request?.requestId === request.requestId && payment.recipient === request.sender)} onClick={() => { setError(''); setReview({ target: { kind: 'identity', recipient: request.sender }, amount: request.amount, request, delivery: 'messagebox' }) }}>Review & pay</Button><Button size="small" disabled={!!inboxBusy || switchingNetwork} onClick={async () => { setInboxBusy(request.messageId); let release: (() => void) | undefined; try { release = beginUserWalletOperation(); await peerPayClient!.declinePaymentRequest({ request }); notify('Request declined.'); void refresh() } catch (error) { setError((error as Error).message) } finally { release?.(); setInboxBusy('') } }}>Decline</Button></Stack></Box>)}</Stack>}
          {messageBoxAvailable && <Box component="details" sx={{ mt: 2 }}><Typography component="summary" variant="body2" color="text.secondary" sx={{ cursor: 'pointer' }}>Allow payment requests from someone</Typography><Stack spacing={1.5} sx={{ mt: 2 }}><TextField size="small" label="Identity key" value={allowedKey} onChange={event => setAllowedKey(event.target.value)} /><Button size="small" variant="outlined" disabled={!allowedKey || busy || switchingNetwork} onClick={async () => { setBusy(true); let release: (() => void) | undefined; try { release = beginUserWalletOperation(); await peerPayClient!.allowPaymentRequestsFrom({ identityKey: identityKey(allowedKey) }); notify('Payment requests allowed for this identity.'); setAllowedKey('') } catch (error) { setError((error as Error).message) } finally { release?.(); setBusy(false) } }}>Allow requests</Button></Stack></Box>}
        </Paper>
        <Box sx={{ px: 1, display: 'flex', gap: 1.5 }}><CheckCircleOutline sx={{ color: 'primary.main', fontSize: 21, mt: .3 }} /><Typography variant="body2" color="text.secondary">You review every payment before it leaves your wallet. Switch networks and manage your message box in Settings.</Typography></Box>
      </Stack>
    </Box>
    <QrScanner open={scan} onClose={closeScan} onRead={adoptCode} />
    <Dialog open={!!review} onClose={() => { if (!busy) setReview(null) }} fullWidth maxWidth="xs"><DialogTitle>Review your payment</DialogTitle><DialogContent><Stack spacing={2.5}><Box><Typography variant="body2" color="text.secondary">You’re sending</Typography><Typography variant="h3" sx={{ fontWeight: 750, mt: .5 }}><AmountDisplay>{review?.amount || 0}</AmountDisplay></Typography><Typography variant="caption" color="text.secondary">{review?.amount.toLocaleString()} satoshis + network fee</Typography></Box><Divider /><Box><Typography variant="body2" color="text.secondary">To {review?.target.kind === 'identity' ? 'wallet identity' : 'BSV address'}</Typography><Typography variant="body2" sx={{ fontFamily: 'monospace', mt: .75, wordBreak: 'break-all' }}>{review?.target.recipient}</Typography></Box>{review?.target.kind === 'identity' && <Box><Typography variant="body2" color="text.secondary">Delivery: {review?.delivery === 'direct' ? 'Direct (peer-to-peer)' : 'Message box'}</Typography><Typography variant="caption" color="text.secondary">{DELIVERY_HELP[review.delivery]}</Typography></Box>}<Typography variant="body2" color="text.secondary">Network: {networkLabel(chain)}. Confirm the recipient and network before sending.</Typography>{savedForReview && <Alert severity="warning">A payment of {savedForReview.amount.toLocaleString()} satoshis to this wallet is saved but was never delivered. Retry it from Saved payments instead of sending a new one.</Alert>}{error && <Alert severity="error">{error}</Alert>}</Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button disabled={busy} onClick={() => setReview(null)}>Back</Button><Button variant="contained" disabled={busy || switchingNetwork} onClick={send}>{busy ? review?.target.kind === 'identity' && review.delivery === 'direct' ? 'Connecting…' : 'Sending…' : 'Confirm & send'}</Button></DialogActions></Dialog>
  </Box>
}
