/**
 * Window focus around the module permission prompts: taken once per burst of
 * requests, given back only if the burst took it, and never taken for the
 * next request while giving it back is still in flight.
 */

import { afterEach, expect, test, vi } from 'vitest'
import { createPromptFocus } from '../src/lib/permissionModules/promptFocus'

type Gate = { resolve: () => void, reject: (e: unknown) => void }

/** Fake callbacks that record call order; each call can be held until released. */
function fakeWindow (focused: boolean) {
  const calls: string[] = []
  const held: Record<string, Gate[]> = { onFocusRequested: [], onFocusRelinquished: [] }
  let hold = false
  const step = (name: 'onFocusRequested' | 'onFocusRelinquished') => async () => {
    calls.push(name)
    if (!hold) return
    await new Promise<void>((resolve, reject) => { held[name].push({ resolve, reject }) })
  }
  return {
    calls,
    held,
    holdCalls: (on: boolean) => { hold = on },
    cb: {
      isFocused: async () => { calls.push('isFocused'); return focused },
      onFocusRequested: step('onFocusRequested'),
      onFocusRelinquished: step('onFocusRelinquished')
    }
  }
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0)) }

afterEach(() => { vi.restoreAllMocks() })

test('unfocused: the first ensure checks and asks for focus, a second in the same burst does neither', async () => {
  const w = fakeWindow(false)
  const focus = createPromptFocus(w.cb)
  await focus.ensure()
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested'])
  await focus.ensure()
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested'])
})

test('concurrent ensures in one burst check focus once', async () => {
  const w = fakeWindow(false)
  const focus = createPromptFocus(w.cb)
  await Promise.all([focus.ensure(), focus.ensure(), focus.ensure()])
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested'])
})

test('relinquish gives focus back once, only if the burst took it', async () => {
  const w = fakeWindow(false)
  const focus = createPromptFocus(w.cb)
  await focus.ensure()
  await focus.relinquish()
  await focus.relinquish()
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested', 'onFocusRelinquished'])

  const f = fakeWindow(true)
  const focused = createPromptFocus(f.cb)
  await focused.ensure()
  await focused.relinquish()
  expect(f.calls).toEqual(['isFocused'])
})

test('relinquish with no burst does nothing', async () => {
  const w = fakeWindow(false)
  await createPromptFocus(w.cb).relinquish()
  expect(w.calls).toEqual([])
})

test('an ensure during a hand-back waits for it before checking or asking for focus', async () => {
  const w = fakeWindow(false)
  const focus = createPromptFocus(w.cb)
  await focus.ensure()
  w.holdCalls(true)
  const back = focus.relinquish()
  await settle()
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested', 'onFocusRelinquished'])
  w.holdCalls(false)
  let ensured = false
  const again = focus.ensure().then(() => { ensured = true })
  await settle()
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested', 'onFocusRelinquished'])
  expect(ensured).toBe(false)
  w.held.onFocusRelinquished[0].resolve()
  await back
  await again
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested', 'onFocusRelinquished', 'isFocused', 'onFocusRequested'])
})

test('a rejecting hand-back is survived: the next ensure still checks and asks for focus', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const w = fakeWindow(false)
  const focus = createPromptFocus(w.cb)
  await focus.ensure()
  w.holdCalls(true)
  const back = focus.relinquish()
  await settle()
  w.holdCalls(false)
  const again = focus.ensure()
  w.held.onFocusRelinquished[0].reject(new Error('osascript failed'))
  await expect(back).resolves.toBeUndefined()
  await again
  expect(w.calls).toEqual(['isFocused', 'onFocusRequested', 'onFocusRelinquished', 'isFocused', 'onFocusRequested'])
  expect(error).toHaveBeenCalledOnce()
})

test('a throwing focus check is logged and later calls still work', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const calls: string[] = []
  let fail = true
  const focus = createPromptFocus({
    isFocused: async () => { calls.push('isFocused'); if (fail) throw new Error('no window'); return false },
    onFocusRequested: async () => { calls.push('onFocusRequested') },
    onFocusRelinquished: async () => { calls.push('onFocusRelinquished') }
  })
  await expect(focus.ensure()).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledOnce()
  // The failed burst took nothing, so there is nothing to give back.
  await focus.relinquish()
  expect(calls).toEqual(['isFocused'])
  fail = false
  await focus.ensure()
  await focus.relinquish()
  expect(calls).toEqual(['isFocused', 'isFocused', 'onFocusRequested', 'onFocusRelinquished'])
})
