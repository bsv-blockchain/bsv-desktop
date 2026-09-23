import { describe, expect, it } from 'vitest'
import * as electronEndpoints from '../electron/endpoints'
import * as rendererEndpoints from '../src/lib/constants/endpoints'

const CHAINS = ['main', 'test', 'ttn'] as const

describe('default service endpoints', () => {
  it('keeps the electron and renderer copies in sync', () => {
    expect(rendererEndpoints.ARCADE_URLS).toEqual(electronEndpoints.ARCADE_URLS)
  })

  it('serves chaintracks from the arcade base under /chaintracks/v1', () => {
    for (const chain of CHAINS) {
      expect(electronEndpoints.chaintracksUrl(chain)).toBe(
        `${electronEndpoints.arcadeUrl(chain)}/chaintracks/v1`
      )
    }
  })

  it('has no retired babbage.systems or bsvb.tech hosts', () => {
    for (const chain of CHAINS) {
      const urls = [electronEndpoints.arcadeUrl(chain), electronEndpoints.chaintracksUrl(chain)]
      for (const url of urls) {
        expect(url).not.toContain('babbage')
        expect(url).not.toContain('bsvb.tech')
        expect(url.startsWith('https://')).toBe(true)
      }
    }
  })
})
