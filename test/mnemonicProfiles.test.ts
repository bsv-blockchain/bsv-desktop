import { describe, expect, test, vi } from 'vitest'
import { HD, Mnemonic, PrivateKey, Utils } from '@bsv/sdk'
import { deriveMnemonicWallet, profilePaths } from '../src/lib/utils/mnemonicRecovery'
import { MnemonicProfileWalletManager, parseMnemonicProfiles } from '../src/lib/services/MnemonicProfileWalletManager'

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// Reference vectors produced by bsv-wallet's `deriveProfileKeys(hdFromMnemonic(PHRASE), n)`
// (packages/expo-wallet-toolbox/core/mnemonicWallet.ts). Desktop profiles must match them.
const BSV_WALLET_VECTORS = [
  { identityKey: '02f32dbd49d7a3539d9de0f007726c523ca4312b7c8eab26b018b86e0d17d460f6', privileged: '02abd5eb4cebfb037d97f744baab2a3f979ba01f024525899a77840cd927b7a2c8' },
  { identityKey: '02cc06c6d72a54bb396267c1cd1aabaa8b58507857db58489718aefc9b9874bde6', privileged: '03ab8ec969f11a8b862e56d13d37bdc8187e02e60d60525b09d24228d2e3bca7cf' },
  { identityKey: '036106c200eba9b150a81e71065e88e35b8f3c711df85b032fcbd5df1c376aecb8', privileged: '030902f67d7ef00770fa4cf032fe8ade8428d3d38fc4501642ca28b289946cf580' },
]

describe('profile derivation', () => {
  test('profile n uses m/0\'/n\' and m/1\'/n\'', () => {
    expect(profilePaths(0)).toEqual({ primary: "m/0'/0'", privileged: "m/1'/0'" })
    expect(profilePaths(7)).toEqual({ primary: "m/0'/7'", privileged: "m/1'/7'" })
  })

  test('rejects invalid indices', () => {
    for (const bad of [-1, 1.5, 2 ** 31, Number.NaN]) expect(() => profilePaths(bad)).toThrow()
  })

  test('the default profile is unchanged', () => {
    const root = HD.fromSeed(Mnemonic.fromString(PHRASE).toSeed())
    const expected = root.derive("m/0'/0'").privKey
    expect(deriveMnemonicWallet(PHRASE).keyHex).toBe(expected.toHex().padStart(64, '0'))
    expect(deriveMnemonicWallet(PHRASE, 0).keyHex).toBe(deriveMnemonicWallet(PHRASE).keyHex)
  })

  test('matches bsv-wallet profiles 0, 1 and 2', () => {
    BSV_WALLET_VECTORS.forEach((vector, n) => {
      const material = deriveMnemonicWallet(PHRASE, n)
      expect(material.identityKey).toBe(vector.identityKey)
      expect(material.privilegedKey.toPublicKey().toString()).toBe(vector.privileged)
      expect(material.profileIndex).toBe(n)
    })
  })
})

describe('parseMnemonicProfiles', () => {
  test('missing or corrupt state is profile 0 alone', () => {
    expect(parseMnemonicProfiles(undefined)).toEqual({ active: 0, profiles: [{ index: 0, name: 'Default' }] })
    expect(parseMnemonicProfiles({ active: 3, profiles: 'nope' })).toEqual({ active: 0, profiles: [{ index: 0, name: 'Default' }] })
  })

  test('keeps a dense list and clamps the active index', () => {
    const parsed = parseMnemonicProfiles({
      active: 9,
      profiles: [{ index: 1, name: 'Work' }, { index: 0, name: 'Default' }, { index: 3, name: 'Gap' }, { index: 1, name: 'Dup' }],
    })
    expect(parsed).toEqual({ active: 0, profiles: [{ index: 0, name: 'Default' }, { index: 1, name: 'Work' }] })
  })
})

function makeManager(state?: unknown) {
  const built: Array<{ identityKey: string; privileged: PrivateKey }> = []
  const builder = vi.fn(async (primaryKey: number[], pkm: any) => {
    built.push({ identityKey: new PrivateKey(primaryKey).toPublicKey().toString(), privileged: await pkm.getPrivilegedKey('test') })
    return {} as any
  })
  const manager = new MnemonicProfileWalletManager('admin.test', builder, () => PHRASE, parseMnemonicProfiles(state))
  return { manager, built, builder }
}

