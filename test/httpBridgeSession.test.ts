import { describe, it, expect, beforeEach } from 'vitest'
import {
  beginHttpBridgeSession,
  endHttpBridgeSession,
  markHttpBridgeSessionCancelled,
  trackPermissionForHttpBridge,
  getHttpBridgeSession,
  _test_resetHttpBridgeSessions,
  normalizeBridgeOrigin,
} from '../src/lib/services/httpBridgeSession'

describe('httpBridgeSession', () => {
  beforeEach(() => {
    _test_resetHttpBridgeSessions()
  })

  it('normalizes origins for comparison', () => {
    expect(normalizeBridgeOrigin('https://App.Example.com/')).toBe('app.example.com')
    expect(normalizeBridgeOrigin('localhost:3000')).toBe('localhost:3000')
  })

  it('tracks permission ids on live sessions for the same originator', () => {
    beginHttpBridgeSession(1, 'https://app.example.com')
    expect(trackPermissionForHttpBridge('perm-1', 'app.example.com')).toBe('track')
    expect(getHttpBridgeSession(1)?.permissionIds.has('perm-1')).toBe(true)
  })

  it('auto-denies when every matching session is cancelled', () => {
    beginHttpBridgeSession(1, 'app.example.com')
    markHttpBridgeSessionCancelled(1)
    expect(trackPermissionForHttpBridge('perm-2', 'app.example.com')).toBe('auto-deny')
  })

  it('does not auto-deny when a live same-origin session remains', () => {
    beginHttpBridgeSession(1, 'app.example.com')
    beginHttpBridgeSession(2, 'app.example.com')
    markHttpBridgeSessionCancelled(1)
    expect(trackPermissionForHttpBridge('perm-3', 'app.example.com')).toBe('track')
    expect(getHttpBridgeSession(2)?.permissionIds.has('perm-3')).toBe(true)
    expect(getHttpBridgeSession(1)?.permissionIds.has('perm-3')).toBe(false)
  })

  it('allows unscoped permissions when no HTTP session exists', () => {
    expect(trackPermissionForHttpBridge('perm-ui', 'desktop-admin')).toBe('track')
  })

  it('ends sessions so later permissions are unscoped', () => {
    beginHttpBridgeSession(9, 'app.example.com')
    endHttpBridgeSession(9)
    expect(getHttpBridgeSession(9)).toBeUndefined()
    expect(trackPermissionForHttpBridge('perm-late', 'app.example.com')).toBe('track')
  })
})
