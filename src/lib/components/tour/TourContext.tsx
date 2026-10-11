import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useHistory } from 'react-router-dom'
import { TOUR_STEPS } from './tourSteps'
import TourOverlay from './TourOverlay'

interface TourApi { active: boolean; index: number; start(): void; stop(): void; next(): void; back(): void }
const noop = () => {}
const TourContext = createContext<TourApi>({ active: false, index: 0, start: noop, stop: noop, next: noop, back: noop })

export function TourProvider({ children }: { children: React.ReactNode }) {
  const history = useHistory()
  const [index, setIndex] = useState<number | null>(null)
  const go = useCallback((i: number) => {
    const step = TOUR_STEPS[i]
    if (history.location.pathname !== step.route) history.push(step.route)
    setIndex(i)
  }, [history])
  const api = useMemo<TourApi>(() => ({
    active: index !== null,
    index: index ?? 0,
    start: () => go(0),
    stop: () => setIndex(null),
    next: () => { if (index === null) return; index + 1 < TOUR_STEPS.length ? go(index + 1) : setIndex(null) },
    back: () => { if (index !== null && index > 0) go(index - 1) },
  }), [index, go])
  return <TourContext.Provider value={api}>{children}{index !== null && <TourOverlay />}</TourContext.Provider>
}

export const useTour = () => useContext(TourContext)
