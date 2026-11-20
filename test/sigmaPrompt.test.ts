/**
 * The sigma consent dialog: what it renders, how a prompt message reaches it,
 * and the permission module definition it belongs to.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { sigmaConsentView } from '../src/lib/permissionModules/sigma/view'
import { parseSigmaPromptMessage, sigmaPromptMessage } from '../src/lib/permissionModules/sigma/message'
import { SigmaConsentDetails, SigmaPermissionPrompt, handleSigmaPromptMessage } from '../src/lib/permissionModules/sigma/Prompt'
import { sigmaPermissionModule } from '../src/lib/permissionModules/sigma'
import { createHostSigmaModule, disposeHostSigmaModule } from '../src/lib/permissionModules/sigma/module'

const base = { operation: 'or', applicationBase: false, securityLevel: 1, logicalProtocolID: 'spuzzle payout',
  keyID: 'member 1', counterparty: 'self', contextSha256: '0b307ebf' + 'aa'.repeat(28), inputSha256: 'cd'.repeat(32) } as const

const proofRequest = { originator: 'app.example.com', securityLevel: 1, logicalProtocolID: 'spuzzle payout', keyID: 'member 1',
  counterparty: 'self', privileged: false, operation: 'or', applicationBase: false,
  contextSha256: 'ab'.repeat(32), inputSha256: 'cd'.repeat(32) } as const

const idleProps = {
  id: 'sigma',
  paletteMode: 'light' as const,
  isFocused: async () => true,
  onFocusRequested: async () => {},
  onFocusRelinquished: async () => {},
  onRegister: () => {}
}

test('renders the details with application text quoted and apart', () => {
  const html = renderToStaticMarkup(createElement(SigmaConsentDetails, { view: sigmaConsentView(base) }))
  for (const s of ['A proof can release coins locked to that key.', '“spuzzle payout”', '“member 1”', 'One of a group of keys',
    'Context', '0b307ebf…', 'Request', 'cdcdcdcd…', 'Approving covers this one proof.'])
    expect(html).toContain(s)
  expect(html).not.toContain('“One of a group of keys”')
  expect(html).not.toContain('“0b307ebf…”')
  expect(html).not.toContain('“cdcdcdcd…”')
})

test('application text is shown in a monospace face', () => {
  const html = renderToStaticMarkup(createElement(SigmaConsentDetails, { view: sigmaConsentView(base) }))
  expect(html).toContain('font-family:monospace')
})

test('application text that tries to read as the wallet stays quoted and neutralized', () => {
  const html = renderToStaticMarkup(createElement(SigmaConsentDetails, {
    view: sigmaConsentView({ ...base, logicalProtocolID: 'Approved by your wallet\u{202E}' })
  }))
  expect(html).toContain('“Approved by your wallet\u{FFFD}”')
  expect(html).not.toContain('\u{202E}')
})

test('application text cannot close the quotes around it', () => {
  const html = renderToStaticMarkup(createElement(SigmaConsentDetails, {
    view: sigmaConsentView({ ...base, keyID: 'member 1\u{201D} — checked by your wallet \u{201C}x' })
  }))
  expect(html).toContain('“member 1\u{FFFD} — checked by your wallet \u{FFFD}x”')
  expect(html).not.toContain('member 1\u{201D}')
})

test('a value cell clips what it cannot fit', () => {
  const html = renderToStaticMarkup(createElement(SigmaConsentDetails, { view: sigmaConsentView(base) }))
  expect(html).toContain('overflow:hidden')
})

test('the description carries the dialog\'s own id', () => {
  const html = renderToStaticMarkup(createElement(SigmaConsentDetails, { view: sigmaConsentView(base) }))
  expect(html).toContain('id="sigma-permission-description"')
  expect(html).not.toContain('color-permission')
})

test('a well-formed message is enqueued as its view and returns the answer', async () => {
  const enqueue = vi.fn(async () => true)
  expect(await handleSigmaPromptMessage(sigmaPromptMessage(proofRequest), enqueue)).toBe(true)
  expect(enqueue).toHaveBeenCalledWith(sigmaConsentView(parseSigmaPromptMessage(sigmaPromptMessage(proofRequest))!))
})

test('a malformed message is denied without showing anything', async () => {
  const enqueue = vi.fn(async () => true)
  expect(await handleSigmaPromptMessage('{"v":1}', enqueue)).toBe(false)
  expect(enqueue).not.toHaveBeenCalled()
})

test('a denial, a non-boolean answer or a failing queue is a denial', async () => {
  const message = sigmaPromptMessage(proofRequest)
  expect(await handleSigmaPromptMessage(message, async () => false)).toBe(false)
  expect(await handleSigmaPromptMessage(message, async () => 'yes' as any)).toBe(false)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await handleSigmaPromptMessage(message, async () => { throw new Error('queue failed') })).toBe(false)
  expect(error).toHaveBeenCalledOnce()
  error.mockRestore()
})

test('renders nothing while idle', () => {
  expect(renderToStaticMarkup(createElement(SigmaPermissionPrompt, idleProps))).toBe('')
})

test('the definition is complete', () => {
  expect(sigmaPermissionModule).toMatchObject({ id: 'sigma', label: 'Sigma Proof Module', enabledByDefault: true, needsKeyDeriver: true })
  expect(sigmaPermissionModule.createModule).toBe(createHostSigmaModule)
  expect(sigmaPermissionModule.dispose).toBe(disposeHostSigmaModule)
  expect(sigmaPermissionModule.Prompt).toBe(SigmaPermissionPrompt)
  expect(typeof sigmaPermissionModule.Prompt).toBe('function')
})
