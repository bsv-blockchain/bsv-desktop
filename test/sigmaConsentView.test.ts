/**
 * What the sigma consent dialog says for each kind of request, and how text
 * the requesting application chose is made safe to show.
 */

import { expect, test } from 'vitest'
import { displayAppText, sigmaConsentView } from '../src/lib/permissionModules/sigma/view'
import { SIGMA_KEY_GRANT_MS } from '../src/lib/permissionModules/sigma/module'

const base = { operation: 'or', applicationBase: false, securityLevel: 1, logicalProtocolID: 'spuzzle payout',
  keyID: 'member 1', counterparty: 'self', contextSha256: '0b307ebf' + 'aa'.repeat(28), inputSha256: 'cd'.repeat(32) } as const

test('a proof', () => {
  const v = sigmaConsentView(base)
  expect([v.kind, v.title, v.footer, v.approveLabel]).toEqual(['proof', 'Proof request', 'Approving covers this one proof.', 'Approve once'])
  expect(v.body).toEqual(['This app is asking your wallet to make a proof with one of your keys. A proof can release coins locked to that key. Your wallet cannot see what this proof will be used for.'])
  expect(v.rows).toEqual([
    { label: 'Purpose', value: 'spuzzle payout', fromApp: true }, { label: 'Key', value: 'member 1', fromApp: true },
    { label: 'Proof', value: 'One of a group of keys', fromApp: false }, { label: 'Context', value: '0b307ebf…', fromApp: false },
    { label: 'Request', value: 'cdcdcdcd…', fromApp: false }])
})

test('two proofs with the same context and different requests look different', () => {
  const a = sigmaConsentView(base)
  const b = sigmaConsentView({ ...base, inputSha256: 'ef'.repeat(32) })
  expect(a.rows.find(r => r.label === 'Context')).toEqual(b.rows.find(r => r.label === 'Context'))
  expect(a.rows.find(r => r.label === 'Request')!.value).toBe('cdcdcdcd…')
  expect(b.rows.find(r => r.label === 'Request')!.value).toBe('efefefef…')
})

test.each([['schnorr', 'Knowledge of one key'], ['dleq', 'The same key under two bases'], ['or', 'One of a group of keys']])(
  '%s is named in plain words', (operation, name) => {
    expect(sigmaConsentView({ ...base, operation } as any).rows.find(r => r.label === 'Proof')!.value).toBe(name)
  })

test('the plain public key is remembered and says so', () => {
  const v = sigmaConsentView({ ...base, operation: 'key', contextSha256: undefined })
  expect([v.kind, v.title, v.approveLabel]).toEqual(['publicKey', 'Public key request', 'Approve'])
  expect(v.body).toEqual(['This app is asking for a public key from your wallet. It does not let the app spend anything.'])
  expect(v.footer).toBe('Your wallet will not ask again for public keys for this app and purpose for 30 minutes.')
  expect(v.rows.map(r => r.label)).toEqual(['Purpose', 'Key'])
})

test('the public key footer\'s number of minutes is the remembered period', () => {
  const footer = sigmaConsentView({ ...base, operation: 'key', contextSha256: undefined }).footer
  expect(footer).toContain(` for ${SIGMA_KEY_GRANT_MS / 60000} minutes.`)
  expect(Number(/for (\d+) minutes\.$/.exec(footer)![1])).toBe(SIGMA_KEY_GRANT_MS / 60000)
})

test('a key with a base is a one-time derived key request', () => {
  const v = sigmaConsentView({ ...base, operation: 'key', applicationBase: true, contextSha256: undefined })
  expect([v.kind, v.title, v.footer, v.approveLabel]).toEqual(['derivedKey', 'Derived key request', 'Approving covers this one request.', 'Approve once'])
  expect(v.body).toEqual(['This app is asking for a value made from one of your keys and a point the app chose. It does not let the app spend anything.'])
  expect(v.rows.map(r => r.label)).toEqual(['Purpose', 'Key', 'Request'])
  expect(v.rows.at(-1)).toEqual({ label: 'Request', value: 'cdcdcdcd…', fromApp: false })
})

test('level 2 shows the counterparty', () => {
  const v = sigmaConsentView({ ...base, securityLevel: 2, counterparty: '02' + 'ab'.repeat(32) })
  expect(v.rows[2]).toEqual({ label: 'Counterparty', value: '02' + 'ab'.repeat(32), fromApp: true })
  expect(v.rows.map(r => r.label)).toEqual(['Purpose', 'Key', 'Counterparty', 'Proof', 'Context', 'Request'])
})

