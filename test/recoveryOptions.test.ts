/**
 * Recovery options by login type (#88)
 *
 * The Recovery page must not offer a flow whose page calls a wallet manager
 * method that the current login type's manager doesn't have: that fails with
 * "walletManager.provideRecoveryKey is not a function". This checks method
 * presence only, not that a flow succeeds for a given account.
 */

import { describe, test, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  CWIStyleWalletManager,
  SimpleWalletManager,
  WalletAuthenticationManager
} from '@bsv/wallet-toolbox-client'
import { recoveryOptionsFor, type RecoveryOption } from '../src/lib/pages/Recovery/recoveryOptions'
import type { LoginType } from '../src/lib/WalletContext'

const RECOVERY_DIR = path.resolve(__dirname, '../src/lib/pages/Recovery')

// The page each option opens.
const PAGES: Record<RecoveryOption, string> = {
  'presentation-key': 'RecoverPresentationKey.tsx',
  password: 'RecoverPassword.tsx'
}

// The manager class WalletService.initialize() builds for each login type.
const MANAGERS: Record<LoginType, { prototype: object }> = {
  wab: WalletAuthenticationManager,
  'direct-key': SimpleWalletManager,
  'mnemonic-advanced': CWIStyleWalletManager
}

/** Every walletManager method a page calls, read from its source. */
function methodsCalledBy(option: RecoveryOption): string[] {
  const source = fs.readFileSync(path.join(RECOVERY_DIR, PAGES[option]), 'utf8')
  const methods = new Set<string>()
  for (const m of source.matchAll(/walletManager!?\??\.(\w+)\(/g)) {
    methods.add(m[1])
  }
  return [...methods]
}

/** The methods a flow calls that the login type's manager lacks. */
function missingMethods(loginType: LoginType, option: RecoveryOption): string[] {
  const proto = MANAGERS[loginType].prototype as Record<string, unknown>
  return methodsCalledBy(option).filter(method => typeof proto[method] !== 'function')
}

const LOGIN_TYPES = Object.keys(MANAGERS) as LoginType[]
const OPTIONS = Object.keys(PAGES) as RecoveryOption[]

describe('recoveryOptionsFor', () => {
  test('each recovery page calls wallet manager methods', () => {
    for (const option of OPTIONS) {
      expect(methodsCalledBy(option).length).toBeGreaterThan(0)
    }
  })

  for (const loginType of LOGIN_TYPES) {
    test(`${loginType}: offers the flows whose manager methods exist, and no others`, () => {
      const offered = recoveryOptionsFor(loginType)
      for (const option of OPTIONS) {
        const missing = missingMethods(loginType, option)
        if (offered.includes(option)) {
          expect(missing, `${option} offered for ${loginType} but the manager lacks`).toEqual([])
        } else {
          expect(missing, `${option} could run for ${loginType} but is not offered`).not.toEqual([])
        }
      }
    })
  }
})
