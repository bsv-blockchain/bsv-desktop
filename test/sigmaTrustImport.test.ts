import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTrustManifest } from '../src/lib/utils/parseTrustManifest'
import {
  addTrustedCertifier,
  assertMatchingTrustIdentity,
  removeTrustedCertifier,
  trustedCertifierFromManifest,
  updateTrustedCertifier
} from '../src/lib/utils/trustedCertifiers'

const SIGMA_IDENTITY_KEY = '02c5046e31396783672648ca8048171cc4f5c97518be4c80318af3a654e175befc'

const sigmaTrust = {
  name: 'Sigma Identity',
  note: 'Certifies verified identity claims',
  icon: 'https://auth.sigmaidentity.com/sigma-mark.svg',
  publicKey: SIGMA_IDENTITY_KEY
}

const productionManifest = () => ({
  name: 'Sigma Identity',
  metanet: { trust: { ...sigmaTrust } },
  babbage: { trust: { ...sigmaTrust } }
})

const productionManifests = [
  ['auth.sigmaidentity.com', productionManifest()],
  ['sigmaidentity.com', productionManifest()]
] as const

const readTypeScriptSources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return readTypeScriptSources(path)
    if (!/\.tsx?$/.test(entry.name)) return []
    return [readFileSync(path, 'utf8')]
  })

describe('Sigma BRC-68 trust import', () => {
  it.each(productionManifests)('imports the exact Sigma signing key from %s', (_domain, manifest) => {
    const parsed = parseTrustManifest(manifest)
    const certifier = trustedCertifierFromManifest(parsed.trust)

    expect(certifier).toEqual({
      name: 'Sigma Identity',
      description: 'Certifies verified identity claims',
      iconUrl: 'https://auth.sigmaidentity.com/sigma-mark.svg',
      identityKey: SIGMA_IDENTITY_KEY,
      trust: 5
    })
  })

  it('rejects an apex/auth identity mismatch', () => {
    const auth = parseTrustManifest(productionManifest()).trust
    const apex = parseTrustManifest({
      metanet: {
        trust: {
          ...sigmaTrust,
          publicKey: '03f028892bad7ed57d2fb57bf33081d5cfcf6f9ed3d3d7f159c2e2fff579dc341a'
        }
      }
    }).trust

    expect(() => assertMatchingTrustIdentity(auth, apex)).toThrow(/different identity keys/)
  })

  it('rejects duplicates by identity key, including equivalent key casing', () => {
    const sigma = trustedCertifierFromManifest(sigmaTrust)
    const existing = [{ ...sigma, identityKey: sigma.identityKey.toUpperCase() }]

    const result = addTrustedCertifier(existing, sigma)

    expect(result).toEqual({ entities: existing, added: false })
  })

  it('keeps imported trust editable and removable by identity key', () => {
    const sigma = trustedCertifierFromManifest(sigmaTrust)
    const added = addTrustedCertifier([], sigma).entities
    const edited = updateTrustedCertifier(added, SIGMA_IDENTITY_KEY, {
      name: 'My Sigma Trust',
      trust: 8
    })

    expect(edited[0]).toMatchObject({
      name: 'My Sigma Trust',
      identityKey: SIGMA_IDENTITY_KEY,
      trust: 8
    })
    expect(added[0]).toMatchObject({ name: 'Sigma Identity', trust: 5 })
    expect(removeTrustedCertifier(edited, SIGMA_IDENTITY_KEY)).toEqual([])
  })

  it('keeps certificate acquisition from creating trusted certifiers', () => {
    const sourceRoot = fileURLToPath(new URL('../src/lib/', import.meta.url))
    const acquisitionSources = readTypeScriptSources(sourceRoot)
      .filter(source => source.includes('acquireCertificate'))

    expect(acquisitionSources.length).toBeGreaterThan(0)

    for (const source of acquisitionSources) {
      expect(source).not.toContain('addTrustedCertifier')
      expect(source).not.toMatch(/trustedCertifiers\s*\.(?:push|splice)/)
    }
  })
})
