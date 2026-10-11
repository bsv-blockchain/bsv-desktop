/**
 * Wallet profiles for modern recovery-phrase wallets: one phrase, many wallets.
 *
 * Profile n is the wallet whose primary key is m/0'/n' and whose privileged key
 * is m/1'/n' (see `profilePaths`), the same scheme as BSV Wallet. Profile 0 is
 * the wallet every modern desktop wallet already has, so nothing changes for it.
 * Each profile has its own identity key, and so its own database file, monitor
 * and app permissions; the phrase and its backups are shared.
 *
 * The manager exposes the same `listProfiles` / `addProfile` / `switchProfile`
 * surface as `CWIStyleWalletManager`, so the existing profile dialog drives it.
 * The profile list is not secret (indices, names, identity keys) and is saved in
 * the snapshot config by WalletService.
 *
 * Indices are append-only and never reused: a profile's index is its derivation
 * path. On a new device, adding profiles in the same order brings back the same
 * identities.
 */
import { SimpleWalletManager, PrivilegedKeyManager } from '@bsv/wallet-toolbox-client'
import { Utils } from '@bsv/sdk'
import { deriveMnemonicWallet } from '../utils/mnemonicRecovery'
import type { WalletProfile } from '../types/WalletProfile'

export type MnemonicProfileRecord = {
  index: number
  name: string
  /** Public. Recorded once derived so listing never repeats the seed derivation. */
  identityKey?: string
}

export type MnemonicProfilesState = {
  active: number
  profiles: MnemonicProfileRecord[]
}

export type MnemonicProfileMaterial = ReturnType<typeof deriveMnemonicWallet>

/** A sanity bound, not a product limit. */
export const MAX_MNEMONIC_PROFILES = 100
export const MAX_PROFILE_NAME_LENGTH = 60
const DEFAULT_PROFILE_NAME = 'Default'

const defaultName = (index: number) => index === 0 ? DEFAULT_PROFILE_NAME : `Profile ${index + 1}`

export function defaultMnemonicProfiles(): MnemonicProfilesState {
  return { active: 0, profiles: [{ index: 0, name: DEFAULT_PROFILE_NAME }] }
}

/**
 * Tolerant parse of the saved profile list. Anything unreadable becomes profile
 * 0 alone; the list is kept dense from 0 so every index names one record.
 */
export function parseMnemonicProfiles(raw: unknown): MnemonicProfilesState {
  const obj = raw as Partial<MnemonicProfilesState> | null | undefined
  if (!obj || !Array.isArray(obj.profiles)) return defaultMnemonicProfiles()
  const byIndex = new Map<number, MnemonicProfileRecord>()
  for (const entry of obj.profiles as unknown[]) {
    const r = entry as Partial<MnemonicProfileRecord> | null
    if (!r || !Number.isInteger(r.index) || r.index! < 0 || r.index! >= MAX_MNEMONIC_PROFILES || byIndex.has(r.index!)) continue
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_PROFILE_NAME_LENGTH) : ''
    byIndex.set(r.index!, {
      index: r.index!,
      name: name || defaultName(r.index!),
      ...(typeof r.identityKey === 'string' && /^0[23][0-9a-f]{64}$/.test(r.identityKey) ? { identityKey: r.identityKey } : {}),
    })
  }
  const profiles: MnemonicProfileRecord[] = []
  for (let i = 0; byIndex.has(i); i++) profiles.push(byIndex.get(i)!)
  if (profiles.length === 0) return defaultMnemonicProfiles()
  const active = Number.isInteger(obj.active) && obj.active! >= 0 && obj.active! < profiles.length ? obj.active! : 0
  return { active, profiles }
}

export class MnemonicProfileWalletManager extends SimpleWalletManager {
  private _profiles: MnemonicProfilesState

  constructor(
    adminOriginator: string,
    walletBuilder: (primaryKey: number[], privilegedKeyManager: PrivilegedKeyManager) => Promise<any>,
    private readonly getMnemonic: () => string | null | undefined,
    profiles: MnemonicProfilesState = defaultMnemonicProfiles()
  ) {
    super(adminOriginator, walletBuilder as any)
    this._profiles = parseMnemonicProfiles(profiles)
  }

  get profileState(): MnemonicProfilesState {
    return { active: this._profiles.active, profiles: this._profiles.profiles.map(p => ({ ...p })) }
  }

