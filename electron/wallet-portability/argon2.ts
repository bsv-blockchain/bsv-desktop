import * as crypto from 'node:crypto'
import { argon2id } from 'hash-wasm'
import type { ArchiveKdf } from './streamCrypto.js'

type NativeArgon = (algorithm: string, options: any, callback: (error: (Error & { code?: string }) | null, key: Uint8Array) => void) => void
/** Electron can expose Node's API while BoringSSL omits the algorithm. */
export async function deriveArchiveKey(options: ArchiveKdf, native: NativeArgon | undefined = (crypto as any).argon2): Promise<Uint8Array> {
  if (native) {
    try {
      return await new Promise<Uint8Array>((resolve, reject) => native('argon2id', {
        message: options.password, nonce: options.salt, passes: options.iterations,
        memory: options.memorySize, parallelism: options.parallelism, tagLength: options.hashLength
      }, (error, key) => error ? reject(error) : resolve(key)))
    } catch (error) {
      if ((error as { code?: string })?.code !== 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED') throw error
    }
  }
  return await argon2id({ ...options, outputType: 'binary' })
}