test('level 2 with counterparty self shows no counterparty row', () => {
  const v = sigmaConsentView({ ...base, securityLevel: 2 })
  expect(v.rows.map(r => r.label)).toEqual(['Purpose', 'Key', 'Proof', 'Context', 'Request'])
})

test('level 1 shows no counterparty row', () => {
  const v = sigmaConsentView({ ...base, counterparty: '02' + 'ab'.repeat(32) })
  expect(v.rows.map(r => r.label)).not.toContain('Counterparty')
})

test('application text is neutralized and truncated', () => {
  expect(displayAppText('pay\u{202E}out\u{0}\u{200B}\u{2066}x\u{9F}')).toBe('pay\u{FFFD}out\u{FFFD}\u{FFFD}\u{FFFD}x\u{FFFD}')
  expect(displayAppText('a'.repeat(500))).toBe('a'.repeat(120) + '…')
  expect(sigmaConsentView({ ...base, logicalProtocolID: 'Approved by your wallet\u{202E}', keyID: 'k'.repeat(800) }).rows.slice(0, 2))
    .toEqual([{ label: 'Purpose', value: 'Approved by your wallet\u{FFFD}', fromApp: true }, { label: 'Key', value: 'k'.repeat(120) + '…', fromApp: true }])
})

test('every control and format character is replaced', () => {
  const controls = ['\u{1}', '\t', '\n', '\r', '\u{1B}', '\u{7F}', '\u{85}', '\u{80}']
  const formats = ['\u{AD}', '\u{61C}', '\u{200C}', '\u{200D}', '\u{200E}', '\u{200F}', '\u{202A}', '\u{202B}', '\u{202C}', '\u{202D}',
    '\u{2067}', '\u{2068}', '\u{2069}', '\u{FEFF}', '\u{E0001}']
  for (const c of [...controls, ...formats]) expect(displayAppText(`a${c}b`)).toBe('a\u{FFFD}b')
})

test('line and paragraph separators are replaced', () => {
  expect(displayAppText('a\u{2028}b\u{2029}c')).toBe('a\u{FFFD}b\u{FFFD}c')
})

test('the wrapper\'s own double quotation marks and their siblings are replaced', () => {
  for (const q of ['\u{201C}', '\u{201D}', '\u{201E}', '\u{201F}'])
    expect(displayAppText(`a${q}b`)).toBe('a\u{FFFD}b')
  expect(sigmaConsentView({ ...base, keyID: 'member 1\u{201D} — checked by your wallet \u{201C}x' }).rows[1])
    .toEqual({ label: 'Key', value: 'member 1\u{FFFD} — checked by your wallet \u{FFFD}x', fromApp: true })
})

test('a run of more than four combining marks is cut to four', () => {
  expect(displayAppText('e' + '\u{301}'.repeat(6))).toBe('e' + '\u{301}'.repeat(4))
  expect(displayAppText('e' + '\u{301}'.repeat(4))).toBe('e' + '\u{301}'.repeat(4))
  expect(displayAppText('a\u{301}\u{302}\u{303}\u{304}\u{305}b')).toBe('a\u{301}\u{302}\u{303}\u{304}b')
})

test('ordinary text passes through unchanged', () => {
  for (const s of ['ordinary text, it\'s plain', 'Alice\u{2019}s key', 'l\u{2019}\u{E9}t\u{E9}', '\u{AB}cl\u{E9}\u{BB}',
    '\u{2018}single\u{2019}', '\u{2039}one\u{203A}', '\u{915}\u{93C}\u{940}\u{902}',
    'caf\u{E9} and cafe\u{301}', 'na\u{EF}ve r\u{E9}sum\u{E9}', '\u{9375} \u{9375}\u{675F}',
    'key \u{1F511}', 'heart \u{2764}\u{FE0F}', 'a "straight" quote'])
    expect(displayAppText(s)).toBe(s)
})

test('text at the limit is not truncated, and the limit can be set', () => {
  expect(displayAppText('a'.repeat(120))).toBe('a'.repeat(120))
  expect(displayAppText('abcdef', 3)).toBe('abc…')
  expect(displayAppText('')).toBe('')
})

test('truncation counts code points and never splits a surrogate pair', () => {
  const key = '\u{1F511}'
  expect(displayAppText(key.repeat(200))).toBe(key.repeat(120) + '…')
  expect(displayAppText(key.repeat(120))).toBe(key.repeat(120))
  const cut = displayAppText('a'.repeat(119) + key.repeat(5))
  expect(cut).toBe('a'.repeat(119) + key + '…')
  expect(cut.isWellFormed()).toBe(true)
})
