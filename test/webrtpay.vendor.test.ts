import { describe, expect, it } from 'vitest'
import { DirectPayClient, VERSION } from '@bsv/webrtpay'

describe('vendored @bsv/webrtpay', () => {
  it('resolves the package root entry', () => {
    expect(VERSION).toBe('0.1.0')
    expect(typeof DirectPayClient).toBe('function')
  })
})
