import { Utils } from '@bsv/sdk'

/** The tour starts by itself once per profile, the first time the wallet loads with nothing in it. */
export function tourSeenKey(profileId: number[]): string {
  return `tourSeen_${Utils.toBase64(profileId)}`
}

export function markTourSeen(profileId: number[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(tourSeenKey(profileId), new Date().toISOString()) } catch { /* private mode / blocked storage */ }
}

export function shouldAutoStartTour({ balance, loading, profileId, storage = localStorage }: {
  balance: number | null
  loading: boolean
  profileId: number[] | null | undefined
  storage?: Pick<Storage, 'getItem'>
}): boolean {
  if (loading || balance !== 0 || !profileId?.length) return false
  // Without storage we can't remember it was shown, so don't start it on every launch.
  try { return storage.getItem(tourSeenKey(profileId)) === null } catch { return false }
}
