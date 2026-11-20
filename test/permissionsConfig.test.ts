/**
 * Defaults and stored-config migration for the split key-linkage flags.
 *
 * Counterparty linkage reveals the root ECDH shared secret, so a stored
 * config that never chose the new counterparty flag is treated as requiring
 * permission. Every boolean the user already saved is left as stored.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { WalletInterface } from '@bsv/sdk'
import {
  DEFAULT_PERMISSIONS_CONFIG,
  mergeStoredPermissionsConfig,
  type PermissionsConfig
} from '../src/lib/WalletContext'
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'

/** The permissions config as it was saved before the split flags existed. */
function storedBeforeSplit(overrides: Partial<PermissionsConfig> = {}): Record<string, boolean> {
  const {
    seekPermissionsForCounterpartyKeyLinkageRevelation: _counterparty,
    seekPermissionsForSpecificKeyLinkageRevelation: _specific,
    ...legacy
  } = DEFAULT_PERMISSIONS_CONFIG
  return {
    ...legacy,
    // What Settings used to persist: the combined flag off.
    seekPermissionsForKeyLinkageRevelation: false,
    seekProtocolPermissionsForEncrypting: true,
    seekBasketInsertionPermissions: true,
    ...overrides
  }
}

describe('key linkage permission defaults', () => {
  test('gates counterparty linkage and leaves specific linkage permission-free', () => {
    expect(DEFAULT_PERMISSIONS_CONFIG.seekPermissionsForCounterpartyKeyLinkageRevelation).toBe(true)
    expect(DEFAULT_PERMISSIONS_CONFIG.seekPermissionsForSpecificKeyLinkageRevelation).toBe(false)
    // The installed toolbox ignores the split flags and reads this one.
    expect(DEFAULT_PERMISSIONS_CONFIG.seekPermissionsForKeyLinkageRevelation).toBe(true)
    // Unrelated defaults stay put.
    expect(DEFAULT_PERMISSIONS_CONFIG.seekProtocolPermissionsForSigning).toBe(true)
    expect(DEFAULT_PERMISSIONS_CONFIG.seekProtocolPermissionsForEncrypting).toBe(false)
    expect(DEFAULT_PERMISSIONS_CONFIG.seekSpendingPermissions).toBe(true)
  })

  test('a config with no counterparty choice requires permission and keeps other stored choices', () => {
    const stored = storedBeforeSplit()
    expect(stored).not.toHaveProperty('seekPermissionsForCounterpartyKeyLinkageRevelation')
    expect(stored).not.toHaveProperty('seekPermissionsForSpecificKeyLinkageRevelation')

    const merged = mergeStoredPermissionsConfig(stored)

    expect(merged.seekPermissionsForCounterpartyKeyLinkageRevelation).toBe(true)
    expect(merged.seekPermissionsForSpecificKeyLinkageRevelation).toBe(false)
    expect(merged.seekPermissionsForKeyLinkageRevelation).toBe(false)
    expect(merged.seekProtocolPermissionsForEncrypting).toBe(true)
    expect(merged.seekBasketInsertionPermissions).toBe(true)
    expect(merged.seekProtocolPermissionsForSigning).toBe(true)
    expect(merged.seekSpendingPermissions).toBe(true)
    expect(merged.seekPermissionsForPublicKeyRevelation).toBe(false)
  })

  test('a stored specific-linkage choice survives when counterparty was never stored', () => {
    const merged = mergeStoredPermissionsConfig(storedBeforeSplit({
      seekPermissionsForSpecificKeyLinkageRevelation: true
    }))
    expect(merged.seekPermissionsForCounterpartyKeyLinkageRevelation).toBe(true)
    expect(merged.seekPermissionsForSpecificKeyLinkageRevelation).toBe(true)
    expect(merged.seekPermissionsForKeyLinkageRevelation).toBe(false)
    expect(merged.seekProtocolPermissionsForEncrypting).toBe(true)
  })

  test('an explicit counterparty or specific choice is not overwritten', () => {
    const merged = mergeStoredPermissionsConfig(storedBeforeSplit({
      seekPermissionsForCounterpartyKeyLinkageRevelation: false,
      seekPermissionsForSpecificKeyLinkageRevelation: true,
      seekPermissionsForKeyLinkageRevelation: false,
      seekSpendingPermissions: false
    }))

    expect(merged.seekPermissionsForCounterpartyKeyLinkageRevelation).toBe(false)
    expect(merged.seekPermissionsForSpecificKeyLinkageRevelation).toBe(true)
    expect(merged.seekPermissionsForKeyLinkageRevelation).toBe(false)
    expect(merged.seekSpendingPermissions).toBe(false)
  })

  test('a non-boolean counterparty value falls back to the security default', () => {
    const merged = mergeStoredPermissionsConfig({
      seekPermissionsForCounterpartyKeyLinkageRevelation: null,
      seekPermissionsForSpecificKeyLinkageRevelation: 'no',
      seekPermissionsForKeyLinkageRevelation: false
    })
    expect(merged.seekPermissionsForCounterpartyKeyLinkageRevelation).toBe(true)
    expect(merged.seekPermissionsForSpecificKeyLinkageRevelation).toBe(false)
    expect(merged.seekPermissionsForKeyLinkageRevelation).toBe(false)
  })

  test('missing or unusable stored config is the defaults', () => {
    for (const stored of [null, undefined, [], 'nope', 1]) {
      expect(mergeStoredPermissionsConfig(stored)).toEqual(DEFAULT_PERMISSIONS_CONFIG)
    }
  })

  test('the permissions manager is constructed with both split flags', () => {
    vi.stubGlobal('window', {})
    const queue = new PermissionQueueManager()
    queue.permissionsConfig = mergeStoredPermissionsConfig(storedBeforeSplit())
    const pm = queue.createPermissionsManager({} as WalletInterface)
    expect((pm as unknown as { config: PermissionsConfig }).config).toMatchObject({
      seekPermissionsForCounterpartyKeyLinkageRevelation: true,
      seekPermissionsForSpecificKeyLinkageRevelation: false,
      // Stored choice, not the new default.
      seekPermissionsForKeyLinkageRevelation: false,
      seekProtocolPermissionsForEncrypting: true,
      seekBasketInsertionPermissions: true
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
