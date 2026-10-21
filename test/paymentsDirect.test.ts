/**
 * Direct delivery on the Payments page: Pay tries live first and asks before using the message
 * box (no delivery choice), saved payments retry either way, and how the page is wired to the
 * C3 flows. The repo has no DOM test environment, so the page's decisions
 * live in delivery.ts and the wiring is checked in source.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as delivery from '../src/lib/pages/Dashboard/Payments/delivery'
import { codeExchangeProblem, deliveryProblem } from '../src/lib/pages/Dashboard/Payments/delivery'
import { networkLabel } from '../src/lib/pages/Dashboard/Payments/paymentProtocol'

const ready = { client: {}, via: 'messagebox' as const, error: '', notice: '' }

describe('whether a wallet payment can be delivered', () => {
  it('no longer offers a delivery choice to explain', () => {
    expect('DELIVERY_HELP' in delivery).toBe(false)
  })

  it('needs a connected message box for message box delivery only', () => {
    expect(deliveryProblem('messagebox', { messageBoxAvailable: true, directPay: { client: null, via: null, error: '', notice: '' } })).toBe('')
    expect(deliveryProblem('messagebox', { messageBoxAvailable: false, directPay: ready })).toMatch(/Connect your message box in Settings/)
    expect(deliveryProblem('direct', { messageBoxAvailable: false, directPay: ready })).toBe('')
  })

  it('needs a direct-pay client for direct delivery, and says why there is none when it is known', () => {
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: null, via: null, error: '', notice: '' } })).toMatch(/not ready/)
    const failed = 'Direct payments could not be set up: bad options'
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: null, via: null, error: failed, notice: '' } })).toBe(failed)
    const notice = 'Direct payments reach other wallets through the message box. Connect a message box in Settings, or use a relay server.'
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: null, via: null, error: '', notice } })).toBe(notice)
  })

  it('explains why direct delivery cannot reach anyone when no signaler is set up', () => {
    const error = 'Enter a relay server address in Settings, or use the message box for direct payments.'
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: {}, via: null, error, notice: '' } })).toBe(error)
    const notice = 'Direct payments reach other wallets through the message box. Connect a message box in Settings, or use a relay server.'
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: {}, via: null, error: '', notice } })).toBe(notice)
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: {}, via: null, error: '', notice: '' } })).toMatch(/Settings/)
  })

  // Final review M27: when there is no client, say why instead of "not ready" for ever.
  it('says why face-to-face codes are unavailable when there is no client, and nothing when there is one', () => {
    expect(codeExchangeProblem({ client: null, error: 'Direct payments could not be set up: bad options' })).toBe('Direct payments could not be set up: bad options')
    expect(codeExchangeProblem({ client: null, error: '' })).toBe('Direct payments are not ready yet. Try again in a moment.')
    // Codes need no signaler, so a missing message box is no reason.
    expect(codeExchangeProblem({ client: {}, error: '' })).toBe('')
  })

  it('still allows direct sending while receiving is off or failing', () => {
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: {}, via: 'relay', error: 'Direct payments cannot be received: relay down', notice: '' } })).toBe('')
  })
})

// The Receive tab's live payments card (liveStatus) is tested in delivery.test.ts.

describe('Payments page wiring', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/lib/pages/Dashboard/Payments/index.tsx'), 'utf8')

  it('splits availability into the message box and live sending, which needs a signaler', () => {
    expect(page).toMatch(/const messageBoxAvailable = !!peerPayClient && useMessageBox && !!messageBoxUrl/)
    expect(page).toMatch(/const directSendable = !!directPay\.client && directPay\.via !== null/)
    expect(page).not.toMatch(/const available =/)
    expect(page).not.toMatch(/[!(&|]\s*available\b/)
  })

  it('asks nobody how to deliver: no Delivery toggle, no delivery in the review', () => {
    expect(page).not.toMatch(/aria-label="Delivery"/)
    expect(page).not.toMatch(/DELIVERY_HELP|useState<Delivery>|Delivery: /)
    expect(page).not.toMatch(/Confirm & send/)
    expect(page).toMatch(/setReview\(\{ target, amount: sendAmount!, name: recipientLabel \|\| short\(target\.recipient\) \}\)/)
    expect(page).toMatch(/request, name: short\(request\.sender\) \}\)/)
  })

  it('pays live first through payIdentity, and pays requests and the fallback through the message box only', () => {
    expect(page).toMatch(/import \{ fallbackPrompt, payIdentity \} from '\.\/payFlow'/)
    expect(page).toMatch(/const direct = !viaMessageBox && !review\.request && directSendable \? async \(\) => \{/)
    expect(page).toMatch(/const messageBox = messageBoxAvailable \? async \(\) => \{/)
    expect(page).toMatch(/const outcome = await payIdentity\(\{ direct, messageBox, name: review\.name \}\)/)
    expect(page).toMatch(/if \(outcome\.kind === 'ask_fallback'\) \{ setFallback\(outcome\.reason\); return \}/)
    expect(page).toMatch(/`Paid \$\{review\.name\} \$\{formatAmount\(review\.amount\)\} · live/)
  })

  it('sends a live payment with deliverDirect, saving the row before broadcast, marking it delivered, cancellable', () => {
    expect(page).toMatch(/import \{ deliverDirect \} from '\.\/directPayments'/)
    const call = page.slice(page.indexOf('await deliverDirect({'), page.indexOf('return { ackStatus: ack.status }'))
    expect(call).toMatch(/client: directPay\.client/)
    expect(call).toMatch(/recipient: target\.recipient, amount: review\.amount, host: target\.host,/)
    // Both write from the rows stored at that moment (see directCodes.test.ts wiring).
    // Once the payment exists, Cancel no longer applies (desktop review minor 2).
    expect(call).toMatch(/persist: row => \{ addOutgoing\(row\); prepared = true; dialAbort\.current = null; setReaching\(false\) \}/)
    expect(call).toMatch(/markDelivered: markOutgoingDelivered, signal: dial\.signal \}\)/)
    // Cancel while reaching aborts the dial and says nothing more.
    expect(page).toMatch(/if \(dial\.signal\.aborted && !prepared && outcome\.kind !== 'paid_live'\) \{ setReview\(null\); return \}/)
  })

  // Desktop review minors 1 and 15.
  it('never offers the message box once the payment exists, and aborts a dial on unmount or a wallet or network change', () => {
    const guard = page.indexOf("if (outcome.kind === 'ask_fallback' && prepared) throw new Error(")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(page.indexOf("if (outcome.kind === 'ask_fallback') { setFallback(outcome.reason); return }"))
    expect(page).toMatch(/useEffect\(\(\) => \{ dialAbort\.current\?\.abort\(\); setReview\(null\);[^\n]*\}, \[wallet, chain\]\)/)
    expect(page).toMatch(/useEffect\(\(\) => \(\) => dialAbort\.current\?\.abort\(\), \[\]\)/)
  })

  it('shows the fallback prompt inside the review, with Send to message box and Cancel, and Pay / Reaching otherwise', () => {
    const dialog = page.slice(page.indexOf('<DialogTitle>Review your payment</DialogTitle>'))
    expect(dialog).toMatch(/\{fallback && review && <Alert severity="warning">\{fallbackPrompt\(fallback, review\.name\)\}<\/Alert>\}/)
    expect(dialog).toMatch(/onClick=\{\(\) => setReview\(null\)\}>Cancel<\/Button><Button variant="contained" disabled=\{busy \|\| switchingNetwork\} onClick=\{\(\) => void send\(true\)\}>\{busy \? 'Sending…' : 'Send to message box'\}/)
    expect(dialog).toMatch(/\{busy \? reaching \? `Reaching \$\{review\?\.name\}…` : 'Sending…' : 'Pay'\}/)
    expect(dialog).toMatch(/if \(reaching\) cancelReaching\(\); else setReview\(null\)/)
  })

  it('finds people by name, handle, email or a pasted identity key, with a scanner in the field and no nearby payments', () => {
    expect(page).toMatch(/placeholder="Name, @handle, email, or identity key"/)
    expect(page).toMatch(/options=\{recipientOptions\}/)
    expect(page).toMatch(/option\.badgeLabel/)
    expect(page).not.toMatch(/nearby|Nearby/)
    expect(page).toMatch(/\{params\.InputProps\.endAdornment\}<IconButton aria-label="Scan a payment code"/)
    expect(page).toMatch(/aria-label="Payment options"><Tab label="Send" value="send"[^\n]*<Tab label="Receive" value="receive"[^\n]*\/><\/Tabs>/)
  })

  it('says why a wallet identity cannot be paid only when neither live nor the message box can', () => {
    expect(page).toMatch(/const identityIssue = !messageBoxAvailable && !directSendable \? deliveryProblem\('messagebox', \{ messageBoxAvailable, directPay \}\) : ''/)
    expect(page).toMatch(/\{target\?\.kind === 'identity' && identityIssue && <Alert severity="warning">\{identityIssue\}<\/Alert>\}/)
  })

  it('records message box rows as such', () => {
    expect(page).toMatch(/\{ \.\.\.original, via: 'messagebox' as const/)
  })

  it('shows how each saved payment was sent and retries it either way with the same transaction', () => {
    expect(page).toMatch(/payment\.via === 'direct' \? 'sent directly' : 'sent via message box'/)
    expect(page).toMatch(/>Retry via message box<\/Button>/)
    expect(page).toMatch(/>Retry directly<\/Button>/)
    expect(page).toMatch(/existing: payment/)
  })

  // Arrivals are toasted app-wide by PaymentToasts (with receivedNotice for a payment only kept
  // on this device), so the page no longer listens for them itself.
  it('leaves announcing arrivals to PaymentToasts', () => {
    expect(page).not.toMatch(/direct-payment-received/)
    const toasts = fs.readFileSync(path.resolve(__dirname, '../src/lib/components/PaymentToasts.tsx'), 'utf8')
    expect(toasts).toMatch(/window\.addEventListener\('direct-payment-received', onLive\)/)
    expect(toasts).toMatch(/window\.addEventListener\('messagebox-payment-received', onMessageBox\)/)
    expect(toasts).toMatch(/detail\.status !== 'accepted'\) \{ toast\.warning\(receivedNotice\(detail\)\.text\)/)
    const ui = fs.readFileSync(path.resolve(__dirname, '../src/lib/UserInterface.tsx'), 'utf8')
    expect(ui).toMatch(/<ThemedToastContainer \/>\n\s*<PaymentToasts \/>/)
  })

  it('shows the live payments card on the Receive tab, even without a message box, with Settings when off', () => {
    expect(page).toMatch(/const live = liveStatus\(directPay\)/)
    const receive = page.slice(page.indexOf("{tab === 'receive' &&"), page.indexOf('</Paper>', page.indexOf("{tab === 'receive' &&")))
    expect(receive).toMatch(/\{live\.title\}/)
    expect(receive).toMatch(/\(live\.tone === 'off' \|\| live\.tone === 'error'\) && <Button size="small" onClick=\{\(\) => history\.push\('\/dashboard\/settings\/advanced'\)/)
    expect(receive.indexOf('{live.title}')).toBeLessThan(receive.indexOf('!messageBoxAvailable ?'))
  })

  it('lists message box payments received automatically, with Retry for failures, and no Add to wallet', () => {
    expect(page).toMatch(/Arrived while you were away/)
    expect(page).toMatch(/messageBoxReceived\.slice\(0, 20\)\.map\(record =>/)
    expect(page).toMatch(/onClick=\{\(\) => void retryReceived\(record\.messageId\)\}/)
    expect(page).not.toMatch(/Add to wallet|acceptPayment|listIncomingPayments\(/)
    // refresh() lists payment requests only.
    const refresh = page.slice(page.indexOf('const refresh = useCallback'), page.indexOf('const deliver = async'))
    expect(refresh).toMatch(/listIncomingPaymentRequests\(messageBoxUrl\)/)
  })


  // Final review M18: switching tabs clears `error`; this warning must stay while it is true.
  it('keeps warning that saved payments could not be read, across tab changes', () => {
    expect(page).toMatch(/const rows = readOutbox\(outboxKey\); setOutboxUnreadable\(!rows\); if \(rows\) setOutgoing\(rows\)/)
    expect(page).toMatch(/\{outboxUnreadable && <Alert severity="warning" sx=\{\{ mb: 2 \}\}>Saved payments on this device could not be read\./)
    expect(page).not.toMatch(/setError\('Saved payments could not be read/)
  })

  it('always shows the identity as a payment QR on Receive, with or without a message box', () => {
    expect(page).toMatch(/peerPayLink\(identity, useMessageBox && messageBoxUrl \? messageBoxUrl : undefined, requestAmount \?\? undefined\)/)
    const receive = page.slice(page.indexOf("{tab === 'receive' &&"), page.indexOf('</Paper>', page.indexOf("{tab === 'receive' &&")))
    expect(receive.indexOf('<QRCodeSVG value={receiveLink}')).toBeGreaterThan(-1)
    expect(receive.indexOf('<QRCodeSVG value={receiveLink}')).toBeLessThan(receive.indexOf('!messageBoxAvailable ?'))
    expect(receive).toMatch(/Enter a positive amount or leave it blank\./)
  })
})

describe('network names on the Payments page', () => {
  it('names each network as the Payments chip always has', () => {
    expect(networkLabel('main')).toBe('Mainnet')
    expect(networkLabel('test')).toBe('Testnet')
    expect(networkLabel('ttn')).toBe('TeraTestnet')
    expect(networkLabel('tstn')).toBe('TeraScaling Testnet')
  })

  // Final review M20/M25: a code from another wallet can name any network.
  it('names a network it does not know by the code\'s own id, never as another network', () => {
    for (const chain of ['stn', 'mainnet', 'regtest', 'constructor']) expect(networkLabel(chain)).toBe(chain)
  })

  it('uses those names in the chip and in every confirmation, never the raw chain id', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../src/lib/pages/Dashboard/Payments', file), 'utf8')
    const page = read('index.tsx'), protocol = read('paymentProtocol.ts')
    expect(page).toMatch(/<Chip size="small" label=\{networkLabel\(chain\)\} variant="outlined" \/>/)
    expect(page).toMatch(/Network: \{networkLabel\(chain\)\}\. Confirm the recipient and network before sending\./)
    expect(protocol).toMatch(/This request is for \$\{networkLabel\(theirs\)\}, but your wallet is on \$\{networkLabel\(chain\)\}\./)
    expect(page).not.toMatch(/chain\.toUpperCase\(\)/)
    expect(page).not.toMatch(/chain === 'main' \?/)
  })
})

describe('a payment error is shown once', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../src/lib/pages/Dashboard/Payments', file), 'utf8')

  it('Send: in the review dialog while it is open, on the page otherwise', () => {
    const page = read('index.tsx')
    expect(page).toMatch(/\{error && !review && <Alert severity="error" onClose=\{\(\) => setError\(''\)\} sx=\{\{ mb: 2 \}\}>\{error\}<\/Alert>\}/)
    const dialog = page.slice(page.indexOf('<DialogTitle>Review your payment</DialogTitle>'))
    expect(dialog).toMatch(/^[^\n]*\{error && <Alert severity="error">\{error\}<\/Alert>\}[^\n]*<\/Dialog>/)
    expect(page.match(/\{error && /g)).toHaveLength(2)
  })

  // Final review D7/M17: an earlier attempt's error ("Nothing was spent", "do not send a new
  // payment") must not appear inside a new review as if it were this payment's.
  it('Send: Review payment and Review & pay start without the last attempt\'s error', () => {
    const page = read('index.tsx')
    expect(page).toMatch(/onClick=\{\(\) => \{ setNotice\(''\); setError\(''\); setReview\(\{ target, amount: sendAmount!, name: recipientLabel \|\| short\(target\.recipient\) \}\) \}\}>Review payment<\/Button>/)
    expect(page).toMatch(/onClick=\{\(\) => \{ setError\(''\); setReview\(\{ target: \{ kind: 'identity', recipient: request\.sender \}, amount: request\.amount, request, name: short\(request\.sender\) \}\) \}\}>Review & pay<\/Button>/)
  })

  // Clearing the error drops its "do not send a new payment"; the review says it itself instead.
  it('Send: the review warns of a saved payment to the same wallet that was never delivered', () => {
    const page = read('index.tsx')
    expect(page).toMatch(/const savedForReview = review\?\.target\.kind === 'identity' \? pending\.find\(row => row\.recipient === review\.target\.recipient\) : undefined/)
    expect(page).toMatch(/\{savedForReview && <Alert severity="warning">A payment of \{savedForReview\.amount\.toLocaleString\(\)\} satoshis to this wallet is saved but was never delivered\. Retry it from Saved payments instead of sending a new one\.<\/Alert>\}/)
  })
})
