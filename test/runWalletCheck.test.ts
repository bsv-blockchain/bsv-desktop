import { describe, it, expect, vi } from 'vitest'
import { runWalletCheck, CHECK_STEPS, type WalletCheckPorts, type StepOutcome, type CheckStepId } from '../src/lib/services/walletCheck/runWalletCheck'

const ok = (message = 'fine'): StepOutcome => ({ status: 'ok', message })
function ports(overrides: Partial<WalletCheckPorts> = {}): WalletCheckPorts {
  const base = Object.fromEntries(CHECK_STEPS.map(s => [s.id, vi.fn(async () => ok())])) as WalletCheckPorts
  return { ...base, ...overrides }
}

describe('runWalletCheck', () => {
  it('runs every step in CHECK_STEPS order', async () => {
    const order: CheckStepId[] = []
    const result = await runWalletCheck(ports(), { onStepStart: id => order.push(id) })
    expect(order).toEqual(CHECK_STEPS.map(s => s.id))
    expect(result.allOk).toBe(true)
    expect(result.allClear).toBe(true)
  })

  it('turns a throw into error and keeps going', async () => {
    const p = ports({ transactions: async () => { throw new Error('boom') } })
    const result = await runWalletCheck(p)
    expect(result.steps.transactions).toEqual({ status: 'error', message: 'boom' })
    expect(result.steps.backup?.status).toBe('ok')
    expect(result.allOk).toBe(false)
    expect(result.needsYou).toEqual([{ id: 'transactions', message: 'boom' }])
  })

  it('aggregates fixed items and attention steps with actions', async () => {
    const p = ports({
      transactions: async () => ({ status: 'ok', message: 'Fixed', fixed: ['Retried 2 failed payments'] }),
      backup: async () => ({ status: 'attention', message: 'Back up your wallet', action: { label: 'Back up now', to: '/dashboard/settings/backup' } }),
    })
    const result = await runWalletCheck(p)
    expect(result.fixed).toEqual(['Retried 2 failed payments'])
    expect(result.needsYou).toEqual([{ id: 'backup', message: 'Back up your wallet', action: { label: 'Back up now', to: '/dashboard/settings/backup' } }])
    expect(result.allOk).toBe(true)
    expect(result.allClear).toBe(false)
  })

  it('skips a step that is skipped before it starts without calling it', async () => {
    const coins = vi.fn(async () => ok())
    const result = await runWalletCheck(ports({ coins }), {}, { isSkipped: id => id === 'coins', whenSkipped: () => new Promise(() => {}) })
    expect(coins).not.toHaveBeenCalled()
    expect(result.steps.coins).toEqual({ status: 'skipped', message: 'Skipped' })
    expect(result.allClear).toBe(true)
  })

  it('abandons a running step when it is skipped mid-flight', async () => {
    let skip!: () => void
    const skipped = new Promise<void>(r => { skip = r })
    const p = ports({ coins: () => new Promise(() => {}) })
    const run = runWalletCheck(p, { onStepStart: id => { if (id === 'coins') setTimeout(skip, 0) } }, { isSkipped: () => false, whenSkipped: id => id === 'coins' ? skipped : new Promise(() => {}) })
    const result = await run
    expect(result.steps.coins?.status).toBe('skipped')
    expect(result.steps.payments?.status).toBe('ok')
  })

  it('times out a step that never settles', async () => {
    const result = await runWalletCheck(ports({ network: () => new Promise(() => {}) }), {}, undefined, 20)
    expect(result.steps.network).toEqual({ status: 'error', message: 'Took too long' })
    expect(result.steps.backup?.status).toBe('ok')
  })

  it('reports each finished step through onStepDone', async () => {
    const done = vi.fn()
    await runWalletCheck(ports(), { onStepDone: done })
    expect(done).toHaveBeenCalledTimes(CHECK_STEPS.length)
    expect(done).toHaveBeenCalledWith('network', { status: 'ok', message: 'fine' })
  })

  it('a normal run has no pending steps', async () => {
    const result = await runWalletCheck(ports())
    expect(result.pending).toEqual([])
  })

  it("keeps a step skipped mid-flight in pending as the port's own promise", async () => {
    let skip!: () => void
    const skipped = new Promise<void>(r => { skip = r })
    let finish!: (o: StepOutcome) => void
    const own = new Promise<StepOutcome>(r => { finish = r })
    const p = ports({ coins: () => own })
    const result = await runWalletCheck(p, { onStepStart: id => { if (id === 'coins') setTimeout(skip, 0) } }, { isSkipped: () => false, whenSkipped: id => id === 'coins' ? skipped : new Promise(() => {}) })
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]).toBe(own)
    finish(ok())
  })

  it("keeps a timed-out step in pending as the port's own promise", async () => {
    const own = new Promise<StepOutcome>(() => {})
    const result = await runWalletCheck(ports({ network: () => own }), {}, undefined, 20)
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]).toBe(own)
  })
})
