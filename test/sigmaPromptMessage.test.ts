/**
 * The sigma prompt message: what the permission prompt is told about one
 * sigma authorization request, as a versioned JSON string with a fixed key
 * order, and the strict parser the prompt reads it back with.
 */

import { describe, expect, test } from 'vitest'
import { parseSigmaPromptMessage, sigmaPromptMessage } from '../src/lib/permissionModules/sigma/message'

const proof = { originator: 'app.example.com', securityLevel: 1, logicalProtocolID: 'spuzzle payout', keyID: 'member 1',
  counterparty: 'self', privileged: false, operation: 'or', applicationBase: false,
  contextSha256: 'ab'.repeat(32), inputSha256: 'cd'.repeat(32) } as const

const key = { originator: 'app.example.com', securityLevel: 2, logicalProtocolID: 'spuzzle payout', keyID: 'member 1',
  counterparty: 'self', privileged: false, operation: 'key', applicationBase: false,
  inputSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' } as const

test('round-trips a proof request', () => {
  expect(parseSigmaPromptMessage(sigmaPromptMessage(proof))).toEqual({
    operation: 'or', applicationBase: false, securityLevel: 1, logicalProtocolID: 'spuzzle payout', keyID: 'member 1',
    counterparty: 'self', contextSha256: 'ab'.repeat(32), inputSha256: 'cd'.repeat(32) })
})

test('is the same string for the same request, and differs when any shown field differs', () => {
  expect(sigmaPromptMessage(proof)).toBe(sigmaPromptMessage({ ...proof }))
  for (const change of [{ keyID: 'member 2' }, { inputSha256: 'ef'.repeat(32) }, { operation: 'schnorr' }, { securityLevel: 2 }])
    expect(sigmaPromptMessage({ ...proof, ...change } as any)).not.toBe(sigmaPromptMessage(proof))
})

test.each(['', 'not json', '[]', '{"v":2}', JSON.stringify({ v: 1, operation: 'sign' }),
  sigmaPromptMessage(proof).replace('"or"', '"xor"'), sigmaPromptMessage(proof).replace('ab'.repeat(32), 'zz')])(
  'rejects %j', (m) => { expect(parseSigmaPromptMessage(m)).toBeUndefined() })

describe('message shape', () => {
  test('has the version first and the fields in a fixed order', () => {
    expect(sigmaPromptMessage(proof)).toBe(
      '{"v":1,"operation":"or","applicationBase":false,"securityLevel":1,"logicalProtocolID":"spuzzle payout",' +
      `"keyID":"member 1","counterparty":"self","contextSha256":"${'ab'.repeat(32)}","inputSha256":"${'cd'.repeat(32)}"}`)
  })

  test('omits contextSha256 for a key request and round-trips without it', () => {
    const message = sigmaPromptMessage(key)
    expect(message).not.toContain('contextSha256')
    const parsed = parseSigmaPromptMessage(message)
    expect(parsed).toEqual({
      operation: 'key', applicationBase: false, securityLevel: 2, logicalProtocolID: 'spuzzle payout', keyID: 'member 1',
      counterparty: 'self', inputSha256: key.inputSha256 })
    expect(parsed).not.toHaveProperty('contextSha256')
  })

  test('carries no originator and no privileged fields', () => {
    const message = sigmaPromptMessage({ ...proof, privileged: true, privilegedReason: 'testing privileged' } as any)
    expect(message).not.toContain('originator')
    expect(message).not.toContain('privileged')
  })
})

describe('parse rejects', () => {
  const fields = () => JSON.parse(sigmaPromptMessage(proof)) as Record<string, unknown>
  const without = (k: string) => { const f = fields(); delete f[k]; return JSON.stringify(f) }
  const withField = (k: string, v: unknown) => JSON.stringify({ ...fields(), [k]: v })

  test.each([
    ['security level 0', withField('securityLevel', 0)],
    ['security level 3', withField('securityLevel', 3)],
    ['security level as a string', withField('securityLevel', '1')],
    ['uppercase input hash', withField('inputSha256', 'CD'.repeat(32))],
    ['a short input hash', withField('inputSha256', 'cd'.repeat(31))],
    ['a long context hash', withField('contextSha256', 'ab'.repeat(33))],
    ['a missing context hash on a proof', without('contextSha256')],
    ['a context hash on a key request', JSON.stringify({ ...JSON.parse(sigmaPromptMessage(key)), contextSha256: 'ab'.repeat(32) })],
    ['a missing input hash', without('inputSha256')],
    ['a missing key ID', without('keyID')],
    ['an empty key ID', withField('keyID', '')],
    ['an empty protocol', withField('logicalProtocolID', '')],
    ['a non-boolean applicationBase', withField('applicationBase', 'false')],
    ['an unknown counterparty', withField('counterparty', 'someone')],
    ['an uncompressed counterparty key', withField('counterparty', '04' + 'ab'.repeat(64))],
    ['an uppercase counterparty key', withField('counterparty', '02' + 'AB'.repeat(32))],
    ['an extra field', withField('privileged', false)],
    ['version as a string', withField('v', '1')],
    ['null', 'null'],
    ['a number', '1']
  ])('%s', (_name, m) => { expect(parseSigmaPromptMessage(m)).toBeUndefined() })

  test('accepts anyone and a compressed public key as counterparty', () => {
    expect(parseSigmaPromptMessage(withField('counterparty', 'anyone'))?.counterparty).toBe('anyone')
    const pub = '03' + 'ab'.repeat(32)
    expect(parseSigmaPromptMessage(withField('counterparty', pub))?.counterparty).toBe(pub)
  })

  test('never throws, whatever it is given', () => {
    for (const m of [undefined, null, 1, {}, [], Symbol('x'), '{"__proto__":{"v":1}}'] as any[])
      expect(() => parseSigmaPromptMessage(m)).not.toThrow()
  })
})

describe('parse accepts only the canonical form', () => {
  const message = sigmaPromptMessage(proof)

  test('a duplicated key is rejected', () => {
    const duplicated = message.replace('"keyID":"member 1"', '"keyID":"member 0","keyID":"member 1"')
    expect(JSON.parse(duplicated).keyID).toBe('member 1')
    expect(parseSigmaPromptMessage(duplicated)).toBeUndefined()
  })

  test('reordered keys are rejected', () => {
    const { keyID, logicalProtocolID, ...rest } = JSON.parse(message)
    const reordered = JSON.stringify({ ...rest, keyID, logicalProtocolID })
    expect(JSON.parse(reordered)).toEqual(JSON.parse(message))
    expect(parseSigmaPromptMessage(reordered)).toBeUndefined()
  })

  test('extra whitespace is rejected', () => {
    for (const spaced of [message.replace(',"keyID"', ', "keyID"'), JSON.stringify(JSON.parse(message), null, 2), ` ${message}`, `${message}\n`])
      expect(parseSigmaPromptMessage(spaced)).toBeUndefined()
  })
})

describe('applicationBase is tied to the operation', () => {
  test.each([
    ['or with a base', { operation: 'or', applicationBase: true }],
    ['schnorr with a base', { operation: 'schnorr', applicationBase: true }],
    ['dleq without a base', { operation: 'dleq', applicationBase: false }]
  ])('%s is rejected', (_name, change) => {
    expect(parseSigmaPromptMessage(sigmaPromptMessage({ ...proof, ...change } as any))).toBeUndefined()
  })

  test.each([
    ['or without a base', proof],
    ['schnorr without a base', { ...proof, operation: 'schnorr' }],
    ['dleq with a base', { ...proof, operation: 'dleq', applicationBase: true }],
    ['key without a base', key],
    ['key with a base', { ...key, applicationBase: true }]
  ])('%s is accepted', (_name, request) => {
    expect(parseSigmaPromptMessage(sigmaPromptMessage(request as any))).toBeDefined()
  })
})
