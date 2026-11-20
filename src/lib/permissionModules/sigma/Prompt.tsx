/**
 * Consent prompt for the sigma permission module: a public key, a derived
 * key, or a proof made with one of the wallet's keys.
 *
 * The message is parsed and turned into a `SigmaConsentView` BEFORE anything
 * is queued. A message the parser rejects is declined without opening a
 * dialog.
 *
 * Text the requesting application chose (its origin, the purpose, the key ID,
 * a counterparty) is shown neutralized by `displayAppText`. In the rows it is
 * quoted in a monospace face, apart from the wallet's own words.
 *
 * Prompts are FIFO, so concurrent app calls never replace an unanswered
 * request. A decision counts only for the request it was shown for, and is
 * taken once. Approve is enabled only PROMPT_ARM_DELAY_MS after the request
 * appeared and after any decision in a module prompt (`modulePromptClock`);
 * the wallet's other dialogs (the ordinary permission dialogs) are not part
 * of that clock. Closing, Escape and unmounting all answer `false`.
 */
import React from 'react'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined'
import type { PermissionPromptProps } from '../types'
import { usePermissionPrompt } from '../promptShared'
import { parseSigmaPromptMessage } from './message'
import { displayAppText, sigmaConsentView, type SigmaConsentRow, type SigmaConsentView } from './view'

const TITLE_ID = 'sigma-permission-title'
const DESCRIPTION_ID = 'sigma-permission-description'

/**
 * Builds the view for `message` and hands it to `enqueue` (the dialog queue).
 * Resolves `true` only for an explicit boolean approval. A message the parser
 * rejects resolves `false` without calling `enqueue`; an `enqueue` failure is
 * also a decline.
 */
export async function handleSigmaPromptMessage (
  message: string,
  enqueue: (view: SigmaConsentView) => Promise<boolean>
): Promise<boolean> {
  const request = parseSigmaPromptMessage(message)
  if (request === undefined) return false
  const view = sigmaConsentView(request)
  try {
    return (await enqueue(view)) === true
  } catch (error) {
    console.error('Sigma consent prompt failed; the request is declined', error)
    return false
  }
}

const boxSx = { p: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 2 } as const
const monoSx = { fontFamily: 'monospace', overflowWrap: 'anywhere' } as const

const Row: React.FC<{ row: SigmaConsentRow }> = ({ row }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2}>
    <Typography color="text.secondary" sx={{ flexShrink: 0 }}>{row.label}</Typography>
    <Typography sx={{ textAlign: 'right', overflowWrap: 'anywhere', overflow: 'hidden', minWidth: 0, ...(row.fromApp ? monoSx : {}) }}>
      {row.fromApp ? `“${row.value}”` : row.value}
    </Typography>
  </Stack>
)

/** The prompt body. Presentational, no Dialog, so it renders on the server. */
export function SigmaConsentDetails ({ view }: { view: SigmaConsentView }): JSX.Element {
  return (
    <Stack spacing={2.5}>
      <Box id={DESCRIPTION_ID}>
        {view.body.map((paragraph, i) => (
          <Typography key={i} color="text.secondary">{paragraph}</Typography>
        ))}
      </Box>
      <Box sx={boxSx}>
        <Stack spacing={1}>
          {view.rows.map(row => <Row key={row.label} row={row} />)}
        </Stack>
      </Box>
      <Typography variant="body2" color="text.secondary">{view.footer}</Typography>
    </Stack>
  )
}

/** FIFO prompts keep concurrent app calls from replacing an unanswered request. */
export function SigmaPermissionPrompt (props: PermissionPromptProps): JSX.Element | null {
  const { theme, entry, armed, decide } = usePermissionPrompt<SigmaConsentView>(props, handleSigmaPromptMessage)

  if (!entry) return null
  const { view } = entry
  const app = typeof entry.app === 'string' && entry.app !== '' ? displayAppText(entry.app) : 'Unknown app'

  return (
    <ThemeProvider theme={theme}>
      <Dialog
        key={entry.id}
        open
        onClose={() => decide(entry.id, false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
      >
        <DialogTitle id={TITLE_ID}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <KeyOutlinedIcon color="primary" />
            <Typography component="span" variant="h6">{view.title}</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <Chip label={app} variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { py: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' } }} />
            <SigmaConsentDetails view={view} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button variant="outlined" onClick={() => decide(entry.id, false)} autoFocus>Deny</Button>
          <Button variant="contained" disabled={!armed} onClick={() => decide(entry.id, true)}>{view.approveLabel}</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}
