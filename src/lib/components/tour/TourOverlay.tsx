import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { TOUR_STEPS } from './tourSteps'
import { spotlightRect, type Rect } from './tourGeometry'
import { useTour } from './TourContext'

const PADDING = 8
const CARD_WIDTH = 340

function measure(target?: string): Rect | null {
  if (!target) return null
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return spotlightRect({ top: r.top, left: r.left, width: r.width, height: r.height }, PADDING, { width: window.innerWidth, height: window.innerHeight })
}

function cardPosition(hole: Rect | null): { top: number; left: number } {
  const vw = window.innerWidth, vh = window.innerHeight
  // Every branch clamps left to 16px so the card never runs off a narrow window.
  if (!hole) return { top: Math.max(16, vh / 2 - 120), left: Math.max(16, vw / 2 - CARD_WIDTH / 2) }
  const left = Math.max(16, Math.min(Math.max(16, hole.left), vw - CARD_WIDTH - 16))
  const below = hole.top + hole.height + 12
  if (below + 200 < vh) return { top: below, left }
  const right = hole.left + hole.width + 12
  if (right + CARD_WIDTH + 16 < vw) return { top: Math.max(16, Math.min(hole.top, vh - 220)), left: Math.max(16, right) }
  return { top: Math.max(16, hole.top - 212), left }
}

export default function TourOverlay() {
  const { index, next, back, stop } = useTour()
  const step = TOUR_STEPS[index]
  const [hole, setHole] = useState<Rect | null>(null)

  // Poll briefly after each step change (the route may still be rendering), then follow resize/scroll.
  useLayoutEffect(() => {
    setHole(measure(step.target))
    let tries = 0
    const timer = window.setInterval(() => { setHole(measure(step.target)); if (++tries >= 15) window.clearInterval(timer) }, 100)
    const update = () => setHole(measure(step.target))
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    if (step.target) document.querySelector(`[data-tour="${step.target}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    return () => { window.clearInterval(timer); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [step.target])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, stop])

  const pos = cardPosition(hole)
  const last = index === TOUR_STEPS.length - 1
  return createPortal(<Box role="dialog" aria-modal="true" aria-label={`User guide, step ${index + 1} of ${TOUR_STEPS.length}: ${step.title}`} sx={{ position: 'fixed', inset: 0, zIndex: theme => theme.zIndex.drawer + 1 }}>
    {hole
      ? <Box aria-hidden sx={{ position: 'fixed', top: hole.top, left: hole.left, width: hole.width, height: hole.height, borderRadius: 3, boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.6)', transition: 'all 200ms ease', pointerEvents: 'none' }} />
      : <Box aria-hidden sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(15, 23, 42, 0.6)' }} />}
    <Paper elevation={8} sx={{ position: 'fixed', top: pos.top, left: pos.left, width: CARD_WIDTH, maxWidth: 'calc(100vw - 32px)', p: 2.5, borderRadius: 3 }}>
      <Typography variant="caption" color="text.secondary">{index + 1} / {TOUR_STEPS.length}</Typography>
      <Typography variant="h6" sx={{ mt: 0.5, mb: 1 }}>{step.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>{step.body}</Typography>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2.5 }}>
        <Button size="small" onClick={stop} sx={{ color: 'text.secondary', px: 0 }}>Skip tour</Button>
        <Stack direction="row" gap={1}>
          {index > 0 && <Button size="small" onClick={back}>Back</Button>}
          <Button size="small" variant="contained" onClick={next} autoFocus>{last ? 'Done' : 'Next'}</Button>
        </Stack>
      </Stack>
    </Paper>
  </Box>, document.body)
}
