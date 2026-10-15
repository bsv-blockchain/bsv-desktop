import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, LinearProgress, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import QrCodeScannerOutlined from '@mui/icons-material/QrCodeScannerOutlined'
import QrCode2Outlined from '@mui/icons-material/QrCode2Outlined'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import { AirGapDecoder, AirGapEncoder, isAirGapPart } from '@bsv/air-gap'
import { Utils } from '@bsv/sdk'
import { QRCodeSVG } from 'qrcode.react'
import { WalletContext } from '../../../WalletContext'
import { beginUserWalletOperation } from '../../../services/httpBridgeSession'
import AmountInput from '../../../components/AmountInput'
import AmountDisplay from '../../../components/AmountDisplay'
import QrScanner from './QrScanner'
import { buildNearbyPayment, broadcastNearbyPayment, decodeNearbySession, encodeNearbySession, FOUNTAIN_BLOCK_BYTES, mintNearbySession, NearbyFrame, NearbySession, SavedNearbyPayment, resolveNearbyFrame, savedPaymentForSession, verifyNearbyPayment } from './nearbyProtocol'
import { validAmount } from './paymentProtocol'

function FountainCode({ sealed }: { sealed: number[] }) {
  const encoder = useMemo(() => new AirGapEncoder(new Uint8Array(sealed), { blockBytes: FOUNTAIN_BLOCK_BYTES }), [sealed])
  const [sequence, setSequence] = useState(0)
  useEffect(() => { setSequence(0); if (encoder.blockCount === 1) return; const timer = setInterval(() => setSequence(value => (value + 1) % (encoder.blockCount * 64)), 200); return () => clearInterval(timer) }, [encoder])
  return <Box sx={{ textAlign: 'center' }}><Box sx={{ display: 'inline-flex', p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 3, bgcolor: '#fff' }}><QRCodeSVG value={encoder.partAt(sequence)} size={300} style={{ maxWidth: '100%', height: 'auto' }} level="M" marginSize={1} /></Box><Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{encoder.blockCount === 1 ? 'Let the recipient scan this payment code.' : `Animated QR · ${encoder.blockCount} parts · keep this screen open`}</Typography></Box>
}
export default function NearbyPayments({ identity, onSuccess, initialRequest }: { identity: string; onSuccess: (message: string) => void; initialRequest?: string }) {
  const { managers, wallet: rawWallet, chain, adminOriginator, switchingNetwork } = useContext(WalletContext)
  const wallet = managers.permissionsManager!
  const storageKey = `nearby-payment-v1:${identity}:${chain}`
  const requestKey = `${storageKey}:request`
  const sessionArchiveKey = `${storageKey}:sessions`
  const [direction, setDirection] = useState<'receive' | 'send'>(initialRequest ? 'send' : 'receive')
  const [amount, setAmount] = useState<number | null>(null)
  const [session, setSession] = useState<NearbySession | null>(null)
  const [input, setInput] = useState(initialRequest || '')
  const [scanner, setScanner] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [broadcastPending, setBroadcastPending] = useState(false)
  const [records, setRecords] = useState<SavedNearbyPayment[]>([])
  const [prepared, setPrepared] = useState<SavedNearbyPayment | null>(null)
  const [review, setReview] = useState(false)
  const [received, setReceived] = useState(false)
  const [incoming, setIncoming] = useState<{ frame: NearbyFrame; amount: number; session: NearbySession } | null>(null)
  const [progress, setProgress] = useState(0)
  const decoder = useRef(new AirGapDecoder())
  const verifying = useRef(false)
  const mutationLock = useRef(false)
  const request = useMemo(() => { try { return input ? decodeNearbySession(input.trim(), chain) : null } catch { return null } }, [input, chain])
  const requestError = useMemo(() => { if (!input) return ''; try { decodeNearbySession(input.trim(), chain); return '' } catch (error) { return (error as Error).message } }, [input, chain])
  useEffect(() => {
    try {
      const rows = JSON.parse(localStorage.getItem(storageKey) || '[]')
      setRecords(Array.isArray(rows) ? rows : [])
      const pending = Array.isArray(rows) ? rows.filter(row => !row.confirmed) : []
      const last = pending[pending.length - 1]
      if (last && !last.confirmed && typeof last.txid === 'string' && Array.isArray(last.sealed) && validAmount(last.amount)) { new AirGapEncoder(new Uint8Array(last.sealed)); setPrepared(last); setBroadcastPending(last.broadcastPending !== false); setDirection('send') }
      const saved = localStorage.getItem(requestKey)
      if (saved) { const session = decodeNearbySession(saved, chain); if (session.identityKey === identity) setSession(session) }
    } catch { setError('A saved nearby payment could not be read. Your wallet activity still contains its transaction.') }
  }, [storageKey, requestKey, identity, chain])
  const closeScanner = useCallback(() => setScanner(false), [])
  const archiveRequest = (raw: string | null, settled = false) => {
    if (!raw) return
    const code = encodeNearbySession(decodeNearbySession(raw, chain))
    const archived = JSON.parse(localStorage.getItem(sessionArchiveKey) || '[]')
    if (!Array.isArray(archived)) throw new Error('Your saved nearby requests could not be read.')
    const canonical = archived.map(entry => ({ ...entry, code: encodeNearbySession(decodeNearbySession(entry.code, chain)) }))
    const next = canonical.some(entry => entry.code === code) ? canonical.map(entry => entry.code === code ? { ...entry, settled: entry.settled || settled } : entry) : [...canonical, { code, settled }]
    localStorage.setItem(sessionArchiveKey, JSON.stringify(next))
  }
  const makeRequest = () => {
    try {
      const next = mintNearbySession(identity, amount === null ? undefined : amount, chain)
      const code = encodeNearbySession(next)
      archiveRequest(localStorage.getItem(requestKey))
      archiveRequest(code)
      localStorage.setItem(requestKey, code)
      decoder.current = new AirGapDecoder(); setSession(next); setReceived(false); setIncoming(null); setProgress(0); setError('')
    } catch (error) { setError((error as Error).message) }
  }
  const read = useCallback(async (value: string) => {
    if (direction === 'send') { setInput(value); return }
    if (!session || received || incoming || verifying.current) return
    if (!isAirGapPart(value)) { setError('Scan the sender’s payment code after they have scanned your request.'); return }
    let bytes: Uint8Array | null
    try {
      const status = decoder.current.accept(value)
      setProgress(status.total ? Math.round(status.have / status.total * 100) : 0)
      bytes = decoder.current.message()
    } catch { setError('This payment code could not be read. Try scanning again.'); decoder.current = new AirGapDecoder(); setProgress(0); return }
    if (!bytes) return
    verifying.current = true; setBusy(true); setError(''); setScanner(false)
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      const archived = JSON.parse(localStorage.getItem(sessionArchiveKey) || '[]')
      if (!Array.isArray(archived)) throw new Error('Your saved nearby requests could not be read.')
      const { frame, session: matchedSession } = resolveNearbyFrame(bytes, session, archived, chain)
      const services = (rawWallet as any)?.getServices?.()
      if (!services?.getChainTracker) throw new Error('Wallet verification services are unavailable. Reopen your wallet and try again.')
      const tracker = await services.getChainTracker()
      const amount = await verifyNearbyPayment(wallet, tracker, frame, matchedSession, adminOriginator)
      setIncoming({ frame, amount, session: matchedSession })
    } catch (error) { setError((error as Error).message); decoder.current = new AirGapDecoder(); setProgress(0) } finally { release?.(); setBusy(false); verifying.current = false }
  }, [direction, session, received, incoming, rawWallet, wallet, adminOriginator, sessionArchiveKey, chain])
  const prepare = async () => {
    if (!request || !validAmount(request.amount ?? amount) || mutationLock.current || switchingNetwork) return
    const previous = savedPaymentForSession(records, request)
    if (previous) { setPrepared(previous); setBroadcastPending(previous.broadcastPending !== false); setReview(false); setError('This request already has a prepared payment. Showing the original code; no new payment was created.'); return }
    mutationLock.current = true
    setBusy(true); setError('')
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      const payment = await buildNearbyPayment(wallet, request, request.amount ?? amount!, adminOriginator, saved => {
        const prior = JSON.parse(localStorage.getItem(storageKey) || '[]')
        if (!Array.isArray(prior)) throw new Error('Your saved payment history could not be read.')
        localStorage.setItem(storageKey, JSON.stringify([...prior, saved])); setRecords([...prior, saved])
      })
      setPrepared(payment); setReview(false); setBroadcastPending(true)
      try { await broadcastNearbyPayment(wallet, payment.txid, adminOriginator); updateRecord(payment, { broadcastPending: false }); setBroadcastPending(false) } catch { setBroadcastPending(true) }
      window.dispatchEvent(new CustomEvent('balance-changed'))
    } catch (error) { setError((error as Error).message) } finally { release?.(); mutationLock.current = false; setBusy(false) }
  }
  const updateRecord = (payment: SavedNearbyPayment, update: Partial<SavedNearbyPayment>) => {
    const rows = JSON.parse(localStorage.getItem(storageKey) || '[]')
    const next = rows.map((row: SavedNearbyPayment) => row.txid === payment.txid ? { ...row, ...update } : row)
    localStorage.setItem(storageKey, JSON.stringify(next)); setRecords(next); setPrepared({ ...payment, ...update })
  }
  const accept = async () => {
    if (!incoming || !session || mutationLock.current || switchingNetwork) return
    mutationLock.current = true
    setBusy(true); setError('')
    let release: (() => void) | undefined
    try {
      release = beginUserWalletOperation()
      const { frame } = incoming
      const result = await wallet.internalizeAction({ tx: Array.from(frame.transaction), description: 'Received nearby BSV', labels: ['localpay', 'inbound'], outputs: [{ protocol: 'wallet payment', outputIndex: frame.outputIndex, paymentRemittance: { senderIdentityKey: frame.senderIdentityKey, derivationPrefix: frame.derivationPrefix, derivationSuffix: frame.derivationSuffix } }] }, adminOriginator)
      if (!result.accepted) throw new Error('The wallet did not accept this payment. Try again.')
      const paidCode = encodeNearbySession(incoming.session)
      archiveRequest(paidCode, true)
      if (localStorage.getItem(requestKey) === paidCode) localStorage.removeItem(requestKey)
      setReceived(true); setSession(null); setIncoming(null)
      window.dispatchEvent(new CustomEvent('balance-changed')); onSuccess('Nearby payment received.')
    } catch (error) { setError((error as Error).message) } finally { release?.(); mutationLock.current = false; setBusy(false) }
  }
  return <Stack spacing={3}>
    <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>A payment, face to face</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>Exchange encrypted QR codes with BSV Wallet. Both wallets must use the same network. Network access is needed to verify transaction proofs.</Typography></Box>
    <ToggleButtonGroup fullWidth exclusive value={direction} onChange={(_, value) => { if (value && !busy) { setDirection(value); setError('') } }} aria-label="Nearby payment direction"><ToggleButton value="receive">Receive nearby</ToggleButton><ToggleButton value="send">Pay nearby</ToggleButton></ToggleButtonGroup>
    {error && <Alert severity="error">{error}</Alert>}
    {busy && <LinearProgress />}
    {direction === 'receive' ? received ? <Box sx={{ textAlign: 'center', py: 4 }}><CheckCircleOutline color="primary" sx={{ fontSize: 54 }} /><Typography variant="h6" sx={{ mt: 2 }}>Payment received</Typography><Button sx={{ mt: 2 }} onClick={makeRequest}>Receive another payment</Button></Box> : incoming ? <Box sx={{ textAlign: 'center', py: 2 }}><Typography variant="body2" color="text.secondary">Verified payment</Typography><Typography variant="h4" sx={{ my: 2, fontWeight: 700 }}><AmountDisplay>{incoming.amount}</AmountDisplay></Typography><Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all', mb: 3 }}>From {incoming.frame.senderIdentityKey}</Typography><Button variant="contained" disabled={busy || switchingNetwork} onClick={accept}>Add to wallet</Button></Box> : <>
      {!session ? <><AmountInput label="Amount to request (optional)" fullWidth valueSats={amount} onChangeSats={setAmount} helperText="Leave blank to let the sender choose." /><Button variant="contained" startIcon={<QrCode2Outlined />} onClick={makeRequest} disabled={switchingNetwork || amount !== null && !validAmount(amount)}>Create nearby request</Button></> : <>
        <Box sx={{ textAlign: 'center', py: 2 }}><Box sx={{ display: 'inline-flex', bgcolor: '#fff', p: 1.5, borderRadius: 3 }}><QRCodeSVG value={encodeNearbySession(session)} size={260} style={{ maxWidth: '100%', height: 'auto' }} level="M" marginSize={2} /></Box><Typography sx={{ mt: 2, fontWeight: 700 }}>1. Ask the sender to scan this request</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{session.amount ? <AmountDisplay>{session.amount}</AmountDisplay> : 'Sender chooses the amount'}</Typography></Box>
        <Button variant="contained" startIcon={<QrCodeScannerOutlined />} onClick={() => setScanner(true)} disabled={busy || switchingNetwork}>2. Scan their payment code</Button>
        <Button onClick={() => { try { archiveRequest(localStorage.getItem(requestKey)); localStorage.removeItem(requestKey); setSession(null); setProgress(0) } catch (error) { setError((error as Error).message) } }} disabled={busy}>Start a new request</Button>
        <Typography variant="caption" color="text.secondary">Earlier requests remain saved so their payments can still be received.</Typography>
      </>}
    </> : prepared ? <>
      <Alert severity="success">Payment prepared for <AmountDisplay>{prepared.amount}</AmountDisplay>. Ask the recipient to scan the code and add it to their wallet.</Alert>
      {broadcastPending && <Alert severity="warning" action={<Button size="small" onClick={async () => { setBusy(true); let release: (() => void) | undefined; try { release = beginUserWalletOperation(); await broadcastNearbyPayment(wallet, prepared.txid, adminOriginator); updateRecord(prepared, { broadcastPending: false }); setBroadcastPending(false) } catch (error) { setError((error as Error).message) } finally { release?.(); setBusy(false) } }} disabled={busy || switchingNetwork}>Retry</Button>}>Broadcast is pending. The encrypted code is saved on this device.</Alert>}
      <FountainCode sealed={prepared.sealed} />
      <Typography variant="body2" color="text.secondary">This code remains valid for the recipient’s original request. Reopening Nearby restores it after an interruption.</Typography>
      <Button variant="outlined" onClick={() => { try { updateRecord(prepared, { confirmed: true }); setPrepared(null); setInput(''); setAmount(null) } catch { setError('The received status could not be saved. Your payment code remains available.') } }} disabled={busy}>Recipient has received it · make another payment</Button>
    </> : <>
      <TextField fullWidth multiline minRows={2} label="Recipient’s nearby request" placeholder="bsvpay1:…" value={input} onChange={event => setInput(event.target.value)} error={!!requestError} helperText={requestError || 'Paste a nearby request, or scan it below.'} />
      <Button variant="outlined" startIcon={<QrCodeScannerOutlined />} onClick={() => setScanner(true)}>Scan nearby request</Button>
      {request && <Alert severity="info">{request.amount ? <>Requested amount: <AmountDisplay>{request.amount}</AmountDisplay></> : 'This is an open request. Choose an amount.'}</Alert>}
      <AmountInput fullWidth label="Amount" valueSats={request?.amount ?? amount} onChangeSats={setAmount} disabled={request?.amount !== undefined} />
      <Button variant="contained" onClick={() => setReview(true)} disabled={!request || !validAmount(request?.amount ?? amount) || switchingNetwork}>Review nearby payment</Button>
    </>}
    {records.length > 0 && <Box component="details"><Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 650 }}>Saved nearby payments ({records.length})</Typography><Stack spacing={1} sx={{ pt: 2 }}>{records.slice().reverse().map(payment => <Box key={payment.txid} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><Stack direction="row" alignItems="center" justifyContent="space-between"><Box><Typography sx={{ fontWeight: 700 }}><AmountDisplay>{payment.amount}</AmountDisplay></Typography><Typography variant="caption" color="text.secondary">{payment.confirmed ? 'Recipient confirmed' : 'Awaiting receipt'} · {new Date(payment.createdAt).toLocaleDateString()}</Typography></Box><Button size="small" onClick={() => { setPrepared(payment); setBroadcastPending(payment.broadcastPending !== false); setDirection('send') }}>Show code</Button></Stack></Box>)}</Stack></Box>}
    <QrScanner open={scanner} onClose={closeScanner} onRead={value => void read(value)} continuous={direction === 'receive'} progress={direction === 'receive' && progress ? `${progress}% collected` : undefined} />
    <Dialog open={review} onClose={() => { if (!busy) setReview(false) }} fullWidth maxWidth="xs"><DialogTitle>Confirm nearby payment</DialogTitle><DialogContent><Stack spacing={2}><Typography variant="h4" sx={{ fontWeight: 700 }}><AmountDisplay>{request?.amount ?? amount ?? 0}</AmountDisplay></Typography><Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{request?.identityKey}</Typography><Divider /><Typography variant="body2" color="text.secondary">Network: {chain === 'main' ? 'Mainnet' : chain.toUpperCase()}. {request?.chain ? '' : 'The request does not specify its network. Check it with the recipient. '}A network fee will be added. After preparing, keep the code until the recipient confirms receipt.</Typography></Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setReview(false)}>Back</Button><Button variant="contained" disabled={busy || switchingNetwork} onClick={prepare}>{busy ? 'Preparing…' : 'Confirm & prepare'}</Button></DialogActions></Dialog>
  </Stack>
}
