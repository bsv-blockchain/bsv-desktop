/**
 * Settle scheduler for the color module (D17): settle() after wallet open,
 * every 5 minutes, and on the window `online` event.
 *
 * Stability cases pinned here:
 * - double-trigger / multi-window: overlapping triggers (online bursts, a
 *   manual runNow, an interval tick during a slow settle) share one run and
 *   never queue another; the run is released once it settles;
 * - retry: a failing settle (async reject or sync throw) is reported to
 *   onError, never thrown, and the next tick runs again;
 * - a throwing onReport cannot reject runNow or escape an interval tick;
 * - wallet rebuild / close: stop() removes both timers and the `online`
 *   listener, ignores a report that arrives after stop, starts no new run and
 *   is idempotent.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  SETTLE_INITIAL_DELAY_MS,
  SETTLE_INTERVAL_MS,
  startColorSettleScheduler,
  type SettleReportLike
} from '../src/lib/permissionModules/color/settleScheduler'

function deferred<T> () {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const empty: SettleReportLike = { results: [] }

describe('startColorSettleScheduler', () => {
  let events: EventTarget

  beforeEach(() => {
    vi.useFakeTimers()
    events = new EventTarget()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('constants follow D17', () => {
    expect(SETTLE_INTERVAL_MS).toBe(300_000)
    expect(SETTLE_INITIAL_DELAY_MS).toBe(1_000)
  })

  test('runs after the initial delay, then every 5 minutes, and on online', async () => {
    const settle = vi.fn().mockResolvedValue(empty)
    const s = startColorSettleScheduler({ settle, events, onReport: () => {} })
    await vi.advanceTimersByTimeAsync(999); expect(settle).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1); expect(settle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300_000); expect(settle).toHaveBeenCalledTimes(2)
    events.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0)
    expect(settle).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(300_000); expect(settle).toHaveBeenCalledTimes(4)
    s.stop()
  })

  test('single flight: overlapping triggers share one run', async () => {
    const d = deferred<SettleReportLike>()
    const settle = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(empty)
    const onReport = vi.fn()
    const s = startColorSettleScheduler({ settle, events, onReport, initialDelayMs: 50 })

    events.dispatchEvent(new Event('online'))
    events.dispatchEvent(new Event('online'))
    events.dispatchEvent(new Event('online'))
    const a = s.runNow()
    const b = s.runNow()
    expect(a).toBe(b)
    await vi.advanceTimersByTimeAsync(50) // initial tick joins the in-flight run
    await vi.advanceTimersByTimeAsync(300_000) // an interval tick during a slow settle joins too
    expect(settle).toHaveBeenCalledTimes(1)
    expect(onReport).not.toHaveBeenCalled()

    d.resolve(empty)
    await a
    expect(onReport).toHaveBeenCalledTimes(1)
    expect(onReport).toHaveBeenCalledWith(empty)

    // released: the next trigger starts a new run
    await s.runNow()
    expect(settle).toHaveBeenCalledTimes(2)
    s.stop()
  })

  test('a failing settle is reported, never thrown, and the next tick runs', async () => {
    const err = new Error('overlay down')
    const settle = vi.fn().mockRejectedValueOnce(err).mockResolvedValue(empty)
    const onError = vi.fn()
    const onReport = vi.fn()
    const s = startColorSettleScheduler({ settle, events, onError, onReport })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settle).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(err)
    expect(onReport).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300_000)
    expect(settle).toHaveBeenCalledTimes(2)
    expect(onReport).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    s.stop()
  })

  test('a synchronously throwing settle is reported and runNow resolves', async () => {
    const err = new Error('boom')
    const settle = vi.fn(() => { throw err })
    const onError = vi.fn()
    const s = startColorSettleScheduler({ settle, events, onError })
    await expect(s.runNow()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(err)
    s.stop()
  })

  test('a throwing onReport (or onError) never escapes', async () => {
    const settle = vi.fn().mockResolvedValue(empty)
    const reportErr = new Error('render failed')
    const onError = vi.fn(() => { throw new Error('logger failed') })
    const s = startColorSettleScheduler({
      settle,
      events,
      onReport: () => { throw reportErr },
      onError
    })
    await expect(s.runNow()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(reportErr)
    await vi.advanceTimersByTimeAsync(1_000) // interval-path run with the same throwing callbacks
    expect(settle).toHaveBeenCalledTimes(2)
    s.stop()
  })

  test('default onReport warns once per refused result only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const report: SettleReportLike = {
      results: [
        { txid: 'a'.repeat(64), assetId: `${'b'.repeat(64)}_0`, status: 'admitted' },
        { txid: 'c'.repeat(64), assetId: `${'b'.repeat(64)}_0`, status: 'retry', code: 'ERR_UNAVAILABLE' },
        { txid: 'd'.repeat(64), assetId: `${'b'.repeat(64)}_0`, status: 'refused', code: 'ERR_REFUSED', description: 'no' }
      ]
    }
    const s = startColorSettleScheduler({ settle: async () => report, events })
    await s.runNow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[color] settle refused', 'd'.repeat(64), 'ERR_REFUSED')
    s.stop()
  })

  test('default onReport tolerates a malformed report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = startColorSettleScheduler({ settle: async () => undefined as any, events })
    await expect(s.runNow()).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalledWith('[color] settle refused', expect.anything(), expect.anything())
    s.stop()
  })

  test('default onError warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = new Error('x')
    const s = startColorSettleScheduler({ settle: async () => { throw err }, events })
    await s.runNow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toContain(err)
    s.stop()
  })

  test('stop removes the timer and the online listener', async () => {
    const settle = vi.fn().mockResolvedValue(empty)
    const removeSpy = vi.spyOn(events, 'removeEventListener')
    const s = startColorSettleScheduler({ settle, events, onReport: () => {} })
    s.stop()
    await vi.advanceTimersByTimeAsync(3_600_000)
    events.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(settle).not.toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    expect(() => s.stop()).not.toThrow()
    await expect(s.runNow()).resolves.toBeUndefined()
    expect(settle).not.toHaveBeenCalled()
  })

  test('stop after the first run clears the interval too', async () => {
    const settle = vi.fn().mockResolvedValue(empty)
    const s = startColorSettleScheduler({ settle, events, onReport: () => {} })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settle).toHaveBeenCalledTimes(1)
    s.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3_600_000)
    events.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(settle).toHaveBeenCalledTimes(1)
  })

  test('a report or error that arrives after stop is ignored', async () => {
    const d1 = deferred<SettleReportLike>()
    const onReport = vi.fn()
    const onError = vi.fn()
    const s1 = startColorSettleScheduler({ settle: () => d1.promise, events, onReport, onError })
    const p1 = s1.runNow()
    s1.stop()
    d1.resolve(empty)
    await p1
    expect(onReport).not.toHaveBeenCalled()

    const d2 = deferred<SettleReportLike>()
    const s2 = startColorSettleScheduler({ settle: () => d2.promise, events, onReport, onError })
    const p2 = s2.runNow()
    s2.stop()
    d2.reject(new Error('late'))
    await p2
    expect(onError).not.toHaveBeenCalled()
  })

  test('without an events target (no window in node) it still schedules', async () => {
    const settle = vi.fn().mockResolvedValue(empty)
    const s = startColorSettleScheduler({ settle, events: undefined, onReport: () => {} })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settle).toHaveBeenCalledTimes(1)
    s.stop()
  })
})