  /** The primary key of the wallet that is open, if any. */
  get openPrimaryKey(): number[] | undefined {
    return (this as any).primaryKey
  }

  private get hasWallet(): boolean {
    return !!(this as any).underlying
  }

  get activeProfileIndex(): number {
    return this._profiles.active
  }

  get activeProfileRecord(): MnemonicProfileRecord {
    return { ...this._profiles.profiles[this._profiles.active] }
  }

  /** Keys of profile `index` from the saved phrase. */
  deriveProfile(index: number): MnemonicProfileMaterial {
    const mnemonic = this.getMnemonic()?.trim()
    if (!mnemonic) throw new Error('The recovery phrase is not available on this device.')
    return deriveMnemonicWallet(mnemonic, index)
  }

  /** Open the active profile, from already-derived material when the caller has it. */
  async unlockActiveProfile(material?: MnemonicProfileMaterial): Promise<void> {
    const keys = material ?? this.deriveProfile(this._profiles.active)
    if (keys.profileIndex !== this._profiles.active) throw new Error('These keys belong to a different profile.')
    await this.openProfile(keys)
  }

  listProfiles(): WalletProfile[] {
    return this._profiles.profiles.map(record => {
      const identityKey = this.identityKeyOf(record)
      return {
        id: Utils.toArray(identityKey, 'hex'),
        name: record.name,
        createdAt: null,
        active: record.index === this._profiles.active,
        identityKey,
      }
    })
  }

  /** Append the next profile. Does not switch to it, like CWIStyleWalletManager. */
  async addProfile(name: string): Promise<number[]> {
    const trimmed = (name || '').trim().slice(0, MAX_PROFILE_NAME_LENGTH)
    if (!trimmed) throw new Error('Enter a profile name.')
    if (this._profiles.profiles.some(p => p.name.toLowerCase() === trimmed.toLowerCase()) || trimmed.toLowerCase() === DEFAULT_PROFILE_NAME.toLowerCase()) {
      throw new Error(`Profile name "${trimmed}" is already in use.`)
    }
    const index = this._profiles.profiles.length
    if (index >= MAX_MNEMONIC_PROFILES) throw new Error('No more profiles can be added.')
    const { identityKey } = this.deriveProfile(index)
    this._profiles = { ...this._profiles, profiles: [...this._profiles.profiles, { index, name: trimmed, identityKey }] }
    return Utils.toArray(identityKey, 'hex')
  }

  /** Rebuild the wallet with another profile's keys. A failure reopens the previous profile. */
  async switchProfile(profileId: number[]): Promise<void> {
    const targetKey = Utils.toHex(profileId)
    const target = this._profiles.profiles.find(record => this.identityKeyOf(record) === targetKey)
    if (!target) throw new Error('Profile not found.')
    const previous = this._profiles.active
    if (target.index === previous && this.authenticated && this.hasWallet) return
    const material = this.deriveProfile(target.index)
    // Active before the build, so the wallet builder already sees the new profile.
    this._profiles = { ...this._profiles, active: target.index }
    try {
      await this.openProfile(material)
    } catch (error) {
      this._profiles = { ...this._profiles, active: previous }
      try {
        await this.openProfile(this.deriveProfile(previous))
      } catch (restoreError) {
        console.error('[MnemonicProfileWalletManager] Previous profile could not reopen:', restoreError)
      }
      throw error
    }
  }

  private identityKeyOf(record: MnemonicProfileRecord): string {
    if (!record.identityKey) record.identityKey = this.deriveProfile(record.index).identityKey
    return record.identityKey
  }

  private async openProfile(material: MnemonicProfileMaterial): Promise<void> {
    // Stamped before the build, so the builder can name the profile without deriving again.
    const record = this._profiles.profiles[material.profileIndex]
    if (record && !record.identityKey) record.identityKey = material.identityKey
    // SimpleWalletManager refuses to build twice; drop the current wallet first.
    if (this.authenticated) this.destroy()
    await this.providePrimaryKey(material.keyBytes)
    await this.providePrivilegedKeyManager(new PrivilegedKeyManager(async () => material.privilegedKey))
    // WalletService's builder reports failure by returning null rather than throwing.
    if (!this.hasWallet) {
      this.destroy()
      throw new Error('This profile could not be opened.')
    }
  }
}
