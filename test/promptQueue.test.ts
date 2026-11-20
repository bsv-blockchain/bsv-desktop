/**
 * The queue behind the module permission prompts: one request on screen at a
 * time, in arrival order, each decided once, by the id of the request the
 * dialog was rendered for, and approvable only after it has been on screen
 * for the arming delay.
 */

import { describe, expect, test, vi } from 'vitest'
import { PROMPT_ARM_DELAY_MS, createPromptClock, createPromptQueue, modulePromptClock } from '../src/lib/permissionModules/promptQueue'

const ARM = 600

function setup () {
  let now = 1_000
  const onChange = vi.fn()
  const queue = createPromptQueue<string>({ armDelayMs: ARM, now: () => now, onChange })
  return { queue, onChange, advance: (ms: number) => { now += ms } }
}

/** Resolves to the settled value, or 'pending' if the promise has not settled. */
async function state (p: Promise<boolean>): Promise<boolean | 'pending'> {
  return await Promise.race([p, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 0))])
}

test('the default arming delay', () => {
  expect(PROMPT_ARM_DELAY_MS).toBe(600)
})

test('entries are shown one at a time in arrival order, each with a fresh id', async () => {
  const { queue, advance } = setup()
  expect(queue.current()).toBeNull()
  const a = queue.enqueue('a.example', 'A')
  const b = queue.enqueue('b.example', 'B')
  const c = queue.enqueue('c.example', 'C')
  const first = queue.current()!
  expect(first).toMatchObject({ app: 'a.example', view: 'A' })
  advance(ARM)
  queue.decide(first.id, true)
  const second = queue.current()!
  expect(second).toMatchObject({ app: 'b.example', view: 'B' })
  expect(second.id).not.toBe(first.id)
  advance(ARM)
  queue.decide(second.id, false)
  const third = queue.current()!
  expect(third.view).toBe('C')
  expect(new Set([first.id, second.id, third.id]).size).toBe(3)
  advance(ARM)
  queue.decide(third.id, true)
  expect(queue.current()).toBeNull()
  expect([await a, await b, await c]).toEqual([true, false, true])
})

test('the current entry is the same object until it is decided', () => {
  const { queue } = setup()
  void queue.enqueue('a.example', 'A')
  expect(queue.current()).toBe(queue.current())
})

test('a decision with a stale id is ignored and the current entry stays pending', async () => {
  const { queue, advance } = setup()
  const a = queue.enqueue('a.example', 'A')
  const b = queue.enqueue('b.example', 'B')
  const idA = queue.current()!.id
  advance(ARM)
  queue.decide(idA, true)
  const idB = queue.current()!.id
  advance(ARM)
  queue.decide(idA, true)
  queue.decide(idA, false)
  queue.decide(idB + 100, false)
  expect(queue.current()!.id).toBe(idB)
  expect(await state(b)).toBe('pending')
  expect(await a).toBe(true)
})

test('an approval before the arming delay is ignored; the same approval after it resolves true', async () => {
  const { queue, advance } = setup()
  const a = queue.enqueue('a.example', 'A')
  const { id } = queue.current()!
  expect(queue.armed()).toBe(false)
  queue.decide(id, true)
  advance(ARM - 1)
  expect(queue.armed()).toBe(false)
  queue.decide(id, true)
  expect(queue.current()!.id).toBe(id)
  expect(await state(a)).toBe('pending')
  advance(1)
  expect(queue.armed()).toBe(true)
  queue.decide(id, true)
  expect(await a).toBe(true)
  expect(queue.current()).toBeNull()
})

test('a denial before arming resolves false', async () => {
  const { queue } = setup()
  const a = queue.enqueue('a.example', 'A')
  queue.decide(queue.current()!.id, false)
  expect(await a).toBe(false)
  expect(queue.current()).toBeNull()
})

