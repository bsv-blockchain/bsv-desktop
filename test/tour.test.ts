import { describe, it, expect } from 'vitest'
import { TOUR_STEPS, TOUR_TARGETS } from '../src/lib/components/tour/tourSteps'
import { spotlightRect } from '../src/lib/components/tour/tourGeometry'

describe('tour steps', () => {
  it('opens with the use-your-normal-browser message', () => {
    expect(TOUR_STEPS[0].target).toBeUndefined()
    expect(TOUR_STEPS[0].body).toMatch(/normal web browser/i)
    expect(TOUR_STEPS[0].body).toMatch(/approve/i)
  })
  it('has copy for every step and only known targets', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(0)
      expect(step.route.startsWith('/dashboard')).toBe(true)
      if (step.target) expect(TOUR_TARGETS).toContain(step.target)
    }
    expect(new Set(TOUR_STEPS.map(s => s.id)).size).toBe(TOUR_STEPS.length)
  })
  it('ends on the Need help card', () => {
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBe('need-help')
  })
})

describe('spotlightRect', () => {
  const viewport = { width: 1000, height: 800 }
  it('pads the target', () => {
    expect(spotlightRect({ top: 100, left: 100, width: 200, height: 50 }, 8, viewport)).toEqual({ top: 92, left: 92, width: 216, height: 66 })
  })
  it('clamps to the viewport', () => {
    expect(spotlightRect({ top: -20, left: 990, width: 50, height: 50 }, 8, viewport)).toEqual({ top: 0, left: 982, width: 18, height: 38 })
  })
  it('returns null for no target or a hidden one', () => {
    expect(spotlightRect(null, 8, viewport)).toBeNull()
    expect(spotlightRect({ top: 0, left: 0, width: 0, height: 0 }, 8, viewport)).toBeNull()
  })
})
