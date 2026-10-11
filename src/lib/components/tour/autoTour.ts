import { Utils } from '@bsv/sdk'

/** The tour starts by itself once, on the default profile, the first time the wallet loads with nothing in it. */
export function tourSeenKey(profileId: number[]): string {
  return `tourSeen_${Utils.toBase64(profileId)}`
}

export function markTourSeen(profileId: number[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(tourSeenKey(profileId), new Date().toISOString()) } catch { /* private mode / blocked storage */ }
}

/**
 * Whether the open profile is the wallet's default (first) one. Profiles added later belong to
 * someone who has already been through the tour. Wallets without profiles only have the default.
 */
export function isDefaultProfile(
  identityKey: string | null | undefined,
  walletManager: { listProfiles?: () => Array<{ identityKey: string }> } | null | undefined,
): boolean {
  if (!identityKey) return false
  if (typeof walletManager?.listProfiles !== 'function') return true
  try { return walletManager.listProfiles()[0]?.identityKey === identityKey } catch { return false }
}

export function shouldAutoStartTour({ balance, loading, profileId, defaultProfile, storage = localStorage }: {
  balance: number | null
  loading: boolean
  profileId: number[] | null | undefined
  defaultProfile: boolean
  storage?: Pick<Storage, 'getItem'>
}): boolean {
  if (loading || balance !== 0 || !profileId?.length || !defaultProfile) return false
  // Without storage we can't remember it was shown, so don't start it on every launch.
  try { return storage.getItem(tourSeenKey(profileId)) === null } catch { return false }
}
