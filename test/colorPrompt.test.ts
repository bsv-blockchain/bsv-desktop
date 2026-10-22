/**
 * Color consent prompt UI (Task 8): what the user sees before approving a
 * color module consent message, and the decline path for a message the view
 * cannot present faithfully.
 *
 * Cases pinned here:
 * - exact decimals at the uint64 edge (0207 A.38): the A.38 maximum at dec 18
 *   renders digit-exact next to the full asset id, the fee, and every outpoint
 *   whose signature the approval releases;
 * - nothing an approval moves is hidden: authority counts, the deploy, token
 *   destinations, the lock time;
 * - offline receive shows the pending-settlement notice and every acceptable
 *   signer key (identity mode `signer`, and `signers[]`);
 * - fail closed: an invalid message is declined (false) without a dialog and
 *   logs one warning; an enqueue failure or a non-boolean answer is a decline;
 * - double-submit: the handler answers `true` only for an explicit boolean
 *   approval.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildColorConsentView, type ColorConsentView } from '../src/lib/permissionModules/color/consentView'
import { ColorConsentDetails, ColorPermissionPrompt, handleColorPromptMessage } from '../src/lib/permissionModules/color/Prompt'

const ID = 'a'.repeat(64) + '_0'
const ID2 = 'b'.repeat(64) + '_7'
const K1 = '02' + 'ab'.repeat(32)
const K2 = '03' + '2'.repeat(64)
const OUTPOINT = `${'c'.repeat(64)}.1`
const OUTPOINT2 = `${'d'.repeat(64)}.4`
const MAX = '18446744073709551615'

const send = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'color_send',
  handoff: false,
  seekPermission: true,
  assets: [{
    assetId: ID,
    operations: ['transfer'],
    inputAmount: MAX,
    foreignAmount: '0',
    authorityInputs: 0,
    foreignAuthorityInputs: 0,
    keptAmount: '0',
    keptAuthorities: 0,
    outgoingAmount: MAX,
    outgoingAuthorities: 0,
    transferred: MAX,
    burned: '0',
    minted: '0'
  }],
  destinations: [{ outputIndex: 0, satoshis: 1, lockingScript: '00', assetId: ID, role: 'value', amount: MAX }],
  satoshis: { inputs: 1003, outputs: 2, fee: 1001 },
  signatures: [{ outpoint: OUTPOINT, inputIndex: 0, sighashType: 65 }],
  lockTime: 0,
  hostDisplay: { [ID]: { assetId: ID, sym: 'G', dec: 18, mandala: false } },
  ...o
})

const SEND_MSG_WITH_DISPLAY_DEC18_MAX = JSON.stringify(send())

const offline = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'color_receive_offline',
  assetId: ID,
  outputs: [{ outputIndex: 0, amount: '1500' }],
  unsettledTransactions: 2,
  signer: K1,
  profiles: ['https://brc.dev/207/attested'],
  seekPermission: true,
  ...o
})

const render = (message: Record<string, unknown> | string): string =>
  renderToStaticMarkup(createElement(ColorConsentDetails, {
    view: buildColorConsentView(typeof message === 'string' ? message : JSON.stringify(message))
  }))

afterEach(() => { vi.restoreAllMocks() })

describe('ColorConsentDetails', () => {
  test('details render exact decimal legs, fee and released signatures', () => {
    const html = renderToStaticMarkup(createElement(ColorConsentDetails, { view: buildColorConsentView(SEND_MSG_WITH_DISPLAY_DEC18_MAX) }))
    expect(html).toContain('18.446744073709551615 G')
    expect(html).toContain(ID)
    expect(html).toContain('1001')
    expect(html).toContain(OUTPOINT)
    expect(html).toContain('Sending')
    expect(html).toContain('transfer')
  })

  test('every leg an approval moves is visible', () => {
    const html = render(send({
      handoff: true,
      assets: [
        (send().assets as Array<Record<string, unknown>>)[0],
        {
          assetId: ID2,
          operations: ['transfer', 'burn'],
          inputAmount: '10',
          foreignAmount: '3',
          authorityInputs: 1,
          foreignAuthorityInputs: 0,
          keptAmount: '0',
          keptAuthorities: 0,
          outgoingAmount: '0',
          outgoingAuthorities: 2,
          transferred: '13',
          burned: '13',
          minted: '0'
        }
      ],
      deploy: { operation: 'deploy+mint', amount: '777', owned: true },
      destinations: [
        { outputIndex: 0, satoshis: 1, lockingScript: '00', assetId: ID, role: 'value', amount: MAX },
        { outputIndex: 1, satoshis: 1, lockingScript: '00', assetId: ID2, role: 'authority', amount: '0' },
        { outputIndex: 2, satoshis: 999, lockingScript: '00' }
      ],
      satoshis: { inputs: 2003, outputs: 1001, fee: 1002 },
      signatures: [{ outpoint: OUTPOINT, inputIndex: 0, sighashType: 65 }, { outpoint: OUTPOINT2, inputIndex: 1, sighashType: 193 }],
      lockTime: 900000
    }))
    // the dialog title (Task 7 view) names the hand-over; the body says what it means
    expect(html).toContain('hands it to the recipient')
    // second asset: no display, so exact base units and the bare id
    expect(html).toContain(ID2)
    expect(html).toContain('From others')
    expect(html).toContain('3 base units')
    expect(html).toContain('Burned')
    expect(html).toContain('13 base units')
    expect(html).toContain('burn')
    // authority moves
    expect(html).toContain('Authorities sending')
    expect(html).toContain('Authorities from this wallet')
    // deploy
    expect(html).toContain('deploy+mint')
    expect(html).toContain('777 base units')
    // destinations, sats, both released signatures, lock time
    expect(html).toContain('999')
    expect(html).toContain('2003')
    expect(html).toContain('1002')
    expect(html).toContain(OUTPOINT)
    expect(html).toContain(OUTPOINT2)
    expect(html).toContain('900000')
  })

  test('a plain send carries no hand-over note and a zero lock time is not shown', () => {
    expect(render(send())).not.toContain('hands it to the recipient')
    expect(render(send())).not.toContain('Lock time')
    expect(render(send({ lockTime: 5 }))).toContain('Lock time')
  })

  test('offline receive shows the pending notice', () => {
    const one = render({ ...offline(), hostDisplay: { [ID]: { assetId: ID, sym: 'G', dec: 18, mandala: true } } })
    expect(one).toContain('Settles when the Mandala overlay admits it')
    expect(one).toContain(K1)
    expect(one).toContain(ID)
    expect(one).toContain('0.000000000000001500 G')
    expect(one).toContain('https://brc.dev/207/attested')

    const { signer: _s, ...rest } = offline()
    const many = render({ ...rest, signers: [K1, K2] })
    expect(many).toContain('Settles when the Mandala overlay admits it')
    expect(many).toContain(K1)
    expect(many).toContain(K2)
    expect(many).toContain('1500 base units')
  })

  test('access, relinquish and signature views', () => {
    const access = render({ type: 'color_access', basket: 'p color assets', seekPermission: true })
    expect(access).toContain('p color assets')
    expect(access).toContain('30 minutes')

    const relinquish = render({ type: 'color_relinquish', assetId: ID, role: 'authority', outpoint: OUTPOINT })
    expect(relinquish).toContain(ID)
    expect(relinquish).toContain(OUTPOINT)
    expect(relinquish).toContain('authority')

    const { handoff: _h, ...sig } = send({ type: 'color_signature', inputIndex: 0 })
    const signature = render(sig)
    expect(signature).toContain('these signatures only')
    expect(signature).toContain(OUTPOINT)
  })
})

describe('handleColorPromptMessage', () => {
  test('an invalid request is declined without a dialog', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const enqueue = vi.fn(async (_view: ColorConsentView) => true)
    await expect(handleColorPromptMessage(JSON.stringify(send({ destinations: [{ outputIndex: 0, satoshis: 1, assetId: ID, role: 'value', amount: '18446744073709551616' }] })), enqueue)).resolves.toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0].join(' '))).toContain('destinations[0].amount')

    for (const bad of ['not json', '{}', JSON.stringify({ type: 'mandala_spend' }), JSON.stringify(send({ assets: [{ ...(send().assets as Array<Record<string, unknown>>)[0], outgoingAmount: '01' }] }))]) {
      await expect(handleColorPromptMessage(bad, enqueue)).resolves.toBe(false)
    }
    expect(enqueue).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(5)
  })

  test('a valid request is enqueued with its view and answered by the user', async () => {
    const seen: ColorConsentView[] = []
    await expect(handleColorPromptMessage(SEND_MSG_WITH_DISPLAY_DEC18_MAX, async (view) => { seen.push(view); return true })).resolves.toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0].title).toBe('Approve token transaction')
    await expect(handleColorPromptMessage(SEND_MSG_WITH_DISPLAY_DEC18_MAX, async () => false)).resolves.toBe(false)
  })

  test('an enqueue failure or a non-boolean answer is a decline', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(handleColorPromptMessage(SEND_MSG_WITH_DISPLAY_DEC18_MAX, async () => { throw new Error('unmounted') })).resolves.toBe(false)
    await expect(handleColorPromptMessage(SEND_MSG_WITH_DISPLAY_DEC18_MAX, async () => 'yes' as unknown as boolean)).resolves.toBe(false)
    await expect(handleColorPromptMessage(SEND_MSG_WITH_DISPLAY_DEC18_MAX, async () => 1 as unknown as boolean)).resolves.toBe(false)
  })
})

describe('ColorPermissionPrompt', () => {
  test('is a component that renders nothing until a request arrives', () => {
    const html = renderToStaticMarkup(createElement(ColorPermissionPrompt, {
      id: 'color',
      paletteMode: 'light',
      isFocused: async () => true,
      onFocusRequested: async () => {},
      onFocusRelinquished: async () => {},
      onRegister: () => {}
    }))
    expect(html).toBe('')
  })

  test('the prompt never converts token amounts with Number()', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/lib/permissionModules/color/Prompt.tsx'), 'utf8')
    expect(src).not.toMatch(/Number\(|parseInt\(|parseFloat\(/)
  })
})