test('approving A twice in a row leaves queued B pending and shown, and B arms on its own', async () => {
  const { queue, advance } = setup()
  const a = queue.enqueue('a.example', 'A')
  const b = queue.enqueue('b.example', 'B')
  advance(ARM + 5_000)
  const idA = queue.current()!.id
  // The double-click: both clicks carry the id of the entry they were rendered for.
  queue.decide(idA, true)
  queue.decide(idA, true)
  expect(await a).toBe(true)
  const shown = queue.current()!
  expect(shown.view).toBe('B')
  expect(await state(b)).toBe('pending')
  // B's own arming period started when B was shown.
  expect(queue.armed()).toBe(false)
  queue.decide(shown.id, true)
  advance(ARM - 1)
  queue.decide(shown.id, true)
  expect(await state(b)).toBe('pending')
  advance(1)
  queue.decide(shown.id, true)
  expect(await b).toBe(true)
})

test('clear resolves the current and every queued entry false', async () => {
  const { queue, onChange } = setup()
  const entries = [queue.enqueue('a.example', 'A'), queue.enqueue('b.example', 'B'), queue.enqueue('c.example', 'C')]
  onChange.mockClear()
  queue.clear()
  expect(await Promise.all(entries)).toEqual([false, false, false])
  expect(queue.current()).toBeNull()
  expect(queue.armed()).toBe(false)
  expect(onChange).toHaveBeenCalled()
})

test('enqueue after clear still works, with a new arming period', async () => {
  const { queue, advance } = setup()
  void queue.enqueue('a.example', 'A')
  const old = queue.current()!.id
  queue.clear()
  const b = queue.enqueue('b.example', 'B')
  const shown = queue.current()!
  expect(shown).toMatchObject({ app: 'b.example', view: 'B' })
  expect(shown.id).not.toBe(old)
  queue.decide(old, false)
  expect(await state(b)).toBe('pending')
  advance(ARM)
  queue.decide(shown.id, true)
  expect(await b).toBe(true)
})

test('onChange is called when the shown entry changes', () => {
  const { queue, onChange, advance } = setup()
  void queue.enqueue('a.example', 'A')
  expect(onChange).toHaveBeenCalledTimes(1)
  void queue.enqueue('b.example', 'B')
  const before = onChange.mock.calls.length
  advance(ARM)
  queue.decide(queue.current()!.id, true)
  expect(onChange.mock.calls.length).toBeGreaterThan(before)
})

test('msUntilArmed is the time left before the shown entry can be approved', () => {
  const { queue, advance } = setup()
  expect(queue.msUntilArmed()).toBe(0)
  const a = queue.enqueue('a.example', 'A')
  expect(queue.msUntilArmed()).toBe(ARM)
  advance(400)
  expect(queue.msUntilArmed()).toBe(200)
  advance(200)
  expect(queue.msUntilArmed()).toBe(0)
  advance(1_000)
  expect(queue.msUntilArmed()).toBe(0)
  queue.decide(queue.current()!.id, true)
  expect(queue.msUntilArmed()).toBe(0)
  return a
})

