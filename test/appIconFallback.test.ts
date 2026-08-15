import { describe, expect, it } from 'vitest'
import { applyAppIconFallback, FALLBACK_APP_ICON } from '../src/lib/utils/appIconFallback'

describe('applyAppIconFallback', () => {
  it('uses the fallback after an app icon fails', () => {
    const image = { src: 'https://example.com/missing-icon.png' }

    applyAppIconFallback(image)

    expect(image.src).toBe(FALLBACK_APP_ICON)
  })

  it('does not reassign a failed fallback', () => {
    let assignments = 0
    const image = {
      get src() {
        return FALLBACK_APP_ICON
      },
      set src(_value: string) {
        assignments += 1
      }
    }

    applyAppIconFallback(image)

    expect(assignments).toBe(0)
  })
})
