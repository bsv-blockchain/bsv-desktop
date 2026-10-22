/**
 * Whether a wallet storage manager's active store is the local one: the
 * main-process storage behind StorageElectronIPC, the only storage the 1Color
 * broadcast guard covers (contract §8.2). Local stores have no endpoint URL
 * (the same test setPrimaryStorage uses).
 *
 * Fail closed: no active store, more than one (conflicting actives), a remote
 * endpoint, or a manager that throws all mean "not local".
 */

type StoreInfo = { isActive?: boolean, endpointURL?: string }

export function isLocalStoreActive (storageManager: { getStores?: () => StoreInfo[] } | undefined): boolean {
  try {
    const stores = storageManager?.getStores?.()
    if (!Array.isArray(stores)) return false
    const active = stores.filter(s => s?.isActive === true)
    return active.length === 1 && !active[0].endpointURL
  } catch {
    return false
  }
}
