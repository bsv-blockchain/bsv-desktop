/**
 * What the user is told about a received direct payment: whether it is in the wallet or only
 * received and kept until the wallet can add it (final review D6), the payer's side of that,
 * a kept payment's line in the Payments page's list, the recovery details that can add it by
 * hand, and the note in the remove-wallet dialog (D1, D4; Ruling 36).
 */
import { describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Utils } from '@bsv/sdk'
import { keptPaymentsRemovalNote, keptStatusText, payeeReceipt, payerReceipt, receivedNotice, recoveryDetails } from '../src/lib/pages/Dashboard/Payments/directReceipts'
import type { KeptDirectPaymentInfo } from '../src/lib/pages/Dashboard/Payments/directPayments'

// AmountDisplay reads the wallet's settings and exchange rates; the amount is what matters here.
vi.mock('../src/lib/components/AmountDisplay', () => ({ default: ({ children }: { children: number }) => createElement('span', null, `${children} sats`) }))
const { default: DirectReceiptView } = await import('../src/lib/pages/Dashboard/Payments/DirectReceiptView')

const SENDER = `03${'34'.repeat(32)}`
const ME = `02${'12'.repeat(32)}`
const beef = [1, 1, 1, 1, 0xab, 0xcd]
const kept = (change: Partial<KeptDirectPaymentInfo> = {}): KeptDirectPaymentInfo => ({
  key: `${'ab'.repeat(32)}:1:cHJl:c3Vm`,
  txid: 'ab'.repeat(32),
  sender: SENDER,
  amount: 1500,
  receivedAt: Date.UTC(2026, 9, 17, 12, 0, 0),
  attempts: 5,
  error: 'ChainTracks request failed with HTTP 503.',
  payment: { messageId: 'm1', sender: SENDER, token: { customInstructions: { derivationPrefix: 'cHJl', derivationSuffix: 'c3Vm' }, transaction: Utils.toBase64(beef), amount: 1500, outputIndex: 1 } },
  ...change
})

describe('the Payments page notice for a direct payment that arrived', () => {
  it('says it was added to the wallet only when the wallet took it', () => {
    expect(receivedNotice({ amount: 1500, status: 'accepted' })).toEqual({ severity: 'success', text: 'Direct payment added to your wallet: 1,500 satoshis.' })
  })

  it('says a payment the wallet only kept was received, not added, and is not in the balance yet; never a plain success', () => {
    const notice = receivedNotice({ amount: 1500, status: 'received' })
    expect(notice).toEqual({ severity: 'warning', text: 'Direct payment received, not yet added: 1,500 satoshis. It is not in your balance yet; it will be added when your wallet can verify it — retrying automatically.' })
    expect(notice.text).not.toMatch(/added to your wallet/)
    // An event that does not say the wallet took it is not announced as added either.
    expect(receivedNotice({ amount: 1500 }).severity).toBe('warning')
  })

  it('always gives the amount it has, and the requested amount when the payment differs from it (Ruling 29)', () => {
    expect(receivedNotice({ amount: 500, requested: 1200, status: 'accepted' }).text).toBe('Direct payment added to your wallet: 500 satoshis. You requested 1,200 satoshis.')
    expect(receivedNotice({ amount: 500, requested: 1200, status: 'received' }).text).toMatch(/^Direct payment received, not yet added: 500 satoshis\. You requested 1,200 satoshis\. It is not in your balance yet/)
    expect(receivedNotice({ amount: 'x', status: 'accepted' }).text).toBe('Direct payment added to your wallet.')
  })
})

describe('the payee\'s screen after a code-exchange payment', () => {
  const render = (received: Parameters<typeof DirectReceiptView>[0]['received']) => renderToStaticMarkup(createElement(DirectReceiptView, { received, onAgain: () => {} }))
  const SENDER = `03${'34'.repeat(32)}`

  it('shows a payment the wallet took as added, with its amount and payer', () => {
    const html = render({ amount: 1200, sender: SENDER, status: 'accepted', repeat: false, added: true })
    expect(html).toContain('Payment added to your wallet')
    expect(html).toContain('1200 sats')
    expect(html).toContain(SENDER)
    expect(html).toContain('CheckCircleOutline')
    expect(html).not.toMatch(/not yet added/)
  })

  // Final review D6: a kept payment is not verified; a success screen invites handing over goods.
  it('never shows a payment the wallet only kept as received or added, and says not to treat it as paid yet', () => {
    const html = render({ amount: 1200, sender: SENDER, status: 'received', repeat: false, added: false })
    expect(html).toContain('Received, not yet added')
    expect(html).toContain('1200 sats')
    expect(html).toMatch(/not in your balance yet/)
    expect(html).toMatch(/retrying automatically/)
    expect(html).toMatch(/Do not treat it as paid/)
    expect(html).not.toMatch(/Payment received|Payment added|CheckCircleOutline/)
  })

  it('shows the requested amount beside a payment of another amount, whether added or not (Ruling 29)', () => {
    for (const status of ['accepted', 'received'] as const) {
      expect(render({ amount: 500, requested: 1200, sender: SENDER, status, repeat: false, added: status === 'accepted' })).toContain('Received 500 satoshis — you requested 1,200.')
    }
  })

  it('wording comes from one place', () => {
    expect(payeeReceipt('accepted')).toEqual({ added: true, heading: 'Payment added to your wallet', detail: '' })
    expect(payeeReceipt('received')).toEqual({ added: false, heading: 'Received, not yet added', detail: 'It is not in your balance yet and has not been verified. It will be added when your wallet can verify it — retrying automatically. Do not treat it as paid until then.' })
  })
})

