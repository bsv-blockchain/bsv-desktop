/**
 * Host consent gate for the color module (design C10, audit C6).
 *
 * Stability cases pinned here:
 * - double-click / multi-window: concurrent reads for one originator join one
 *   prompt, and a denial answers every joined caller without granting;
 * - read/spend isolation: a spend approval never grants reads, and a read
 *   grant never satisfies a spend;
 * - seekPermission:false never prompts and fails with the spec text;
 * - a prompt that throws counts as a denial and leaves no stuck in-flight
 *   prompt behind (retry prompts again);
 * - wallet rebuild: clear() drops grants, and a prompt still pending at clear()
 *   grants nothing;
 * - stale clock: a clock that moves backwards does not extend a grant.
 */

import { describe, expect, test, vi } from 'vitest'
import {
  ColorPermissionRequiredError,
  READ_GRANT_MS,
  createColorConsentGate
} from '../src/lib/permissionModules/color/consentGate'

const access = (o: object = {}) =>
  JSON.stringify({ type: 'color_access', basket: 'p color assets', seekPermission: true, ...o })
const send = (o: object = {}) => JSON.stringify({ type: 'color_send', assets: [], ...o })
const signature = (o: object = {}) => JSON.stringify({ type: 'color_signature', ...o })
const relinquish = (o: object = {}) => JSON.stringify({ type: 'color_relinquish', ...o })
const receiveOffline = (o: object = {}) =>
  JSON.stringify({
    type: 'color_receive_offline',
    assetId: `${'ab'.repeat(32)}_0`,
    outputs: [{ outputIndex: 0, amount: '1500' }],
    unsettledTransactions: 2,
    signer: `02${'cd'.repeat(32)}`,
    profiles: ['https://brc.dev/207/attested'],
    seekPermission: true,
    ...o
  })

