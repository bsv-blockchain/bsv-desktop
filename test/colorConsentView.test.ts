/**
 * Consent view model and exact amount formatting for the color module
 * (0207:955-962, 0207 A.38, 0162:139-143, 0162:246-252).
 *
 * Cases pinned here:
 * - exactness at the uint64 edge and beyond: the A.38 maximum at dec 18 reads
 *   digit-exact, sums above 2^64 are never capped or rounded;
 * - fail closed: a non-canonical amount (`"01"`, `"1e3"`, `"-1"`, `""`, a JSON
 *   number) or a per-output amount above 2^64-1 refuses the view instead of
 *   rendering a wrong figure;
 * - untrusted display metadata never hides the full asset id, and a malformed
 *   display entry falls back to exact base units;
 * - every leg (value, authority, deploy, sats, released signatures) reaches
 *   the view;
 * - the source never turns a token amount into a float.
 */

import fs from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  InvalidColorRequestError,
  buildColorConsentView,
  formatTokenAmount,
  formatUnits,
  type AssetDisplay
} from '../src/lib/permissionModules/color/consentView'

const ID = 'a'.repeat(64) + '_0'
const ID2 = 'b'.repeat(64) + '_7'
const K1 = '02' + 'ab'.repeat(32)
const K2 = '03' + '2'.repeat(64)
const OUTPOINT = `${'c'.repeat(64)}.1`
const DISPLAY: AssetDisplay = { assetId: ID, sym: 'TUSD', label: 'Test Dollar', dec: 2, mandala: true }

const asset = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  assetId: ID,
  operations: ['transfer'],
  inputAmount: '2000',
  foreignAmount: '0',
  authorityInputs: 0,
  foreignAuthorityInputs: 0,
  keptAmount: '500',
  keptAuthorities: 0,
  outgoingAmount: '1500',
  outgoingAuthorities: 0,
  transferred: '2000',
  burned: '0',
  minted: '0',
  ...o
})

const destination = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  outputIndex: 0, satoshis: 1, lockingScript: '00', assetId: ID, role: 'value', amount: '1500', ...o
})

const sendMessage = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'color_send',
  handoff: true,
  seekPermission: true,
  assets: [asset()],
  destinations: [destination()],
  satoshis: { inputs: 1003, outputs: 2, fee: 1001 },
  signatures: [{ outpoint: OUTPOINT, inputIndex: 0, sighashType: 65 }],
  lockTime: 0,
  hostDisplay: { [ID]: DISPLAY },
  ...o
})

const sendWith = (o: Record<string, unknown>): string => JSON.stringify(sendMessage({ assets: [asset(o)] }))
const sendWithDestinationAmount = (amount: unknown): string =>
  JSON.stringify(sendMessage({ destinations: [destination({ amount })] }))

const offline = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'color_receive_offline',
  assetId: ID,
  outputs: [{ outputIndex: 0, amount: '1500' }, { outputIndex: 2, amount: '18446744073709551615' }],
  unsettledTransactions: 2,
  signer: K1,
  profiles: ['https://brc.dev/207/attested'],
  seekPermission: true,
  ...o
})

