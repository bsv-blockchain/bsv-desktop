/**
 * Which wallet's transaction status changes the UI should react to.
 *
 * Monitor workers keep running for every identity and chain opened this
 * session, and each reports its own status changes. Only the open wallet's
 * should refresh the views; set here by WalletService when a wallet is built,
 * cleared on logout.
 */

let scope: { identityKey: string, chain: string } | undefined

export function setTxStatusScope(next: { identityKey: string, chain: string } | undefined): void {
  scope = next
}

/** True for a change that belongs to the open wallet (or when none is open). */
export function isInTxStatusScope(event: { identityKey?: string, chain?: string } | undefined): boolean {
  if (scope === undefined) return true
  return event?.identityKey === scope.identityKey && event?.chain === scope.chain
}
