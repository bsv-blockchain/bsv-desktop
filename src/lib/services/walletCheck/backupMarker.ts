import { Utils } from '@bsv/sdk'

/** When the user last saved, copied or split their recovery phrase, per profile. */
export type ProfileId = number[]

export function backupMarkerKey(profileId: ProfileId): string {
  return `walletBackup_${Utils.toBase64(profileId)}`
}

export function markWalletBackedUp(profileId: ProfileId, storage: Pick<Storage, 'setItem'> = localStorage, now = new Date()): void {
  try { storage.setItem(backupMarkerKey(profileId), now.toISOString()) } catch { /* private mode / blocked storage */ }
}

export function getWalletBackupTime(profileId: ProfileId, storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try { return storage.getItem(backupMarkerKey(profileId)) } catch { return null }
}