describe('the payer\'s side of a delivered direct payment', () => {
  it('says it is in their wallet only when their wallet took it', () => {
    expect(payerReceipt('accepted')).toBe('It is in their wallet.')
    expect(payerReceipt('received')).toBe('Their wallet received it but has not added it yet; it will be added when their wallet can verify it, which it retries automatically.')
  })
})

describe('a kept payment in the Payments page list', () => {
  it('says it was received but not added, and that the wallet keeps trying', () => {
    expect(keptStatusText(kept())).toBe('Received, not yet added. It will be added when your wallet can verify it — retrying automatically.')
  })

  it('says when it needs attention, that it stays on this device, and what the recovery details are for', () => {
    for (const reason of ['refused', 'unverifiable'] as const) {
      const text = keptStatusText(kept({ needsAttention: { since: 1, reason } }))
      expect(text).toMatch(/^Needs attention: your wallet could not add it/)
      expect(text).toMatch(/stays on this device/)
      expect(text).toMatch(/Copy the recovery details/)
    }
    expect(keptStatusText(kept({ needsAttention: { since: 1, reason: 'refused' } }))).toMatch(/refused it/)
    expect(keptStatusText(kept({ needsAttention: { since: 1, reason: 'unverifiable' } }))).toMatch(/could not verify it after repeated tries/)
  })
})

describe('recovery details', () => {
  it('carry everything needed to add the payment by hand, as JSON', () => {
    const details = JSON.parse(recoveryDetails(kept(), { identity: ME, chain: 'main' }))

    expect(details).toEqual({
      about: expect.stringMatching(/internalizeAction/),
      network: 'main',
      recipientIdentityKey: ME,
      senderIdentityKey: SENDER,
      txid: 'ab'.repeat(32),
      outputIndex: 1,
      amount: 1500,
      derivationPrefix: 'cHJl',
      derivationSuffix: 'c3Vm',
      atomicBEEF: Utils.toHex(beef),
      receivedAt: '2026-10-17T12:00:00.000Z',
      lastError: 'ChainTracks request failed with HTTP 503.'
    })
  })
})

describe('the remove-wallet dialog', () => {
  it('says nothing when no direct payment is waiting', () => {
    expect(keptPaymentsRemovalNote({ count: 0, total: 0 }, true)).toBe('')
  })

  it('names how many are waiting and their total, and that they stay here for the same recovery phrase', () => {
    expect(keptPaymentsRemovalNote({ count: 1, total: 700 }, true)).toBe('A direct payment you received (700 satoshis) is not in your wallet yet. It stays on this device and is added when you open this wallet here again with the same recovery phrase.')
    expect(keptPaymentsRemovalNote({ count: 3, total: 900 }, false)).toBe('3 direct payments you received (900 satoshis in total) are not in your wallet yet. They stay on this device and are added when you open this wallet here again with the same recovery material.')
  })
})

// The repo has no DOM test environment: one structural check per place these are shown.
describe('where kept payments are shown', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../src/lib', file), 'utf8')

  it('the Payments page lists the open wallet\'s kept payments, and the list follows every change', () => {
    expect(read('pages/Dashboard/Payments/index.tsx')).toMatch(/\{identity && <KeptDirectPayments identity=\{identity\} chain=\{chain\} sx=\{card\} \/>\}/)
    const list = read('pages/Dashboard/Payments/KeptDirectPayments.tsx')
    expect(list).toMatch(/const read = \(\) => setKept\(listKeptDirectPayments\(identity, chain\)\)\s+read\(\)\s+return subscribeKeptDirectPayments\(read\)/)
    expect(list).toMatch(/navigator\.clipboard\.writeText\(recoveryDetails\(p, \{ identity, chain \}\)\)/)
  })

  it('the remove-wallet dialog counts them on this device each time it opens', () => {
    const dialog = read('components/RemoveWalletDialog.tsx')
    expect(dialog).toMatch(/if \(open\) \{ setTyped\(''\); setError\(''\); setKept\(keptDirectPaymentsOnDevice\(\)\) \}/)
    expect(dialog).toMatch(/\{keptNote && <Alert severity="info"[^>]*>\{keptNote\}<\/Alert>\}/)
  })
})
