import { describe, it, expect } from 'vitest'
import { createSingleFlight } from '../src/lib/services/walletCheck/singleFlight'

describe('createSingleFlight', () => {
  it('allows one start until finished', () => {
    const flight = createSingleFlight()
    expect(flight.busy).toBe(false)
    expect(flight.tryStart()).toBe(true)
    expect(flight.busy).toBe(true)
    expect(flight.tryStart()).toBe(false)
    flight.finish()
    expect(flight.busy).toBe(false)
    expect(flight.tryStart()).toBe(true)
  })

  it('instances are independent', () => {
    const a = createSingleFlight(), b = createSingleFlight()
    expect(a.tryStart()).toBe(true)
    expect(b.tryStart()).toBe(true)
  })
})
