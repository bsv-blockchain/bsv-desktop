import { Utils } from '@bsv/sdk'
import type { WalletServiceSnapshot } from './WalletService'

type SnapshotSource = { getSnapshot(): WalletServiceSnapshot }
const notReady = () => new Error('The wallet is not ready for app requests.')

/** Whether the wallet has finished building and can serve app requests. */
export function isAppWalletReady(snapshot: WalletServiceSnapshot): boolean {
  const { wallet, managers, activeProfile } = snapshot
  return snapshot.lifecycle === 'ready' && !snapshot.initializingBackendServices && !!wallet && !!managers.permissionsManager &&
    !!activeProfile?.id?.length && !!activeProfile.identityKey
}

/** A previous profile's permission manager must never be registered as current. */
export function isAppWalletSnapshotCurrent(source: SnapshotSource, snapshot: WalletServiceSnapshot): boolean {
  const current = source.getSnapshot()
  return current.lifecycle === 'ready' && !current.initializingBackendServices && !!current.wallet && !!current.managers.permissionsManager &&
    current.wallet === snapshot.wallet && current.managers.permissionsManager === snapshot.managers.permissionsManager &&
    current.activeProfile?.identityKey === snapshot.activeProfile?.identityKey &&
    !!current.activeProfile?.id?.length && Utils.toBase64(current.activeProfile.id) === Utils.toBase64(snapshot.activeProfile?.id || [])
}

/** Verify readiness and both wallet identities before swapping the HTTP pointer. */
export async function getReadyAppWalletSnapshot(source: SnapshotSource): Promise<WalletServiceSnapshot> {
  const snapshot = source.getSnapshot()
  const { wallet, managers, activeProfile, adminOriginator } = snapshot
  if (!isAppWalletReady(snapshot)) throw notReady()
  const rawIdentity = (await wallet.getPublicKey({ identityKey: true })).publicKey
  if (!isAppWalletSnapshotCurrent(source, snapshot)) throw notReady()
  const appIdentity = (await managers.permissionsManager.getPublicKey({ identityKey: true }, adminOriginator)).publicKey
  if (!isAppWalletSnapshotCurrent(source, snapshot)) throw notReady()
  if (rawIdentity !== activeProfile.identityKey || appIdentity !== rawIdentity) throw new Error('The selected profile does not match the active wallet. App connections remain paused.')
  return snapshot
}
