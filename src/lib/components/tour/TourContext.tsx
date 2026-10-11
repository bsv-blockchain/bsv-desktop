import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useHistory } from 'react-router-dom'
import { TOUR_STEPS } from './tourSteps'
import TourOverlay from './TourOverlay'

interface TourApi { active: boolean; index: number; start(): void; stop(): void; next(): void; back(): void }
const noop = () => {}
const TourContext = createContext<TourApi>({ active: false, index: 0, start: noop, stop: noop, next: noop, back: noop })

/** Below 900px the menu is a closed temporary drawer: open it for nav-* steps so their targets exist. */
export function TourProvider({ children, setMenuOpen, compact }: { children: React.ReactNode; setMenuOpen?: (open: boolean) => void; compact?: boolean }) {
  const history = useHistory()
  const [index, setIndex] = useState<number | null>(null)
  const go = useCallback((i: number) => {
    const step = TOUR_STEPS[i]
    if (history.location.pathname !== step.route) history.push(step.route)
    if (compact) setMenuOpen?.(Boolean(step.target?.startsWith('nav-')))
    setIndex(i)
  }, [history, compact, setMenuOpen])
  const end = useCallback(() => {
    if (compact) setMenuOpen?.(false)
    setIndex(null)
  }, [compact, setMenuOpen])
  const api = useMemo<TourApi>(() => ({
    active: index !== null,
    index: index ?? 0,
    start: () => go(0),
    stop: end,
    next: () => { if (index === null) return; index + 1 < TOUR_STEPS.length ? go(index + 1) : end() },
    back: () => { if (index !== null && index > 0) go(index - 1) },
  }), [index, go, end])
  return <TourContext.Provider value={api}>{children}{index !== null && <TourOverlay />}</TourContext.Provider>
}

export const useTour = () => useContext(TourContext)