describe('one decision clock shared by several queues', () => {
  function twoQueues (shared: boolean) {
    let now = 1_000
    const clockA = createPromptClock()
    const clockB = shared ? clockA : createPromptClock()
    const make = (clock: typeof clockA) => createPromptQueue<string>({ armDelayMs: ARM, now: () => now, onChange: () => {}, clock })
    return { q1: make(clockA), q2: make(clockB), clock: clockA, advance: (ms: number) => { now += ms } }
  }

  test('a decision in one queue disarms the entry shown in the other until the delay has passed again', async () => {
    const { q1, q2, advance } = twoQueues(true)
    const x = q1.enqueue('a.example', 'X')
    const xId = q1.current()!.id
    advance(ARM + 5_000)
    expect(q1.armed()).toBe(true)
    const y = q2.enqueue('b.example', 'Y')
    advance(ARM)
    q2.decide(q2.current()!.id, true)
    expect(await y).toBe(true)
    // Immediately afterwards an approval of X is ignored.
    expect(q1.armed()).toBe(false)
    q1.decide(xId, true)
    expect(q1.current()!.id).toBe(xId)
    expect(await state(x)).toBe('pending')
    advance(ARM - 1)
    q1.decide(xId, true)
    expect(await state(x)).toBe('pending')
    advance(1)
    expect(q1.armed()).toBe(true)
    q1.decide(xId, true)
    expect(await x).toBe(true)
  })

  test('a denial in one queue also restarts the delay in the other', async () => {
    const { q1, q2, advance } = twoQueues(true)
    const x = q1.enqueue('a.example', 'X')
    const xId = q1.current()!.id
    advance(ARM + 5_000)
    void q2.enqueue('b.example', 'Y')
    q2.decide(q2.current()!.id, false)
    q1.decide(xId, true)
    expect(await state(x)).toBe('pending')
    advance(ARM)
    q1.decide(xId, true)
    expect(await x).toBe(true)
  })

  test('a denial of the other entry is accepted at any time', async () => {
    const { q1, q2, advance } = twoQueues(true)
    const x = q1.enqueue('a.example', 'X')
    advance(ARM + 5_000)
    void q2.enqueue('b.example', 'Y')
    q2.decide(q2.current()!.id, false)
    q1.decide(q1.current()!.id, false)
    expect(await x).toBe(false)
    expect(q1.current()).toBeNull()
  })

  test('an ignored approval does not stamp the clock', () => {
    const { q1, q2, clock, advance } = twoQueues(true)
    void q1.enqueue('a.example', 'X')
    const before = clock.lastDecisionAt()
    void q2.enqueue('b.example', 'Y')
    q2.decide(q2.current()!.id, true)
    q2.decide(q2.current()!.id + 100, false)
    expect(clock.lastDecisionAt()).toBe(before)
    advance(ARM)
    expect(q1.armed()).toBe(true)
  })

  test('clearing a queue that shows an entry restarts the delay in the other', async () => {
    const { q1, q2, advance } = twoQueues(true)
    const x = q1.enqueue('a.example', 'X')
    advance(ARM + 5_000)
    void q2.enqueue('b.example', 'Y')
    q2.clear()
    q1.decide(q1.current()!.id, true)
    expect(await state(x)).toBe('pending')
    advance(ARM)
    q1.decide(q1.current()!.id, true)
    expect(await x).toBe(true)
  })

  test('queues on separate clocks do not affect each other', async () => {
    const { q1, q2, advance } = twoQueues(false)
    const x = q1.enqueue('a.example', 'X')
    advance(ARM + 5_000)
    const y = q2.enqueue('b.example', 'Y')
    advance(ARM)
    q2.decide(q2.current()!.id, true)
    expect(await y).toBe(true)
    expect(q1.armed()).toBe(true)
    q1.decide(q1.current()!.id, true)
    expect(await x).toBe(true)
  })

  test('msUntilArmed is the later of the entry being shown and the last decision', () => {
    const { q1, q2, advance } = twoQueues(true)
    void q2.enqueue('b.example', 'Y')
    advance(ARM)
    void q1.enqueue('a.example', 'X')
    advance(100)
    // Shown 100 ms ago, no decision yet: the entry's own delay.
    expect(q1.msUntilArmed()).toBe(ARM - 100)
    advance(300)
    q2.decide(q2.current()!.id, true)
    // Decided just now: the decision's delay, which ends later.
    expect(q1.msUntilArmed()).toBe(ARM)
    advance(250)
    expect(q1.msUntilArmed()).toBe(ARM - 250)
    advance(ARM - 250)
    expect(q1.msUntilArmed()).toBe(0)
  })

  test('a decision notifies the clock\'s subscribers until they unsubscribe', () => {
    const { q1, q2, clock, advance } = twoQueues(true)
    const listener = vi.fn()
    const unsubscribe = clock.subscribe(listener)
    void q2.enqueue('b.example', 'Y')
    advance(ARM)
    q2.decide(q2.current()!.id, true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    void q1.enqueue('a.example', 'X')
    q1.decide(q1.current()!.id, false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('the module prompts share one default clock', () => {
    expect(typeof modulePromptClock.lastDecisionAt()).toBe('number')
    expect(typeof modulePromptClock.stamp).toBe('function')
    expect(typeof modulePromptClock.subscribe).toBe('function')
  })
})