describe('formatUnits / formatTokenAmount', () => {
  test('renders the A.38 maximum exactly', () => {
    expect(formatUnits(18446744073709551615n, 18)).toBe('18.446744073709551615') // 0207:3938
    expect(formatUnits(1500n, 2)).toBe('15.00')
    expect(formatUnits(5n, 2)).toBe('0.05')
    expect(formatUnits(0n, 3)).toBe('0.000')
    expect(formatUnits(1500n, 0)).toBe('1500')
    expect(formatUnits(1n, 18)).toBe('0.000000000000000001')
    expect(formatUnits(36893488147419103232n, 0)).toBe('36893488147419103232') // sums are never capped
    expect(formatUnits(36893488147419103232n, 18)).toBe('36.893488147419103232')
    expect(() => formatUnits(-1n, 0)).toThrow(RangeError)
    expect(() => formatUnits(1n, 19)).toThrow(RangeError)
    expect(() => formatUnits(1n, -1)).toThrow(RangeError)
    expect(() => formatUnits(1n, 1.5)).toThrow(RangeError)
    expect(() => formatUnits(1 as unknown as bigint, 0)).toThrow(RangeError)
  })

  test('formatTokenAmount uses dec and sym, else base units', () => {
    expect(formatTokenAmount('1500', DISPLAY)).toBe('15.00 TUSD')
    expect(formatTokenAmount('1500', { assetId: ID, dec: 2, mandala: false })).toBe('15.00')
    expect(formatTokenAmount('1500')).toBe('1500 base units')
    expect(formatTokenAmount('18446744073709551615', { assetId: ID, sym: 'G', dec: 18, mandala: false }))
      .toBe('18.446744073709551615 G')
  })

  test('formatTokenAmount refuses strings BigInt would silently accept', () => {
    for (const bad of ['', ' 1', '0x10', '01', '1e3', '-1', '1.5']) {
      expect(() => formatTokenAmount(bad)).toThrow(RangeError)
      expect(() => formatTokenAmount(bad, DISPLAY)).toThrow(RangeError)
    }
    expect(() => formatTokenAmount(1500 as unknown as string)).toThrow(RangeError)
  })
})

