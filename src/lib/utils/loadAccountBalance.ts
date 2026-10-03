import type { WalletInterface } from '@bsv/sdk'
import { sdk as WalletToolboxSdk } from '@bsv/wallet-toolbox-client'

/** Wallet Storage returns the exact satoshi total without paging wallet outputs. */
export async function loadAccountBalance(
  wallet: WalletInterface,
  originator: string,
  basket = 'default'
): Promise<number> {
  const result = await wallet.listOutputs(
    basket === 'default'
      ? { basket: WalletToolboxSdk.specOpWalletBalance }
      : { basket, tags: [WalletToolboxSdk.specOpWalletBalance] },
    originator
  )
  return result.totalOutputs
}
