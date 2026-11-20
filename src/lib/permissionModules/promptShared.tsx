/**
 * What the module permission prompts share: the dialog theme, and the hook
 * that binds a `PromptQueue` to a prompt component.
 *
 * The hook registers the prompt handler under the component's `id`, turns
 * each message into a view with the module's own `handleMessage` (which
 * declines what it cannot show without queueing it), asks for window focus
 * before the first request of a burst is shown and gives it back once the
 * queue is empty (through `createPromptFocus`, so taking focus for a new
 * request waits for a hand-back still in flight), re-renders when the shown request changes or is armed, and
 * answers every request `false` on unmount.
 *
 * A dialog built on it keys its `Dialog` by `entry.id` (so it remounts, and
 * Deny takes focus again, for every request), disables Approve until `armed`,
 * and passes `entry.id` to `decide` from both buttons, so a decision counts
 * only for the request it was shown for.
 *
 * Every module prompt's queue uses `modulePromptClock`: Approve is armed only
 * after a short delay following the request appearing and following any
 * decision in any module prompt, and the hook re-renders when a decision in
 * another module prompt changes that. The wallet's other dialogs (the
 * ordinary permission dialogs) are not part of this clock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PaletteMode } from '@mui/material'
import { createTheme, type Theme } from '@mui/material/styles'
import type { PermissionPromptHandler, PermissionPromptProps } from './types'
import { PROMPT_ARM_DELAY_MS, createPromptQueue, modulePromptClock, type PromptQueue, type PromptQueueEntry } from './promptQueue'
import { createPromptFocus, type PromptFocus } from './promptFocus'

/**
 * PermissionPromptHost is outside AppThemeProvider. Keeps a prompt's portal
 * on the same navy palette and honors the host's explicit light/dark preference.
 */
export function permissionPromptTheme (mode: PaletteMode): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#1b365d' : '#93b4f4', contrastText: mode === 'light' ? '#ffffff' : '#0d1b3a' },
      secondary: { main: mode === 'light' ? '#2c5282' : '#b2c5e8' },
      background: { default: mode === 'light' ? '#f5f7fb' : '#0f172a', paper: mode === 'light' ? '#ffffff' : '#172238' },
      text: { primary: mode === 'light' ? '#1e293b' : '#eef2fa', secondary: mode === 'light' ? '#607086' : '#a8b5cc' },
      divider: mode === 'light' ? '#e2e8f0' : '#2b3953'
    },
    typography: {
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h6: { fontWeight: 600, fontSize: '0.95rem' },
      body1: { fontSize: '0.95rem', lineHeight: 1.65 },
      body2: { fontSize: '0.85rem', lineHeight: 1.6 },
      button: { fontWeight: 600, fontSize: '0.875rem' }
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', borderRadius: 10, padding: '10px 18px' } } },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 500, fontSize: '0.75rem' } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 20, backgroundImage: 'none' } } },
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 650, padding: '24px 24px 12px' } } },
      MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px 24px' } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } }
    },
    shape: { borderRadius: 6 },
    spacing: 8
  })
}

export type PermissionPromptState<V> = {
  theme: Theme
  /** The request on screen, or null. */
  entry: PromptQueueEntry<V> | null
  /** The request on screen can be approved. */
  armed: boolean
  /** Decides the request with this id, if it is still the one on screen. */
  decide: (id: number, allowed: boolean) => void
}

export function usePermissionPrompt<V> (
  props: PermissionPromptProps,
  handleMessage: (message: string, enqueue: (view: V) => Promise<boolean>) => Promise<boolean>
): PermissionPromptState<V> {
  const theme = useMemo(() => permissionPromptTheme(props.paletteMode), [props.paletteMode])
  const callbacks = useRef(props)
  callbacks.current = props
  const handle = useRef(handleMessage)
  handle.current = handleMessage
  const mounted = useRef(false)
  const awaitingFocus = useRef(0)
  const [revision, setRevision] = useState(0)

  const rerender = useCallback(() => {
    if (mounted.current) setRevision(r => r + 1)
  }, [])

  const focusRef = useRef<PromptFocus | null>(null)
  if (focusRef.current === null) {
    focusRef.current = createPromptFocus({
      isFocused: () => callbacks.current.isFocused(),
      onFocusRequested: () => callbacks.current.onFocusRequested(),
      onFocusRelinquished: () => callbacks.current.onFocusRelinquished()
    })
  }
  const focus = focusRef.current

  const queueRef = useRef<PromptQueue<V> | null>(null)
  if (queueRef.current === null) {
    const created: PromptQueue<V> = createPromptQueue<V>({
      armDelayMs: PROMPT_ARM_DELAY_MS,
      now: () => performance.now(),
      clock: modulePromptClock,
      onChange: () => {
        rerender()
        if (created.current() === null && awaitingFocus.current === 0) void focus.relinquish()
      }
    })
    queueRef.current = created
  }
  const queue = queueRef.current

  const promptHandler = useCallback<PermissionPromptHandler>((app, message) => {
    if (!mounted.current) return Promise.resolve(false)
    return handle.current(message, async view => {
      awaitingFocus.current++
      try {
        await focus.ensure()
      } finally {
        awaitingFocus.current--
      }
      if (!mounted.current) return false
      return await queue.enqueue(app, view)
    })
  }, [focus, queue])

  // A decision in another module prompt can disarm the request shown here.
  useEffect(() => modulePromptClock.subscribe(rerender), [rerender])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queue.clear()
      void focus.relinquish()
    }
  }, [focus, queue])

  const { id, onRegister, onUnregister } = props
  useEffect(() => {
    onRegister(id, promptHandler)
    return () => onUnregister?.(id)
  }, [id, onRegister, onUnregister, promptHandler])

  const entry = queue.current()
  const armed = queue.armed()
  const msUntilArmed = queue.msUntilArmed()

  // Re-render when the request on screen becomes approvable.
  useEffect(() => {
    if (entry === null || armed) return
    // A timer that fires a little early re-runs this effect (revision changes).
    const timer = setTimeout(rerender, msUntilArmed)
    return () => clearTimeout(timer)
  }, [entry, armed, msUntilArmed, revision, rerender])

  const decide = useCallback((entryId: number, allowed: boolean) => queue.decide(entryId, allowed), [queue])

  return { theme, entry, armed, decide }
}
