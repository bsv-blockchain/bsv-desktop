import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, LinearProgress, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import QrCodeScannerOutlined from '@mui/icons-material/QrCodeScannerOutlined'
import QrCode2Outlined from '@mui/icons-material/QrCode2Outlined'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import { QRCodeSVG } from 'qrcode.react'
import type { DirectPayClient, OfferCode, OfferHandle, PaymentAck } from '@bsv/webrtpay'
import { WalletContext } from '../../../WalletContext'
import AmountInput from '../../../components/AmountInput'
import AmountDisplay from '../../../components/AmountDisplay'
import QrScanner from './QrScanner'
import { answerDirectRequest, codeFitsQr, createDirectRequest, offerFailure, pendingPaymentFor, readOfferCode } from './directCodes'
import { NotSentError } from './directPayments'
import type { DirectAnswer, DirectOutbox, ReceivedDirectPayment } from './directCodes'
import type { OutgoingPayment } from './messageBoxPayments'
import { networkLabel, validAmount } from './paymentProtocol'

const short = (value: string) => `${value.slice(0, 12)}…${value.slice(-6)}`
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A code for the other wallet: a QR code when it fits one, and always copyable as text. */
function CodeView({ code, caption }: { code: string; caption: string }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setCopyError(''); setTimeout(() => setCopied(false), 2000) } catch { setCopyError('Copy failed. Open the code as text below and copy it from there.') }
  }
  return <Box sx={{ textAlign: 'center' }}>
    {codeFitsQr(code) ? <Box sx={{ display: 'inline-flex', bgcolor: '#fff', p: 1.5, borderRadius: 3 }}><QRCodeSVG value={code} size={260} style={{ maxWidth: '100%', height: 'auto' }} level="M" marginSize={2} /></Box> : <Alert severity="info" sx={{ textAlign: 'left' }}>This code is too long for a QR code. Copy it and send it to them.</Alert>}
    <Typography sx={{ mt: 2, fontWeight: 700 }}>{caption}</Typography>
    <Button startIcon={<ContentCopyOutlined />} onClick={() => void copy()} sx={{ mt: 1 }}>{copied ? 'Code copied' : 'Copy code'}</Button>
    {copyError && <Alert severity="warning" sx={{ textAlign: 'left' }}>{copyError}</Alert>}
    <Box component="details" sx={{ textAlign: 'left', mt: 1 }}><Typography component="summary" variant="caption" color="text.secondary" sx={{ cursor: 'pointer' }}>Show the code as text (if the QR code does not scan)</Typography><TextField fullWidth multiline size="small" value={code} InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } }} sx={{ mt: 1 }} /></Box>
  </Box>
}

type ReceivePhase = 'idle' | 'offer' | 'connecting' | 'connected' | 'received'
type PayPhase = 'enter' | 'answer' | 'sending' | 'done'
type Review = { code: string; offer: OfferCode; amount: number; saved?: OutgoingPayment }

/**
 * Nearby → Direct (WebRTC): pay or be paid face to face by exchanging two codes, with no
 * server in between (see directCodes.ts). Receiving shows an offer code and scans the
 * payer's answer; paying reads an offer code and shows the answer. Leaving the screen
 * cancels a code nobody has answered; a connection already made runs to its end.
 */