describe('MnemonicProfileWalletManager', () => {
  test('unlocks the active profile', async () => {
    const { manager, built } = makeManager({ active: 1, profiles: [{ index: 0, name: 'Default' }, { index: 1, name: 'Work' }] })
    await manager.unlockActiveProfile()
    expect(built.map(b => b.identityKey)).toEqual([BSV_WALLET_VECTORS[1].identityKey])
    expect(built[0].privileged.toPublicKey().toString()).toBe(BSV_WALLET_VECTORS[1].privileged)
    expect(Utils.toHex(manager.primaryKey!)).toBe(deriveMnemonicWallet(PHRASE, 1).keyHex)
  })

  test('lists profiles with identity-key ids; profile 0 keeps the existing id', async () => {
    const { manager } = makeManager()
    await manager.unlockActiveProfile()
    await manager.addProfile('Work')
    const profiles = manager.listProfiles()
    expect(profiles.map(p => p.name)).toEqual(['Default', 'Work'])
    expect(profiles.map(p => p.identityKey)).toEqual([BSV_WALLET_VECTORS[0].identityKey, BSV_WALLET_VECTORS[1].identityKey])
    expect(profiles[0].id).toEqual(Utils.toArray(BSV_WALLET_VECTORS[0].identityKey, 'hex'))
    expect(profiles.map(p => p.active)).toEqual([true, false])
  })

  test('addProfile appends the next index without switching', async () => {
    const { manager, builder } = makeManager()
    await manager.unlockActiveProfile()
    await manager.addProfile('Work')
    await manager.addProfile('Savings')
    expect(manager.profileState.profiles.map(p => p.index)).toEqual([0, 1, 2])
    expect(manager.profileState.active).toBe(0)
    expect(builder).toHaveBeenCalledTimes(1)
  })

  test('addProfile rejects duplicate or empty names', async () => {
    const { manager } = makeManager()
    await manager.unlockActiveProfile()
    await expect(manager.addProfile('  ')).rejects.toThrow()
    await expect(manager.addProfile('default')).rejects.toThrow()
  })

  test('renameProfile renames any profile, Default included, without rebuilding', async () => {
    const { manager, builder } = makeManager()
    await manager.unlockActiveProfile()
    await manager.addProfile('Work')
    await manager.renameProfile(Utils.toArray(BSV_WALLET_VECTORS[0].identityKey, 'hex'), '  Personal  ')
    await manager.renameProfile(Utils.toArray(BSV_WALLET_VECTORS[1].identityKey, 'hex'), 'Business')
    expect(manager.listProfiles().map(p => p.name)).toEqual(['Personal', 'Business'])
    expect(manager.profileState.profiles.map(p => p.index)).toEqual([0, 1])
    expect(builder).toHaveBeenCalledTimes(1)
    // The freed name is available again, and the renamed state survives a save and reload.
    await manager.addProfile('Default')
    expect(parseMnemonicProfiles(JSON.parse(JSON.stringify(manager.profileState))).profiles.map(p => p.name)).toEqual(['Personal', 'Business', 'Default'])
  })

  test('renameProfile rejects empty, duplicate or unknown targets', async () => {
    const { manager } = makeManager()
    await manager.unlockActiveProfile()
    await manager.addProfile('Work')
    const defaultId = Utils.toArray(BSV_WALLET_VECTORS[0].identityKey, 'hex')
    await expect(manager.renameProfile(defaultId, ' ')).rejects.toThrow()
    await expect(manager.renameProfile(defaultId, 'work')).rejects.toThrow('already in use')
    await expect(manager.renameProfile([1, 2, 3], 'Other')).rejects.toThrow('Profile not found')
    // Changing only the case of its own name is fine.
    await manager.renameProfile(defaultId, 'DEFAULT')
    expect(manager.listProfiles()[0].name).toBe('DEFAULT')
  })

  test('switchProfile rebuilds the wallet with that profile\'s keys', async () => {
    const { manager, built } = makeManager()
    await manager.unlockActiveProfile()
    await manager.addProfile('Work')
    await manager.addProfile('Savings')
    await manager.switchProfile(Utils.toArray(BSV_WALLET_VECTORS[2].identityKey, 'hex'))
    expect(manager.profileState.active).toBe(2)
    expect(built.at(-1)!.identityKey).toBe(BSV_WALLET_VECTORS[2].identityKey)
    expect(built.at(-1)!.privileged.toPublicKey().toString()).toBe(BSV_WALLET_VECTORS[2].privileged)
    await manager.switchProfile(Utils.toArray(BSV_WALLET_VECTORS[0].identityKey, 'hex'))
    expect(manager.profileState.active).toBe(0)
    expect(built.at(-1)!.identityKey).toBe(BSV_WALLET_VECTORS[0].identityKey)
  })

  test('a failed switch reopens the previous profile', async () => {
    const { manager, built, builder } = makeManager()
    await manager.unlockActiveProfile()
    await manager.addProfile('Work')
    builder.mockImplementationOnce(async () => null as any)
    await expect(manager.switchProfile(Utils.toArray(BSV_WALLET_VECTORS[1].identityKey, 'hex'))).rejects.toThrow()
    expect(manager.profileState.active).toBe(0)
    expect(built.at(-1)!.identityKey).toBe(BSV_WALLET_VECTORS[0].identityKey)
    expect(manager.authenticated).toBe(true)
  })

  test('switchProfile rejects an unknown id', async () => {
    const { manager } = makeManager()
    await manager.unlockActiveProfile()
    await expect(manager.switchProfile([1, 2, 3])).rejects.toThrow('Profile not found')
  })
})
