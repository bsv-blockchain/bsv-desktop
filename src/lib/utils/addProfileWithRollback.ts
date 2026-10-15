/**
 * Adds a wallet profile, undoing the toolbox's in-memory change when saving
 * fails.
 *
 * CWIStyleWalletManager.addProfile pushes the new profile into its list before
 * re-encrypting the account token, and never removes it if that step throws.
 * The name then looks taken ("already in use") until the app restarts, while
 * the profile list still shows only the saved profiles.
 */
export async function addProfileWithRollback(manager: any, name: string): Promise<number[]> {
  const before = Array.isArray(manager?.profiles) ? [...manager.profiles] : null
  try {
    return await manager.addProfile(name)
  } catch (error) {
    if (before) manager.profiles = before
    const message = (error as Error)?.message || String(error)
    if (/decrypt/i.test(message)) {
      throw new Error(`The profile could not be saved because your wallet's account record could not be unlocked. Nothing was changed. (${message})`)
    }
    throw error
  }
}