export default function DirectCodeExchange({ identity, initialCode, outbox, onSuccess }: { identity: string; initialCode?: string; outbox: DirectOutbox; onSuccess: (message: string) => void }) {
  const { managers, chain, adminOriginator, switchingNetwork, directPay } = useContext(WalletContext)
  const wallet = managers.permissionsManager!
  const client = directPay.client
  const [direction, setDirection] = useState<'receive' | 'send'>(initialCode ? 'send' : 'receive')
  const [error, setError] = useState('')
  /** The wallet's own words under `error`; shown only with the error it came with. */
  const [errorDetail, setErrorDetail] = useState<{ error: string; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanFor, setScanFor] = useState<'offer' | 'answer' | null>(null)
  const alive = useRef(true)

  // ---- receiving: show an offer code, scan the payer's answer ----------------------------
  const [requestAmount, setRequestAmount] = useState<number | null>(null)
  const [offer, setOffer] = useState<{ handle: OfferHandle; amount?: number } | null>(null)
  const [phase, setPhaseState] = useState<ReceivePhase>('idle')
  const phaseRef = useRef<ReceivePhase>('idle')
  const setPhase = useCallback((next: ReceivePhase) => { phaseRef.current = next; setPhaseState(next) }, [])
  const [sender, setSender] = useState('')
  const [received, setReceived] = useState<ReceivedDirectPayment | null>(null)
  const offerRef = useRef<OfferHandle | null>(null)
  const offerClient = useRef<DirectPayClient | null>(null)
  /** True once the offer's session is up: from then on it runs to its end, even off screen. */
  const sessionRef = useRef(false)

  // ---- paying: read an offer code, show the answer ---------------------------------------
  const [input, setInput] = useState(initialCode || '')
  const [payAmount, setPayAmount] = useState<number | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [answer, setAnswer] = useState<DirectAnswer | null>(null)
  const [payPhase, setPayPhase] = useState<PayPhase>('enter')
  const [done, setDone] = useState<{ payment: OutgoingPayment; ack: PaymentAck } | null>(null)
  const answerRef = useRef<DirectAnswer | null>(null)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; if (!sessionRef.current) offerRef.current?.cancel(); answerRef.current?.cancel() }
  }, [])

  const dropOffer = useCallback(() => {
    if (!sessionRef.current) offerRef.current?.cancel()
    offerRef.current = null; offerClient.current = null; sessionRef.current = false
    setOffer(null); setSender('')
  }, [])
  // A new client (settings applied, wallet reopened) closed the old one's links.
  useEffect(() => {
    if (offerRef.current && offerClient.current !== client && !sessionRef.current) { dropOffer(); setPhase('idle'); setError('Direct payments restarted. Create a new request.') }
  }, [client, dropOffer, setPhase])

  const createRequest = async () => {
    if (!client || busy || switchingNetwork) return
    setBusy(true); setError(''); setReceived(null)
    try {
      const handle = await createDirectRequest({ client, wallet, originator: adminOriginator, identity, chain, amount: requestAmount ?? undefined,
        onReceived: payment => {
          if (payment.added) window.dispatchEvent(new CustomEvent('balance-changed'))
          // Delivered again (their wallet lost the ack): it was announced when it first arrived.
          if (!payment.repeat) onSuccess(payment.status === 'accepted' ? 'Direct payment received.' : 'Direct payment received. Your wallet will add it once it can be verified.')
          if (alive.current) { setReceived(payment); setPhase('received'); setError('') }
        },
        onError: e => { if (alive.current) setError(`A payment could not be received: ${messageOf(e)}`) }
      })
      if (!alive.current) { handle.cancel(); return }
      offerRef.current = handle; offerClient.current = client; sessionRef.current = false
      setOffer({ handle, amount: requestAmount ?? undefined }); setPhase('offer')
    } catch (e) { setError(messageOf(e) || 'The request could not be created.') } finally { setBusy(false) }
  }
  const completeWith = async (value: string) => {
    const handle = offerRef.current
    if (!handle || phaseRef.current !== 'offer') return
    setPhase('connecting'); setError('')
    try {
      const peer = await handle.complete(value)
      sessionRef.current = true
      if (!alive.current || offerRef.current !== handle) return
      setSender(peer.peerIdentityKey)
      // Read again: the phase may have moved on while the handshake ran.
      if ((phaseRef.current as ReceivePhase) === 'connecting') setPhase('connected')
      peer.onClose(() => {
        if (!alive.current || offerRef.current !== handle || phaseRef.current !== 'connected') return
        dropOffer(); setPhase('idle')
        setError(current => current || 'The connection closed before a payment arrived. Create a new request to try again.')
      })
    } catch (e) {
      if (!alive.current || offerRef.current !== handle) return
      const failure = offerFailure(e)
      if (failure.again) { setError(failure.message); setPhase('offer'); return }
      dropOffer(); setPhase('idle')
      setError(failure.message)
    }
  }
  const newRequest = () => { dropOffer(); setPhase('idle'); setReceived(null); setError('') }

  // ---- paying -----------------------------------------------------------------------------
  const offerCode = useMemo(() => { try { return input.trim() ? readOfferCode(input, { chain, identity }) : null } catch { return null } }, [input, chain, identity])
  const offerError = useMemo(() => { if (!input.trim()) return ''; try { readOfferCode(input, { chain, identity }); return '' } catch (e) { return messageOf(e) } }, [input, chain, identity])
  const saved = offerCode ? pendingPaymentFor(outbox.rows, offerCode.identityKey, offerCode.amount) : undefined
  const chosenAmount = offerCode?.amount ?? payAmount
  const openReview = () => {
    if (!offerCode) return
    const amount = saved ? saved.amount : chosenAmount
    if (validAmount(amount)) { setError(''); setReview({ code: input.trim(), offer: offerCode, amount, saved }) }
  }
  const confirm = async () => {
    if (!review || !client || busy || switchingNetwork) return
    setBusy(true); setError('')
    let prepared = false
    try {
      const next = await answerDirectRequest({ client, wallet, originator: adminOriginator, identity, chain, code: review.code, amount: review.amount, existing: review.saved,
        persist: row => { outbox.add(row); prepared = true }, markDelivered: outbox.markDelivered, onConnected: () => { if (alive.current) setPayPhase('sending') } })
      answerRef.current = next
      if (!alive.current) { next.cancel(); return }
      setAnswer(next); setReview(null); setPayPhase('answer')
      next.delivered.then(result => {
        if (answerRef.current === next) answerRef.current = null
        window.dispatchEvent(new CustomEvent('balance-changed'))
        onSuccess(result.ack.status === 'accepted' ? 'Direct payment delivered.' : 'Direct payment delivered. Their wallet will add it shortly.')
        if (alive.current) { setDone(result); setAnswer(null); setPayPhase('done') }
      }, failure => {
        const current = answerRef.current === next
        if (current) answerRef.current = null
        if (prepared) window.dispatchEvent(new CustomEvent('balance-changed'))
        if (!alive.current || !current) return
        setAnswer(null); setPayPhase('enter')
        const text = prepared ? `Your payment is saved under Saved payments. Retry its delivery; do not send a new payment. ${messageOf(failure)}` : messageOf(failure)
        setError(text)
        setErrorDetail(failure instanceof NotSentError && failure.detail ? { error: text, detail: failure.detail } : null)
      })
    } catch (e) { setError(messageOf(e) || 'The answer could not be created.') } finally { setBusy(false) }
  }
  const cancelAnswer = () => {
    const current = answerRef.current
    if (!current?.cancel()) return
    answerRef.current = null
    setAnswer(null); setPayPhase('enter')
  }
  const payAgain = () => { setDone(null); setInput(''); setPayAmount(null); setPayPhase('enter'); setError('') }

  const read = (value: string) => {
    if (scanFor === 'answer') void completeWith(value.trim())
    else { setInput(value.trim()); setError('') }
  }
  const closeScanner = useCallback(() => setScanFor(null), [])

  return <Stack spacing={3}>
    <ToggleButtonGroup fullWidth exclusive value={direction} onChange={(_, value) => { if (value) { setDirection(value); setError('') } }} aria-label="Direct payment direction"><ToggleButton value="receive">Receive directly</ToggleButton><ToggleButton value="send">Pay directly</ToggleButton></ToggleButtonGroup>
    {!client && <Alert severity="info">Direct payments are not ready yet. Try again in a moment.</Alert>}
    {/* While the confirm dialog is open it shows the error itself. */}
    {error && !review && <Alert severity="error" onClose={() => setError('')}>{error}{errorDetail?.error === error && <Typography variant="body2" sx={{ mt: .5 }}>{errorDetail.detail}</Typography>}</Alert>}
    {busy && <LinearProgress />}
    {direction === 'receive' ? phase === 'received' && received ? <Box sx={{ textAlign: 'center', py: 4 }}>
      <CheckCircleOutline color="primary" sx={{ fontSize: 54 }} />
      <Typography variant="h6" sx={{ mt: 2 }}>Payment received</Typography>
      <Typography variant="h4" sx={{ my: 1.5, fontWeight: 700 }}><AmountDisplay>{received.amount}</AmountDisplay></Typography>
      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>From {received.sender}</Typography>
      {received.requested !== undefined && <Alert severity="warning" sx={{ mt: 2, textAlign: 'left' }}>Received {received.amount.toLocaleString()} satoshis — you requested {received.requested.toLocaleString()}.</Alert>}
      {received.status === 'received' && <Alert severity="info" sx={{ mt: 2, textAlign: 'left' }}>Your wallet could not add it yet. It is kept on this device and added once it can be verified.</Alert>}
      <Button sx={{ mt: 2 }} onClick={newRequest}>Receive another payment</Button>
    </Box> : !offer ? <>
      <AmountInput label="Amount to request (optional)" fullWidth valueSats={requestAmount} onChangeSats={setRequestAmount} helperText="Leave blank to let the sender choose." />
      <Button variant="contained" startIcon={<QrCode2Outlined />} onClick={() => void createRequest()} disabled={!client || busy || switchingNetwork || requestAmount !== null && !validAmount(requestAmount)}>{busy ? 'Creating…' : 'Create direct request'}</Button>
    </> : <>
      <CodeView code={offer.handle.code} caption="1. Ask the sender to scan this request" />
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>{offer.amount ? <AmountDisplay>{offer.amount}</AmountDisplay> : 'Sender chooses the amount'}</Typography>
      {phase === 'offer' && <>
        <Button variant="contained" startIcon={<QrCodeScannerOutlined />} onClick={() => setScanFor('answer')} disabled={switchingNetwork}>2. Scan their answer</Button>
        <Typography variant="body2" color="text.secondary">Scan their answer within 15 seconds of it appearing.</Typography>
        <Button onClick={newRequest}>Start a new request</Button>
      </>}
      {phase === 'connecting' && <Box><LinearProgress /><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Connecting to their wallet…</Typography></Box>}
      {phase === 'connected' && <Box><LinearProgress /><Typography sx={{ mt: 1, fontWeight: 650 }}>Connected to a verified wallet</Typography><Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{sender}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Waiting for their payment…</Typography></Box>}
    </> : payPhase === 'done' && done ? <Box sx={{ textAlign: 'center', py: 4 }}>
      <CheckCircleOutline color="primary" sx={{ fontSize: 54 }} />
      <Typography variant="h6" sx={{ mt: 2 }}>Payment delivered</Typography>
      <Typography variant="h4" sx={{ my: 1.5, fontWeight: 700 }}><AmountDisplay>{done.payment.amount}</AmountDisplay></Typography>
      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>To {done.payment.recipient}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{done.ack.status === 'accepted' ? 'It is in their wallet.' : 'Their wallet received it and will add it shortly.'}</Typography>
      <Button sx={{ mt: 2 }} onClick={payAgain}>Make another payment</Button>
    </Box> : payPhase === 'answer' && answer ? <>
      <CodeView code={answer.answerCode} caption="Ask them to scan this answer now" />
      <Typography variant="body2" color="text.secondary">Their wallet must scan it within about 15 seconds. Copying it works too, if it reaches them that quickly.</Typography>
      <Box><LinearProgress /><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Waiting for their wallet to connect… Nothing is spent until it does.</Typography></Box>
      <Button onClick={cancelAnswer}>Cancel</Button>
    </> : payPhase === 'sending' ? <Box sx={{ py: 2 }}>
      <LinearProgress />
      <Typography sx={{ mt: 1.5, fontWeight: 650 }}>Connected to their wallet</Typography>
      <Typography variant="body2" color="text.secondary">Sending the payment… Keep this screen open until it is confirmed.</Typography>
    </Box> : <>
      <TextField fullWidth multiline minRows={2} label="Recipient’s direct request" placeholder="webrtpay1:…" value={input} onChange={event => setInput(event.target.value)} error={!!offerError} helperText={offerError || 'Paste their request code, or scan it below.'} />
      <Button variant="outlined" startIcon={<QrCodeScannerOutlined />} onClick={() => setScanFor('offer')}>Scan their request</Button>
      {offerCode && <Alert severity="info">{offerCode.amount ? <>Requested amount: <AmountDisplay>{offerCode.amount}</AmountDisplay></> : 'This is an open request. Choose an amount.'} · {short(offerCode.identityKey)}</Alert>}
      {saved ? <>
        <Alert severity="warning">A payment of <AmountDisplay>{saved.amount}</AmountDisplay> to this wallet was saved but never delivered. Deliver it now instead of making a new payment.</Alert>
        <Button variant="contained" onClick={openReview} disabled={!client || busy || switchingNetwork}>Deliver saved payment of {saved.amount.toLocaleString()} satoshis</Button>
      </> : <>
        <AmountInput fullWidth label="Amount" valueSats={chosenAmount} onChangeSats={setPayAmount} disabled={offerCode?.amount !== undefined} helperText={offerCode?.amount !== undefined ? 'This amount comes from their request.' : 'Network fees are added when the payment is created.'} />
        <Button variant="contained" onClick={openReview} disabled={!client || !offerCode || !validAmount(chosenAmount) || busy || switchingNetwork}>Review direct payment</Button>
      </>}
    </>}
    <QrScanner open={scanFor !== null} onClose={closeScanner} onRead={read} title={scanFor === 'answer' ? 'Scan their answer' : 'Scan their request'} description={scanFor === 'answer' ? 'Scan the answer code their wallet shows. Scan their answer within 15 seconds of it appearing.' : 'Scan the direct request code their wallet shows.'} />
    <Dialog open={!!review} onClose={() => { if (!busy) setReview(null) }} fullWidth maxWidth="xs"><DialogTitle>{review?.saved ? 'Deliver your saved payment' : 'Confirm direct payment'}</DialogTitle><DialogContent><Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography variant="h4" sx={{ fontWeight: 700 }}><AmountDisplay>{review?.amount ?? 0}</AmountDisplay></Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>To {review?.offer.identityKey}</Typography>
      <Divider />
      <Typography variant="body2" color="text.secondary">Network: {networkLabel(chain)}. {review?.saved ? 'This delivers the payment you already made, with the same transaction; nothing new is spent. ' : `${review?.offer.amount !== undefined ? 'The amount comes from their request. ' : ''}A network fee will be added. Nothing is spent until their wallet connects and proves it is theirs. `}Next, show them your answer code.</Typography>
    </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setReview(null)}>Back</Button><Button variant="contained" disabled={busy || switchingNetwork || !client} onClick={() => void confirm()}>{busy ? 'Preparing…' : 'Confirm & show answer'}</Button></DialogActions></Dialog>
  </Stack>
}
