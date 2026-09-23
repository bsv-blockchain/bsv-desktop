import { describe, expect, it } from 'vitest'
import { buildTrustedCertifier, certifierIconUrl } from '../src/lib/pages/Dashboard/Trust/certifier'

const identityKey = `02${'aa'.repeat(32)}`

describe('trusted certifier icon', () => {
  it('stores the imported manifest icon as iconUrl, which the Trust list renders', () => {
    const certifier = buildTrustedCertifier({
      name: 'Sigma Identity',
      description: 'Identity certifier',
      icon: 'https://auth.sigmaidentity.com/icon.png',
      identityKey
    })

    expect(certifier).toEqual({
      name: 'Sigma Identity',
      description: 'Identity certifier',
      iconUrl: 'https://auth.sigmaidentity.com/icon.png',
      identityKey,
      trust: 5
    })
    expect(certifier).not.toHaveProperty('icon')
    expect(certifierIconUrl(certifier)).toBe('https://auth.sigmaidentity.com/icon.png')
  })

  it('still renders entries saved with the legacy icon field', () => {
    const legacy = { name: 'Old', description: '', identityKey, trust: 5, icon: 'https://old.example/icon.png' }

    expect(certifierIconUrl(legacy)).toBe('https://old.example/icon.png')
  })

  it('prefers iconUrl when both fields are present', () => {
    expect(certifierIconUrl({
      name: 'Both', description: '', identityKey, trust: 5,
      iconUrl: 'https://new.example/icon.png', icon: 'https://old.example/icon.png'
    })).toBe('https://new.example/icon.png')
  })
})