describe('buildColorConsentView', () => {
  test('send view shows every leg with exact decimals and sats', () => {
    const v = buildColorConsentView(JSON.stringify(sendMessage()))
    expect(v.type).toBe('color_send')
    expect(v.title).toBe('Approve token hand-over')
    expect(v.handoff).toBe(true)
    expect(v.assets[0].lines).toEqual([
      { label: 'Sending', amount: '15.00 TUSD' },
      { label: 'From this wallet', amount: '20.00 TUSD' },
      { label: 'Kept as change', amount: '5.00 TUSD' }
    ])
    expect(v.assets[0].name).toBe(`Test Dollar (${ID})`)
    expect(v.assets[0].assetId).toBe(ID)
    expect(v.assets[0].operations).toEqual(['transfer'])
    expect(v.assets[0].authorities).toEqual([])
    expect(v.destinations).toEqual([{ outputIndex: 0, satoshis: 1, token: { assetId: ID, role: 'value', amount: '15.00 TUSD' } }])
    expect(v.satoshis).toEqual({ inputs: 1003, outputs: 2, fee: 1001 })
    expect(v.signatures).toEqual([{ outpoint: OUTPOINT, inputIndex: 0, sighashType: 65 }])
    expect(v.lockTime).toBe(0)
  })

  test('a send without handoff is a plain token transaction', () => {
    expect(buildColorConsentView(JSON.stringify(sendMessage({ handoff: false }))).title).toBe('Approve token transaction')
    const { handoff: _h, ...noHandoff } = sendMessage()
    const v = buildColorConsentView(JSON.stringify(noHandoff))
    expect(v.title).toBe('Approve token transaction')
    expect(v.handoff).toBe(false)
    expect(() => buildColorConsentView(JSON.stringify(sendMessage({ handoff: 'yes' })))).toThrow(InvalidColorRequestError)
  })

  test('without display metadata amounts are base units', () => {
    const v = buildColorConsentView(JSON.stringify(sendMessage({ hostDisplay: undefined })))
    expect(v.assets[0].lines[0]).toEqual({ label: 'Sending', amount: '1500 base units' })
    expect(v.assets[0].name).toBe(ID)
    expect(v.destinations[0].token?.amount).toBe('1500 base units')
  })

  test('the A.38 maximum and an over-2^64 sum render digit-exact', () => {
    const v = buildColorConsentView(JSON.stringify(sendMessage({
      assets: [asset({ inputAmount: '36893488147419103230', keptAmount: '18446744073709551615', outgoingAmount: '18446744073709551615', transferred: '36893488147419103230' })],
      destinations: [destination({ amount: '18446744073709551615' })],
      hostDisplay: { [ID]: { assetId: ID, sym: 'G', dec: 18, mandala: false } }
    })))
    expect(v.assets[0].lines).toEqual([
      { label: 'Sending', amount: '18.446744073709551615 G' },
      { label: 'From this wallet', amount: '36.893488147419103230 G' },
      { label: 'Kept as change', amount: '18.446744073709551615 G' }
    ])
    expect(v.destinations[0].token?.amount).toBe('18.446744073709551615 G')
  })

  test('Sending is always shown; other zero lines are hidden; burned/minted/foreign appear when non-zero', () => {
    const v = buildColorConsentView(sendWith({
      inputAmount: '0', foreignAmount: '7', keptAmount: '0', outgoingAmount: '0', burned: '3', minted: '9'
    }))
    expect(v.assets[0].lines).toEqual([
      { label: 'Sending', amount: '0.00 TUSD' },
      { label: 'From others', amount: '0.07 TUSD' },
      { label: 'Burned', amount: '0.03 TUSD' },
      { label: 'Minted', amount: '0.09 TUSD' }
    ])
  })

  test('authority movements are shown when non-zero (0207:960 authority delegation needs clear consent)', () => {
    const v = buildColorConsentView(sendWith({ authorityInputs: 1, foreignAuthorityInputs: 2, keptAuthorities: 1, outgoingAuthorities: 2 }))
    expect(v.assets[0].authorities).toEqual([
      { label: 'Authorities sending', count: 2 },
      { label: 'Authorities from this wallet', count: 1 },
      { label: 'Authorities from others', count: 2 },
      { label: 'Authorities kept', count: 1 }
    ])
    for (const bad of [-1, 1.5, '1', undefined]) {
      expect(() => buildColorConsentView(sendWith({ outgoingAuthorities: bad }))).toThrow(InvalidColorRequestError)
    }
  })

  test('rejects non-canonical amounts', () => {
    for (const bad of ['01', '1e3', '-1', '', 1500, ' 1', '0x10', null]) {
      expect(() => buildColorConsentView(sendWith({ outgoingAmount: bad }))).toThrow(InvalidColorRequestError)
    }
    for (const field of ['inputAmount', 'foreignAmount', 'keptAmount', 'transferred', 'burned', 'minted']) {
      expect(() => buildColorConsentView(sendWith({ [field]: '01' }))).toThrow(InvalidColorRequestError)
    }
    expect(() => buildColorConsentView(sendWithDestinationAmount('18446744073709551616'))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(sendWithDestinationAmount(1500))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(sendWithDestinationAmount('01'))).toThrow(InvalidColorRequestError)
    // Sums are unbounded: an above-2^64 leg sum is valid.
    expect(() => buildColorConsentView(sendWith({ inputAmount: '18446744073709551616' }))).not.toThrow()
  })

  test('the error names the offending field', () => {
    expect(() => buildColorConsentView(sendWith({ outgoingAmount: '01' }))).toThrow(/assets\[0\]\.outgoingAmount/)
    expect(() => buildColorConsentView(sendWithDestinationAmount('18446744073709551616'))).toThrow(/destinations\[0\]\.amount/)
    try {
      buildColorConsentView('not json')
    } catch (e) {
      expect((e as Error).name).toBe('InvalidColorRequestError')
    }
  })

  test('asset ids, outpoints, sats and counts are validated', () => {
    const bad = (o: Record<string, unknown>): void => {
      expect(() => buildColorConsentView(JSON.stringify(sendMessage(o)))).toThrow(InvalidColorRequestError)
    }
    bad({ assets: [asset({ assetId: 'A'.repeat(64) + '_0' })] })
    bad({ assets: [asset({ assetId: 'a'.repeat(64) + '_01' })] })
    bad({ assets: [asset({ assetId: 'ISSUE' })] })
    bad({ assets: [asset({ operations: 'transfer' })] })
    bad({ assets: Array.from({ length: 65 }, () => asset()) })
    bad({ assets: 'x' })
    bad({ destinations: [destination({ assetId: 'nope' })] })
    bad({ destinations: [destination({ role: 'owner' })] })
    bad({ destinations: [destination({ amount: undefined })] })
    bad({ destinations: [destination({ outputIndex: -1 })] })
    bad({ destinations: [destination({ satoshis: 1.5 })] })
    bad({ destinations: [destination({ satoshis: 2 ** 53 })] })
    bad({ destinations: Array.from({ length: 1001 }, (_, i) => destination({ outputIndex: i })) })
    bad({ satoshis: { inputs: 1, outputs: 2, fee: -1 } })
    bad({ satoshis: { inputs: 1003, outputs: 2, fee: 1000 } })
    bad({ satoshis: { inputs: '1003', outputs: 2, fee: 1001 } })
    bad({ satoshis: undefined })
    bad({ signatures: [{ outpoint: `${'c'.repeat(64)}_1`, inputIndex: 0, sighashType: 65 }] })
    bad({ signatures: [{ outpoint: OUTPOINT, inputIndex: 0, sighashType: 256 }] })
    bad({ signatures: undefined })
    bad({ lockTime: -1 })
    bad({ lockTime: 2 ** 32 })
    // Up to the limits is fine; ISSUE and plain sat outputs are valid destinations.
    expect(() => buildColorConsentView(JSON.stringify(sendMessage({
      assets: Array.from({ length: 64 }, () => asset()),
      destinations: Array.from({ length: 1000 }, (_, i) => destination({ outputIndex: i }))
    })))).not.toThrow()
    const v = buildColorConsentView(JSON.stringify(sendMessage({
      destinations: [
        destination({ assetId: 'ISSUE', role: 'value', amount: '21000000' }),
        { outputIndex: 1, satoshis: 900, lockingScript: '76a9' }
      ]
    })))
    expect(v.destinations).toEqual([
      { outputIndex: 0, satoshis: 1, token: { assetId: 'ISSUE', role: 'value', amount: '21000000 base units' } },
      { outputIndex: 1, satoshis: 900 }
    ])
  })

  test('a deploy leg is presented', () => {
    const v = buildColorConsentView(JSON.stringify(sendMessage({
      handoff: false, deploy: { operation: 'deploy-fixed', amount: '18446744073709551615', owned: true }
    })))
    expect(v.deploy).toEqual({ operation: 'deploy-fixed', amount: '18446744073709551615 base units', owned: true })
    expect(() => buildColorConsentView(JSON.stringify(sendMessage({ deploy: { operation: 'deploy-fixed', amount: '18446744073709551616', owned: true } }))))
      .toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(sendMessage({ deploy: { operation: 'deploy-fixed', amount: '1', owned: 'yes' } }))))
      .toThrow(InvalidColorRequestError)
  })

  test('untrusted display metadata never hides the asset id; malformed entries fall back to base units', () => {
    const named = (d: unknown): string => buildColorConsentView(JSON.stringify(sendMessage({ hostDisplay: { [ID]: d } }))).assets[0].name
    expect(named({ assetId: ID, sym: 'TUSD', dec: 2, mandala: true })).toBe(`TUSD (${ID})`)
    expect(named({ assetId: ID, dec: 2, mandala: true })).toBe(ID)
    const lineFor = (d: unknown): string => buildColorConsentView(JSON.stringify(sendMessage({ hostDisplay: { [ID]: d } }))).assets[0].lines[0].amount
    expect(lineFor({ assetId: ID, sym: 'TUSD', dec: 19, mandala: true })).toBe('1500 base units')
    expect(lineFor({ assetId: ID, sym: 'TUSD', dec: 1.5, mandala: true })).toBe('1500 base units')
    expect(lineFor({ assetId: ID, sym: 'TUSD', dec: '2', mandala: true })).toBe('1500 base units')
    expect(lineFor({ assetId: ID2, sym: 'TUSD', dec: 2, mandala: true })).toBe('1500 base units')
    expect(lineFor('junk')).toBe('1500 base units')
    // An inherited key is never a display entry.
    expect(buildColorConsentView(JSON.stringify(sendMessage({ hostDisplay: {} }))).assets[0].name).toBe(ID)
  })

  test('access, relinquish, signature and receive-offline views', () => {
    const access = buildColorConsentView(JSON.stringify({ type: 'color_access', basket: 'p color assets', seekPermission: true }))
    expect(access.title).toBe('Share token holdings')
    expect(access.access).toEqual({ basket: 'p color assets' })
    expect(access.handoff).toBe(false)
    const balance = buildColorConsentView(JSON.stringify({ type: 'color_access', basket: `p color balance ${'a'.repeat(64)}v0`, assetId: ID, role: 'value', seekPermission: false }))
    expect(balance.access).toEqual({ basket: `p color balance ${'a'.repeat(64)}v0`, assetId: ID, role: 'value' })
    const labels = buildColorConsentView(JSON.stringify({ type: 'color_access', labels: [], seekPermission: true }))
    expect(labels.access).toEqual({ labels: [] })
    expect(() => buildColorConsentView(JSON.stringify({ type: 'color_access', basket: 7 }))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify({ type: 'color_access', labels: [1] }))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify({ type: 'color_access', assetId: 'x' }))).toThrow(InvalidColorRequestError)

    const relinquish = buildColorConsentView(JSON.stringify({ type: 'color_relinquish', assetId: ID, role: 'authority', outpoint: OUTPOINT }))
    expect(relinquish.title).toBe('Remove a token holding')
    expect(relinquish.relinquish).toEqual({ assetId: ID, role: 'authority', outpoint: OUTPOINT })
    expect(() => buildColorConsentView(JSON.stringify({ type: 'color_relinquish', assetId: ID, role: 'value', outpoint: `${'c'.repeat(64)}_1` }))).toThrow(InvalidColorRequestError)

    const { handoff: _h, ...sig } = sendMessage({ type: 'color_signature', inputIndex: 0 })
    const signature = buildColorConsentView(JSON.stringify(sig))
    expect(signature.title).toBe('Approve token signature')
    expect(signature.handoff).toBe(false)
    expect(signature.signatures).toHaveLength(1)
    expect(() => buildColorConsentView(JSON.stringify({ ...sig, inputIndex: -1 }))).toThrow(InvalidColorRequestError)

    const off = buildColorConsentView(JSON.stringify({ ...offline(), hostDisplay: { [ID]: { assetId: ID, sym: 'G', dec: 18, mandala: true } } }))
    expect(off.title).toBe('Accept tokens offline (pending settlement)')
    expect(off.offline).toEqual({
      assetId: ID,
      outputs: [{ outputIndex: 0, amount: '0.000000000000001500 G' }, { outputIndex: 2, amount: '18.446744073709551615 G' }],
      unsettledTransactions: 2,
      signers: [K1],
      profiles: ['https://brc.dev/207/attested']
    })
    expect(buildColorConsentView(JSON.stringify(offline())).offline?.outputs[0].amount).toBe('1500 base units')
    const { signer: _s, ...anyMode } = offline()
    expect(buildColorConsentView(JSON.stringify({ ...anyMode, signers: [K1, K2] })).offline?.signers).toEqual([K1, K2])
    // Both, neither, an empty list or a malformed key is refused.
    expect(() => buildColorConsentView(JSON.stringify({ ...offline(), signers: [K2] }))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(anyMode))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify({ ...anyMode, signers: [] }))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify({ ...anyMode, signers: [K1, 'x'] }))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(offline({ signer: '04' + '1'.repeat(64) })))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(offline({ signer: K1.toUpperCase() })))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(offline({ outputs: [{ outputIndex: 0, amount: '18446744073709551616' }] })))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(offline({ outputs: [{ outputIndex: 0, amount: 1500 }] })))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(offline({ unsettledTransactions: -1 })))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(offline({ profiles: [1] })))).toThrow(InvalidColorRequestError)
    expect(() => buildColorConsentView(JSON.stringify(offline({ assetId: 'ISSUE' })))).toThrow(InvalidColorRequestError)
  })

  test('unknown types and malformed messages are refused', () => {
    for (const bad of ['not json', '[]', 'null', '7', JSON.stringify({ type: 'mandala_access' }), JSON.stringify({})]) {
      expect(() => buildColorConsentView(bad)).toThrow(InvalidColorRequestError)
    }
  })

  test('consentView.ts never converts token amounts with Number()', () => {
    expect(fs.readFileSync('src/lib/permissionModules/color/consentView.ts', 'utf8')).not.toMatch(/Number\(|parseInt\(|parseFloat\(/)
  })
})
