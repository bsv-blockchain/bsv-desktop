import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTrustManifestUrl,
  fetchTrustManifest,
  parseTrustManifest,
  TrustManifestError
} from '../src/lib/utils/parseTrustManifest'

const canonicalTrust = {
  name: 'Sigma Identity',
  note: 'Certifies verified identity claims',
  icon: 'https://sigmaidentity.com/icon.png',
  publicKey: '02c5046e31396783672648ca8048171cc4f5c97518be4c80318af3a654e175befc'
}

const legacyTrust = {
  name: 'Legacy Trust',
  note: 'Legacy BRC-68 trust provider',
  icon: 'https://legacy.example/icon.png',
  publicKey: '03f028892bad7ed57d2fb57bf33081d5cfcf6f9ed3d3d7f159c2e2fff579dc341a'
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('buildTrustManifestUrl', () => {
  it('normalizes an FQDN to its HTTPS manifest', () => {
    expect(buildTrustManifestUrl('sigmaidentity.com')).toBe('https://sigmaidentity.com/manifest.json')
    expect(buildTrustManifestUrl('https://auth.sigmaidentity.com/')).toBe('https://auth.sigmaidentity.com/manifest.json')
  })

  it.each([
    'http://sigmaidentity.com',
    'localhost:5173',
    'https://sigmaidentity.com:8443',
    'https://127.0.0.1',
    'https://sigmaidentity.com/a/path',
    'https://user:password@sigmaidentity.com'
  ])('rejects an insecure or non-domain manifest origin: %s', input => {
    expect(() => buildTrustManifestUrl(input)).toThrow(TrustManifestError)
  })
})

describe('parseTrustManifest', () => {
  it('reads canonical metanet.trust', () => {
    expect(parseTrustManifest({ metanet: { trust: canonicalTrust } })).toEqual({
      source: 'metanet',
      trust: canonicalTrust
    })
  })

  it('falls back to legacy babbage.trust when metanet is absent', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseTrustManifest({ babbage: { trust: legacyTrust } })).toEqual({
      source: 'babbage',
      trust: legacyTrust
    })
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Deprecated BRC-68'))
  })

  it('prefers canonical data when canonical and legacy entries conflict', () => {
    expect(parseTrustManifest({
      metanet: { trust: canonicalTrust },
      babbage: { trust: legacyTrust }
    })).toEqual({ source: 'metanet', trust: canonicalTrust })
  })

  it('does not downgrade to legacy when the canonical namespace is malformed', () => {
    expect(() => parseTrustManifest({
      metanet: { trust: { ...canonicalTrust, publicKey: 'not-a-key' } },
      babbage: { trust: legacyTrust }
    })).toThrowError(/compressed secp256k1/)
  })

  it.each([
    { metanet: { trust: { ...canonicalTrust, name: 123 } } },
    { metanet: { trust: { ...canonicalTrust, note: 'tiny' } } },
    { metanet: { trust: { ...canonicalTrust, icon: 'http://sigmaidentity.com/icon.png' } } },
    { metanet: { trust: { ...canonicalTrust, publicKey: `04${'a'.repeat(64)}` } } },
    { metanet: { trust: { ...canonicalTrust, publicKey: `02${'0'.repeat(64)}` } } },
    { metanet: {} },
    []
  ])('rejects malformed manifest schema', manifest => {
    expect(() => parseTrustManifest(manifest)).toThrow(TrustManifestError)
  })
})

describe('fetchTrustManifest', () => {
  it('fetches the fixed HTTPS location and returns canonical trust details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ metanet: { trust: canonicalTrust } })
    })

    await expect(fetchTrustManifest('sigmaidentity.com', { fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toEqual({ source: 'metanet', trust: canonicalTrust })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://sigmaidentity.com/manifest.json',
      {
        signal: expect.any(AbortSignal),
        redirect: 'error'
      }
    )
  })

  it('rejects a manifest redirected away from the requested domain', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      redirected: true,
      url: 'https://attacker.example/manifest.json',
      json: vi.fn().mockResolvedValue({ metanet: { trust: canonicalTrust } })
    })

    await expect(fetchTrustManifest('sigmaidentity.com', { fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toMatchObject({ code: 'redirected-manifest' })
  })

  it('checks HTTP status before parsing a response body', async () => {
    const json = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json })

    await expect(fetchTrustManifest('sigmaidentity.com', { fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toMatchObject({ code: 'http-status' })
    expect(json).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('invalid JSON'))
    })

    await expect(fetchTrustManifest('sigmaidentity.com', { fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toMatchObject({ code: 'invalid-json' })
  })

  it('aborts a stalled request at the configured timeout', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    )) as typeof fetch

    const request = fetchTrustManifest('sigmaidentity.com', { fetchImpl, timeoutMs: 250 })
    const assertion = expect(request).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(250)

    await assertion
  })

  it('also applies the timeout while reading a stalled response body', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      } as Response)
    }) as typeof fetch

    const request = fetchTrustManifest('sigmaidentity.com', { fetchImpl, timeoutMs: 250 })
    const assertion = expect(request).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(250)

    await assertion
  })
})
