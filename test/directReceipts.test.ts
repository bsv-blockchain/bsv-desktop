/**
 * What the user is told about a received direct payment that the wallet has not added yet:
 * its line in the Payments page's kept list, the recovery details that can add it by hand, and
 * the note in the remove-wallet dialog (final review D1, D4; Ruling 36).
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { Utils } from '@bsv/sdk'
import { keptPaymentsRemovalNote, keptStatusText, recoveryDetails } from '../src/lib/pages/Dashboard/Payments/directReceipts'
import type { KeptDirectPaymentInfo } from '../src/lib/pages/Dashboard/Payments/directPayments'

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
