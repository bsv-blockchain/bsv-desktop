/**
 * Direct delivery on the Payments page: the choice between the message box and a direct
 * connection, the direct-payments status line on the Receive tab, and how the page is
 * wired to the C3 flows. The repo has no DOM test environment, so the page's decisions
 * live in delivery.ts and the wiring is checked in source.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DELIVERY_HELP, deliveryProblem, directStatusLine } from '../src/lib/pages/Dashboard/Payments/delivery'
import { networkLabel } from '../src/lib/pages/Dashboard/Payments/paymentProtocol'

const ready = { client: {}, via: 'messagebox' as const, error: '', notice: '' }

describe('choosing how a wallet payment is delivered', () => {
  it('explains each choice; Direct says it connects first, spends nothing if the recipient is offline, and shows them your IP address', () => {
    expect(DELIVERY_HELP.direct).toBe("Direct · connects to the recipient's wallet first; nothing is spent if they're offline. A direct payment reveals your IP address to their wallet.")
    expect(DELIVERY_HELP.messagebox).toMatch(/^Message box · /)
    expect(DELIVERY_HELP.messagebox).toMatch(/offline/)
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

  it('still allows direct sending while receiving is off or failing', () => {
    expect(deliveryProblem('direct', { messageBoxAvailable: true, directPay: { client: {}, via: 'relay', error: 'Direct payments cannot be received: relay down', notice: '' } })).toBe('')
  })
})

describe('direct-payments status line on the Receive tab', () => {
  it.each([
    [{ status: 'online', via: 'messagebox', error: '', notice: '' }, 'success', 'Direct payments: online via the message box.'],
    [{ status: 'online', via: 'relay', error: '', notice: '' }, 'success', 'Direct payments: online via the relay server.'],
    [{ status: 'off', via: 'messagebox', error: '', notice: '' }, 'info', 'Direct payments: off — enable in Settings.'],
    [{ status: 'starting', via: 'relay', error: '', notice: '' }, 'info', 'Direct payments: starting…'],
    // No message box: not set up, and nothing alarming.
    [{ status: 'off', via: null, error: '', notice: 'Direct payments reach other wallets through the message box. Connect a message box in Settings, or use a relay server.' }, 'info', 'Direct payments: not set up. Direct payments reach other wallets through the message box. Connect a message box in Settings, or use a relay server.'],
    [{ status: 'error', via: null, error: 'Enter a relay server address in Settings, or use the message box for direct payments.', notice: '' }, 'error', 'Enter a relay server address in Settings, or use the message box for direct payments.'],
    [{ status: 'error', via: 'relay', error: 'Direct payments cannot be received: the relay server cannot be reached. Trying again…', notice: '' }, 'error', 'Direct payments cannot be received: the relay server cannot be reached. Trying again…']
  ] as const)('%o', (snapshot, severity, text) => {
    expect(directStatusLine(snapshot)).toEqual({ severity, text })
  })
})

describe('Payments page wiring', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/lib/pages/Dashboard/Payments/index.tsx'), 'utf8')

  it('splits availability into the message box and direct delivery', () => {
    expect(page).toMatch(/const messageBoxAvailable = !!peerPayClient && useMessageBox && !!messageBoxUrl/)
    expect(page).toMatch(/const directAvailable = !!directPay\.client/)
    expect(page).not.toMatch(/const available =/)
    expect(page).not.toMatch(/[!(&|]\s*available\b/)
  })

  it('offers Message box or Direct for identity payments, Direct disabled without a client', () => {
    expect(page).toMatch(/useState<Delivery>\('messagebox'\)/)
    expect(page).toMatch(/<ToggleButtonGroup[^>]*aria-label="Delivery"/)
    expect(page).toMatch(/<ToggleButton value="messagebox">Message box<\/ToggleButton><ToggleButton value="direct" disabled=\{!directAvailable\}>Direct<\/ToggleButton>/)
    expect(page).toMatch(/DELIVERY_HELP\[delivery\]/)
  })

  it('fixes the delivery when the payment is reviewed, shows it, and pays requests through the message box', () => {
    expect(page).toMatch(/setReview\(\{ target, amount: sendAmount!, delivery \}\)/)
    expect(page).toMatch(/request, delivery: 'messagebox' \}\)/)
    expect(page).toMatch(/Delivery: \{review\?\.delivery === 'direct' \? 'Direct \(peer-to-peer\)' : 'Message box'\}<\/Typography><Typography variant="caption" color="text\.secondary">\{DELIVERY_HELP\[review\.delivery\]\}/)
  })

  it('sends a direct payment with deliverDirect, saving the row before broadcast and marking it delivered', () => {
    expect(page).toMatch(/import \{ deliverDirect \} from '\.\/directPayments'/)
    const branch = page.slice(page.indexOf("if (review.delivery === 'direct')"))
    expect(branch).toMatch(/^if \(review\.delivery === 'direct'\) \{/)
    const call = branch.slice(branch.indexOf('await deliverDirect({'), branch.indexOf('} else {'))
    expect(call).toMatch(/client: directPay\.client/)
    expect(call).toMatch(/recipient: review\.target\.recipient, amount: review\.amount/)
    // Both write from the rows stored at that moment (see directCodes.test.ts wiring).
    expect(call).toMatch(/persist: row => \{ addOutgoing\(row\); prepared = true \}/)
    expect(call).toMatch(/markDelivered: markOutgoingDelivered \}\)/)
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

  it('tells the user when a direct payment arrives, and stops listening when the page closes', () => {
    expect(page).toMatch(/window\.addEventListener\('direct-payment-received', onReceived\)/)
    expect(page).toMatch(/return \(\) => window\.removeEventListener\('direct-payment-received', onReceived\)/)
    expect(page).toMatch(/notify\(validAmount\(amount\) \? `Direct payment received: \$\{amount\.toLocaleString\(\)\} satoshis\.` : 'Direct payment received\.'\)/)
  })

  it('shows the direct-payments status on the Receive tab, even without a message box', () => {
    expect(page).toMatch(/const directLine = directStatusLine\(directPay\)/)
    const receive = page.slice(page.indexOf("{tab === 'receive' &&"), page.indexOf("{tab === 'nearby' &&"))
    expect(receive).toMatch(/<Alert severity=\{directLine\.severity\}[^\n]*>\{directLine\.text\}<\/Alert>/)
    expect(receive.indexOf('{directLine.text}')).toBeGreaterThan(-1)
    expect(receive.indexOf('{directLine.text}')).toBeLessThan(receive.indexOf('!messageBoxAvailable ?'))
  })

  it('asks for a positive amount only when the requested amount is the problem', () => {
    expect(page).toMatch(/requestAmount !== null && !validAmount\(requestAmount\) \? 'Enter a positive amount or leave it blank\.' : 'Your payment link is not ready yet\.'/)
  })
})

describe('network names on the Payments page', () => {
  it('names each network as the Payments chip always has', () => {
    expect(networkLabel('main')).toBe('Mainnet')
    expect(networkLabel('test')).toBe('Testnet')
    expect(networkLabel('ttn')).toBe('TeraTestnet')
    expect(networkLabel('tstn')).toBe('TeraScaling Testnet')
  })

  it('uses those names in the chip and in every confirmation, never the raw chain id', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../src/lib/pages/Dashboard/Payments', file), 'utf8')
    const page = read('index.tsx'), exchange = read('DirectCodeExchange.tsx'), nearby = read('NearbyPayments.tsx'), codes = read('directCodes.ts')
    expect(page).toMatch(/<Chip size="small" label=\{networkLabel\(chain\)\} variant="outlined" \/>/)
    expect(page).toMatch(/Network: \{networkLabel\(chain\)\}\. Confirm the recipient and network before sending\./)
    expect(exchange).toMatch(/Network: \{networkLabel\(chain\)\}\. /)
    expect(nearby).toMatch(/Network: \{networkLabel\(chain\)\}\. /)
    expect(codes).toMatch(/This request is for \$\{networkLabel\(code\.chain\)\}, but your wallet is on \$\{networkLabel\(chain\)\}\./)
    for (const source of [page, exchange, nearby, codes]) {
      expect(source).not.toMatch(/chain\.toUpperCase\(\)/)
      expect(source).not.toMatch(/chain === 'main' \?/)
    }
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

  it('Nearby → Direct: in the confirm dialog while it is open, on the screen otherwise', () => {
    const exchange = read('DirectCodeExchange.tsx')
    expect(exchange).toMatch(/\{error && !review && <Alert severity="error" onClose=\{\(\) => setError\(''\)\}>/)
    const dialog = exchange.slice(exchange.indexOf('<Dialog open={!!review}'))
    expect(dialog).toMatch(/^[^\n]*<DialogContent><Stack spacing=\{2\}>\n\s*\{error && <Alert severity="error">\{error\}<\/Alert>\}/)
    expect(exchange.match(/\{error && /g)).toHaveLength(2)
    // A new review starts without the last attempt's error, which would read as this one's.
    expect(exchange).toMatch(/if \(validAmount\(amount\)\) \{ setError\(''\); setReview\(\{ code: input\.trim\(\), offer: offerCode, amount, saved \}\) \}/)
  })
})