function deferred<T> () {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup (opts: { enrich?: (m: string) => Promise<string> } = {}) {
  let t = 1_000_000
  const clock = {
    get: () => t,
    set: (v: number) => {
      t = v
    }
  }
  const prompt = vi.fn<(app: string, message: string) => Promise<boolean>>().mockResolvedValue(true)
  const gate = createColorConsentGate({ adminOriginator: 'admin', prompt, now: () => t, ...opts })
  return { gate, prompt, clock }
}

describe('createColorConsentGate', () => {
  test('READ_GRANT_MS is 30 minutes', () => {
    expect(READ_GRANT_MS).toBe(1_800_000)
  })

  test('an approved read grants 30 minutes of reads for that originator only', async () => {
    const { gate, prompt, clock } = setup()
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    // a live grant also satisfies seekPermission:false
    expect(await gate('app', access({ seekPermission: false }))).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(await gate('other.app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
    clock.set(clock.get() + READ_GRANT_MS) // boundary is inclusive
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
    clock.set(clock.get() + 1)
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(3)
  })

  test('the grant starts at approval time, not prompt start', async () => {
    const { gate, prompt, clock } = setup()
    const d = deferred<boolean>()
    prompt.mockReturnValueOnce(d.promise)
    const start = clock.get()
    const p = gate('app', access())
    clock.set(start + 1_000_000) // user takes a while to answer
    d.resolve(true)
    expect(await p).toBe(true)
    clock.set(start + 1_000_000 + READ_GRANT_MS)
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test('spend approval never grants reads', async () => {
    const prompt = vi.fn().mockResolvedValue(true)
    const gate = createColorConsentGate({ adminOriginator: 'admin', prompt })
    expect(await gate('app', send())).toBe(true)
    await expect(gate('app', access({ seekPermission: false }))).rejects.toThrow(
      'Colored Tokens inventory read permission is required'
    )
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test('signature and relinquish approvals never grant reads', async () => {
    const { gate, prompt } = setup()
    expect(await gate('app', signature())).toBe(true)
    expect(await gate('app', relinquish())).toBe(true)
    await expect(gate('app', access({ seekPermission: false }))).rejects.toMatchObject({
      name: 'ColorPermissionRequiredError'
    })
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test('a read grant never satisfies a spend', async () => {
    const { gate, prompt } = setup()
    expect(await gate('app', access())).toBe(true)
    expect(await gate('app', send())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(await gate('app', send())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(3)
    await expect(gate('app', send({ seekPermission: false }))).rejects.toThrow(
      'Colored Tokens spending permission is required'
    )
    expect(prompt).toHaveBeenCalledTimes(3)
  })

  test('seekPermission false never prompts', async () => {
    const { gate, prompt } = setup()
    await expect(gate('app', access({ seekPermission: false }))).rejects.toMatchObject({
      name: 'ColorPermissionRequiredError'
    })
    await expect(gate('app', send({ seekPermission: false }))).rejects.toThrow(
      'Colored Tokens spending permission is required'
    )
    await expect(gate('app', signature({ seekPermission: false }))).rejects.toThrow(
      'Colored Tokens spending permission is required'
    )
    await expect(gate('app', relinquish({ seekPermission: false }))).rejects.toThrow(
      'Colored Tokens spending permission is required'
    )
    expect(prompt).not.toHaveBeenCalled()
  })

  test('the thrown error carries the exact spec text and its class name', async () => {
    const { gate } = setup()
    const err = await gate('app', access({ seekPermission: false })).catch((e) => e)
    expect(err).toBeInstanceOf(ColorPermissionRequiredError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ColorPermissionRequiredError')
    expect(err.message).toBe('Colored Tokens inventory read permission is required')
  })

  test('a missing or non-boolean seekPermission still prompts', async () => {
    const { gate, prompt } = setup()
    expect(await gate('app', send())).toBe(true) // send() carries no seekPermission
    expect(await gate('app', access({ seekPermission: undefined }))).toBe(true)
    expect(await gate('app2', access({ seekPermission: 'false' }))).toBe(true)
    expect(await gate('app3', access({ seekPermission: 0 }))).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(4)
  })

  test('concurrent reads join one prompt; denial rejects all and grants nothing', async () => {
    const { gate, prompt } = setup()
    const d = deferred<boolean>()
    prompt.mockReturnValueOnce(d.promise)
    const calls = [gate('app', access()), gate('app', access()), gate('app', access())]
    await Promise.resolve()
    expect(prompt).toHaveBeenCalledTimes(1)
    d.resolve(false)
    expect(await Promise.all(calls)).toEqual([false, false, false])
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test('concurrent reads join one prompt; approval answers all and grants once', async () => {
    const { gate, prompt } = setup()
    const d = deferred<boolean>()
    prompt.mockReturnValueOnce(d.promise)
    const calls = [gate('app', access()), gate('app', access())]
    // a different originator does not join
    const other = gate('other', access())
    await Promise.resolve()
    expect(prompt).toHaveBeenCalledTimes(2)
    d.resolve(true)
    expect(await Promise.all(calls)).toEqual([true, true])
    expect(await other).toBe(true)
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test('concurrent spends each prompt', async () => {
    const { gate, prompt } = setup()
    expect(await Promise.all([gate('app', send()), gate('app', send())])).toEqual([true, true])
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test('a seekPermission:false read during an in-flight prompt throws, it does not join', async () => {
    const { gate, prompt } = setup()
    const d = deferred<boolean>()
    prompt.mockReturnValueOnce(d.promise)
    const first = gate('app', access())
    await expect(gate('app', access({ seekPermission: false }))).rejects.toMatchObject({
      name: 'ColorPermissionRequiredError'
    })
    d.resolve(true)
    expect(await first).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test('admin reads pass silently, admin spends still prompt', async () => {
    const { gate, prompt } = setup()
    expect(await gate('admin', access())).toBe(true)
    expect(await gate('admin', access({ seekPermission: false }))).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(0)
    expect(await gate('admin', send())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    await expect(gate('admin', send({ seekPermission: false }))).rejects.toThrow(
      'Colored Tokens spending permission is required'
    )
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test('admin reads set no grant', async () => {
    const { gate, prompt } = setup()
    prompt.mockResolvedValue(false)
    expect(await gate('admin', access())).toBe(true)
    // a grant keyed on another originator is unaffected
    expect(await gate('app', access())).toBe(false)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test('unknown or malformed messages are declined without a prompt', async () => {
    const { gate, prompt } = setup()
    for (const m of [
      'not json',
      '[]',
      'null',
      '"color_access"',
      '42',
      '',
      JSON.stringify({ type: 'mandala_access' }),
      JSON.stringify({ type: 'color_spend' }),
      JSON.stringify({ type: ['color_access'] }),
      JSON.stringify({ type: 'toString' }),
      JSON.stringify({ basket: 'p color assets' })
    ]) {
      expect(await gate('app', m)).toBe(false)
    }
    expect(prompt).not.toHaveBeenCalled()
  })

  test('color_receive_offline is no longer a consent type (Revision 3): declined without a prompt', async () => {
    const { gate, prompt } = setup()
    expect(await gate('app', receiveOffline())).toBe(false)
    expect(await gate('app', receiveOffline({ seekPermission: false }))).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
  })

  test('only a literal true approves; a throwing prompt is a denial and can be retried', async () => {
    const { gate, prompt } = setup()
    prompt.mockResolvedValueOnce('yes' as unknown as boolean)
    expect(await gate('app', access())).toBe(false)
    prompt.mockRejectedValueOnce(new Error('window closed'))
    expect(await gate('app', access())).toBe(false)
    prompt.mockRejectedValueOnce(new Error('window closed'))
    expect(await gate('app', send())).toBe(false)
    // nothing stuck in flight, nothing granted
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(4)
  })

  test('prompt sees the enriched message; enrich failure falls back', async () => {
    const enrich = vi.fn(async (m: string) => JSON.stringify({ ...JSON.parse(m), hostDisplay: { sym: 'X' } }))
    const { gate, prompt } = setup({ enrich })
    const msg = send()
    expect(await gate('app', msg)).toBe(true)
    expect(JSON.parse(prompt.mock.calls[0][1])).toMatchObject({ type: 'color_send', hostDisplay: { sym: 'X' } })
    expect(prompt.mock.calls[0][0]).toBe('app')
    enrich.mockRejectedValueOnce(new Error('overlay down'))
    expect(await gate('app', msg)).toBe(true)
    expect(prompt.mock.calls[1][1]).toBe(msg)
  })

  test('joined reads enrich once', async () => {
    const enrich = vi.fn(async (m: string) => m)
    const { gate, prompt } = setup({ enrich })
    const d = deferred<boolean>()
    prompt.mockReturnValueOnce(d.promise)
    const calls = [gate('app', access()), gate('app', access())]
    await new Promise((r) => setTimeout(r, 0))
    d.resolve(true)
    await Promise.all(calls)
    expect(enrich).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test('clear drops grants', async () => {
    const { gate, prompt } = setup()
    expect(await gate('app', access())).toBe(true)
    gate.clear()
    await expect(gate('app', access({ seekPermission: false }))).rejects.toMatchObject({
      name: 'ColorPermissionRequiredError'
    })
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test('a prompt pending at clear() resolves normally but grants nothing; later reads prompt afresh', async () => {
    const { gate, prompt } = setup()
    const d = deferred<boolean>()
    prompt.mockReturnValueOnce(d.promise)
    const pending = gate('app', access())
    await Promise.resolve()
    gate.clear()
    // a post-clear read does not join the pre-clear prompt
    const d2 = deferred<boolean>()
    prompt.mockReturnValueOnce(d2.promise)
    const after = gate('app', access())
    await new Promise((r) => setTimeout(r, 0))
    expect(prompt).toHaveBeenCalledTimes(2)
    d.resolve(true)
    expect(await pending).toBe(true)
    d2.resolve(false)
    expect(await after).toBe(false)
    // the pre-clear approval did not grant, and the stale in-flight cleanup
    // did not remove anything newer
    await expect(gate('app', access({ seekPermission: false }))).rejects.toMatchObject({
      name: 'ColorPermissionRequiredError'
    })
  })

  test('a clock moving backwards does not extend a grant', async () => {
    const { gate, prompt, clock } = setup()
    expect(await gate('app', access())).toBe(true)
    clock.set(clock.get() - 1)
    expect(await gate('app', access())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
  })
})
