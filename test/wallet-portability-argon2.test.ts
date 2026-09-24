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
// Plain Node >= 24.7 implements crypto.argon2, while Electron's BoringSSL build
// throws ERR_CRYPTO_ARGON2_NOT_SUPPORTED. Both paths must derive the same key
// or archives would not open across the two runtimes.
const nativeArgon2 = (await import('node:crypto') as any).argon2
const notSupported = () => { throw Object.assign(new Error('unsupported'), { code: 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED' }) }
it.skipIf(typeof nativeArgon2 !== 'function')('derives the same key through native crypto.argon2 as through hash-wasm', async () => {
  const exportParameters = { password: new TextEncoder().encode('correct horse'), salt: new Uint8Array(16).fill(7), iterations: 7, memorySize: 131072, parallelism: 1, hashLength: 32 }
  for (const parameters of [options, exportParameters]) {
    expect(Buffer.from(await deriveArchiveKey(parameters)).toString('hex'))
      .toBe(Buffer.from(await deriveArchiveKey(parameters, notSupported)).toString('hex'))
  }
})
