import type { LoginType } from '../../WalletContext'

/** A recovery flow linked from the saved-wallet unlock screen. */
export type RecoveryOption = 'presentation-key' | 'password'

/**
 * The recovery flows this login type's wallet manager has the methods for.
 *
 * Each flow calls methods only some managers have (see WalletService):
 * - 'presentation-key' (recovery key + password) needs a CWIStyleWalletManager,
 *   built for 'wab' and 'mnemonic-advanced'.
 * - 'password' (phone code + presentation key + recovery key) also needs
 *   startAuth/completeAuth, which only the WAB manager has.
 * 'direct-key' uses a SimpleWalletManager and 'mnemonic' a
 * MnemonicProfileWalletManager (a SimpleWalletManager), which have neither.
 */
export function recoveryOptionsFor(loginType: LoginType): RecoveryOption[] {
  switch (loginType) {
    case 'wab':
      return ['presentation-key', 'password']
    case 'mnemonic-advanced':
      return ['presentation-key']
    default:
      return []
  }
}
