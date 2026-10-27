import React, { useEffect, useSyncExternalStore } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { EcpmSession, ecpmConsentText } from './ecpmSession'

export function EcpmPrompt({ session, onFocusRequested }: { session: EcpmSession; onFocusRequested?: () => Promise<void> }) {
  const pending = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => {
    if (pending && onFocusRequested) void onFocusRequested().catch(() => pending.answer(false))
  }, [pending, onFocusRequested])
  return <Dialog open={pending !== null} onClose={() => pending?.answer(false)} fullWidth maxWidth="sm">
    <DialogTitle>Allow point masking?</DialogTitle>
    <DialogContent><DialogContentText sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {pending && ecpmConsentText(pending.request)}
    </DialogContentText></DialogContent>
    <DialogActions>
      <Button onClick={() => pending?.answer(false)}>Deny</Button>
      <Button onClick={() => pending?.answer(true)}>Allow for five minutes</Button>
    </DialogActions>
  </Dialog>
}
