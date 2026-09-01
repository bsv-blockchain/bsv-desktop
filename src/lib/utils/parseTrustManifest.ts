import { PublicKey } from '@bsv/sdk'

export type TrustManifestSource = 'metanet' | 'babbage'

export interface TrustManifestDetails {
  name: string
  note: string
  icon: string
  publicKey: string
}

export interface ParsedTrustManifest {
  source: TrustManifestSource
  trust: TrustManifestDetails
}

export type TrustManifestErrorCode =
  | 'invalid-domain'
  | 'insecure-domain'
  | 'timeout'
  | 'fetch-failed'
  | 'http-status'
  | 'invalid-json'
  | 'unsupported-manifest'
  | 'invalid-schema'

export class TrustManifestError extends Error {
  code: TrustManifestErrorCode

  constructor(code: TrustManifestErrorCode, message: string) {
    super(message)
    this.name = 'TrustManifestError'
    this.code = code
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isFqdn = (hostname: string): boolean => {
  if (
    hostname.length > 253 ||
    !hostname.includes('.') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) return false

  return hostname.split('.').every(label => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ))
}

/**
 * Converts a user-entered domain into the single BRC-68 manifest location.
 * BRC-68 only permits HTTPS on a fully qualified domain name.
 */
export const buildTrustManifestUrl = (domain: string): string => {
  const input = domain.trim()
  if (!input) {
    throw new TrustManifestError('invalid-domain', 'Enter a fully qualified domain name')
  }

  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
  let url: URL

  try {
    url = new URL(hasProtocol ? input : `https://${input}`)
  } catch (_) {
    throw new TrustManifestError('invalid-domain', 'Enter a valid fully qualified domain name')
  }

  if (url.protocol !== 'https:') {
    throw new TrustManifestError('insecure-domain', 'BRC-68 trust manifests must be loaded over HTTPS')
  }
  if (url.username || url.password || url.port || (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
    throw new TrustManifestError('invalid-domain', 'Enter a domain name without a port, path, query, or credentials')
  }
  if (!isFqdn(url.hostname)) {
    throw new TrustManifestError('invalid-domain', 'BRC-68 trust manifests require a fully qualified domain name')
  }

  return `https://${url.hostname}/manifest.json`
}

const readTrustDetails = (value: unknown): TrustManifestDetails => {
  if (!isRecord(value)) {
    throw new TrustManifestError('invalid-schema', 'The BRC-68 trust entry must be an object')
  }

  const { name, note, icon, publicKey } = value
  if (typeof name !== 'string' || name.length < 5 || name.length > 30) {
    throw new TrustManifestError('invalid-schema', 'BRC-68 trust name must be 5-30 characters')
  }
  if (typeof note !== 'string' || note.length < 5 || note.length > 50) {
    throw new TrustManifestError('invalid-schema', 'BRC-68 trust note must be 5-50 characters')
  }
  if (typeof icon !== 'string') {
    throw new TrustManifestError('invalid-schema', 'BRC-68 trust icon must be a valid HTTPS URL')
  }

  try {
    const iconUrl = new URL(icon)
    if (iconUrl.protocol !== 'https:') throw new Error('insecure icon')
  } catch (_) {
    throw new TrustManifestError('invalid-schema', 'BRC-68 trust icon must be a valid HTTPS URL')
  }

  if (typeof publicKey !== 'string' || !/^(02|03)[a-f0-9]{64}$/i.test(publicKey)) {
    throw new TrustManifestError('invalid-schema', 'BRC-68 trust public key must be a compressed secp256k1 public key')
  }

  try {
    PublicKey.fromString(publicKey)
  } catch (_) {
    throw new TrustManifestError('invalid-schema', 'BRC-68 trust public key must be a compressed secp256k1 public key')
  }

  return { name, note, icon, publicKey: publicKey.toLowerCase() }
}

/**
 * Parses the trust entry using the canonical BRC-68 namespace. The deprecated
 * `babbage` namespace is considered only when `metanet` is entirely absent,
 * preventing a malformed canonical entry from silently downgrading to legacy.
 */
export const parseTrustManifest = (manifest: unknown): ParsedTrustManifest => {
  if (!isRecord(manifest)) {
    throw new TrustManifestError('invalid-schema', 'The BRC-68 manifest must be a JSON object')
  }

  if (Object.prototype.hasOwnProperty.call(manifest, 'metanet')) {
    if (!isRecord(manifest.metanet) || !Object.prototype.hasOwnProperty.call(manifest.metanet, 'trust')) {
      throw new TrustManifestError('unsupported-manifest', 'This domain does not publish metanet.trust as required by BRC-68')
    }

    return {
      source: 'metanet',
      trust: readTrustDetails(manifest.metanet.trust)
    }
  }

  if (isRecord(manifest.babbage) && Object.prototype.hasOwnProperty.call(manifest.babbage, 'trust')) {
    console.warn('Deprecated BRC-68 manifest namespace: migrate babbage.trust to metanet.trust')
    return {
      source: 'babbage',
      trust: readTrustDetails(manifest.babbage.trust)
    }
  }

  throw new TrustManifestError('unsupported-manifest', 'This domain does not publish metanet.trust as required by BRC-68')
}

interface FetchTrustManifestOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const timeoutError = (timeoutMs: number) => new TrustManifestError(
  'timeout',
  `The domain did not respond within ${Math.ceil(timeoutMs / 1000)} seconds`
)

/** Fetches and parses a BRC-68 manifest with bounded HTTPS I/O. */
export const fetchTrustManifest = async (
  domain: string,
  { timeoutMs = 15_000, fetchImpl = globalThis.fetch }: FetchTrustManifestOptions = {}
): Promise<ParsedTrustManifest> => {
  const url = buildTrustManifestUrl(domain)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response: Response
    try {
      response = await fetchImpl(url, { signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        throw timeoutError(timeoutMs)
      }
      throw new TrustManifestError('fetch-failed', 'Could not fetch the BRC-68 trust manifest')
    }

    if (!response.ok) {
      throw new TrustManifestError('http-status', `The BRC-68 trust manifest returned HTTP ${response.status}`)
    }

    let manifest: unknown
    try {
      manifest = await response.json()
    } catch (_) {
      if (controller.signal.aborted) throw timeoutError(timeoutMs)
      throw new TrustManifestError('invalid-json', 'The BRC-68 trust manifest is not valid JSON')
    }

    return parseTrustManifest(manifest)
  } finally {
    clearTimeout(timer)
  }
}

export default fetchTrustManifest
