import { describe, expect, it } from 'vitest'
import { addProfileWithRollback } from '../src/lib/utils/addProfileWithRollback'

/** Mirrors CWIStyleWalletManager.addProfile: push first, then save (which can throw). */
function manager(save: () => Promise<void>) {
  return {
    profiles: [] as { name: string }[],
    async addProfile(name: string) {
      if (this.profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`Profile name "${name}" is already in use.`)
      this.profiles.push({ name })
      await save()
      return [1]
    },
  }
}

describe('addProfileWithRollback (#81)', () => {
  it('lets the same name be retried after the save fails', async () => {
    const failing = manager(async () => { throw new Error('Failed to decrypt factor "passwordKey": Decryption failed!') })
    await expect(addProfileWithRollback(failing, 'Work')).rejects.toThrow(/could not be unlocked. Nothing was changed/)
    expect(failing.profiles).toEqual([])
    await expect(addProfileWithRollback(failing, 'Work')).rejects.not.toThrow(/already in use/)
  })

  it('keeps a profile that saved', async () => {
    const ok = manager(async () => {})
    await addProfileWithRollback(ok, 'Work')
    expect(ok.profiles).toEqual([{ name: 'Work' }])
  })
})
