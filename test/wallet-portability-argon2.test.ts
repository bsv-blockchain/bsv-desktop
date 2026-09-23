import { expect, it } from 'vitest'
import { deriveArchiveKey } from '../electron/wallet-portability/argon2'
const options = { password: new TextEncoder().encode('password'), salt: new TextEncoder().encode('somesalt'), iterations: 3, memorySize: 32, parallelism: 4, hashLength: 32 }
it('uses the interoperable portable backend when Electron exposes an unsupported algorithm', async () => {
  const key = await deriveArchiveKey(options, () => { throw Object.assign(new Error('unsupported'), { code: 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED' }) })
  expect(Buffer.from(key).toString('hex')).toBe('bb0cc80a3e671149526915418c6eefe761bb19d5d2d567a017703e0cea6ab05c')
})
it('propagates native failures other than an unavailable algorithm', async () => {
  await expect(deriveArchiveKey(options, () => { throw new Error('allocation failed') })).rejects.toThrow('allocation failed')
})
