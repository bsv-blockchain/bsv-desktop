/**
 * Consent prompt for the color permission module (BRC-207): `color_send`,
 * `color_signature`, `color_access` and `color_relinquish` (contract §2.5,
 * Revision 3: offline receipts are credited by the host runtime, not prompted).
 *
 * The message is turned into a `ColorConsentView` BEFORE anything is queued.
 * A message the view cannot present faithfully (`InvalidColorRequestError`,
 * or any other failure) is declined without opening a dialog: the user is
 * never asked to approve a figure the wallet could not verify.
 *
 * Prompts are FIFO, so concurrent app calls never replace an unanswered
 * request. A decision counts only for the request it was shown for, and is
 * taken once. Approve is enabled only PROMPT_ARM_DELAY_MS after the request
 * appeared and after any decision in a module prompt (`modulePromptClock`);
 * the wallet's other dialogs (the ordinary permission dialogs) are not part
 * of that clock. Closing, Escape and unmounting all answer `false`.
 */
import React from 'react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import TokenOutlinedIcon from '@mui/icons-material/TokenOutlined'
import type { PermissionPromptProps } from '../types'
import { usePermissionPrompt } from '../promptShared'
import { buildColorConsentView, type ColorConsentView } from './consentView'

/**
 * Builds the view for `message` and hands it to `enqueue` (the dialog queue).
 * Resolves `true` only for an explicit boolean approval. An invalid message
 * resolves `false` without calling `enqueue` and logs one warning naming the
 * offending field; an `enqueue` failure is also a decline.
 */
export async function handleColorPromptMessage (
  message: string,
  enqueue: (view: ColorConsentView) => Promise<boolean>
): Promise<boolean> {
  let view: ColorConsentView
  try {
    view = buildColorConsentView(message)
  } catch (error) {
    // Matched by name, never instanceof across bundles (D22).
    const name = (error as { name?: unknown } | null)?.name
    const text = (error as { message?: unknown } | null)?.message
    console.warn(
      name === 'InvalidColorRequestError'
        ? 'Declined a color consent request the wallet could not verify:'
        : 'Declined a color consent request that could not be displayed:',
      typeof text === 'string' ? text : String(error)
    )
    return false
  }
  try {
    return (await enqueue(view)) === true
  } catch (error) {
    console.error('Color consent prompt failed; the request is declined', error)
    return false
  }
}

const descriptions: Record<ColorConsentView['type'], string> = {
  color_send: 'This app wants to create a token transaction. Review every asset, output and fee before approving.',
  color_signature: 'This app wants this wallet to sign token inputs of a transaction. Review every asset before approving. This approves these signatures only.',
  color_access: 'This app wants to read your token holdings. Approval lasts for 30 minutes.',
  color_relinquish: 'This app wants to remove this token holding from your wallet.'
}

const HANDOFF_NOTE = 'This wallet signs the transaction and hands it to the recipient. It is submitted to the overlay once the recipient has it.'

const boxSx = { p: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 2 } as const
const monoSx = { fontFamily: 'monospace', overflowWrap: 'anywhere' } as const

const Row: React.FC<{ label: string; value: React.ReactNode; mono?: boolean; strong?: boolean }> = ({ label, value, mono, strong }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2}>
    <Typography color="text.secondary" sx={{ flexShrink: 0 }}>{label}</Typography>
    <Typography fontWeight={strong ? 700 : undefined} sx={{ textAlign: 'right', overflowWrap: 'anywhere', ...(mono ? monoSx : {}) }}>{value}</Typography>
  </Stack>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box sx={boxSx}>
    <Stack spacing={1}>
      <Typography fontWeight={700}>{title}</Typography>
      {children}
    </Stack>
  </Box>
)

/** The prompt body. Presentational, no Dialog, so it renders on the server. */
export const ColorConsentDetails: React.FC<{ view: ColorConsentView }> = ({ view }) => {
  const { satoshis, access, relinquish, deploy } = view
  return (
    <Stack spacing={2.5}>
      <Typography id="color-permission-description" color="text.secondary">{descriptions[view.type]}</Typography>
      {view.handoff && <Alert severity="info">{HANDOFF_NOTE}</Alert>}

      {view.assets.map((asset, index) => (
        <Section key={`${asset.assetId}-${index}`} title={asset.name}>
          {asset.operations.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {asset.operations.map((operation, i) => <Chip key={`${operation}-${i}`} size="small" label={operation} />)}
            </Stack>
          )}
          {asset.lines.map((line, i) => (
            <Row key={`${line.label}-${i}`} label={line.label} value={line.amount} strong={line.label === 'Sending'} />
          ))}
          {asset.authorities.map((authority, i) => (
            <Row key={`${authority.label}-${i}`} label={authority.label} value={String(authority.count)} />
          ))}
          <Typography variant="caption" color="text.secondary" sx={monoSx}>Asset ID: {asset.assetId}</Typography>
        </Section>
      ))}

      {deploy && (
        <Section title="New token">
          <Row label="Operation" value={deploy.operation} />
          <Row label="Amount" value={deploy.amount} strong />
          <Row label="Kept by this wallet" value={deploy.owned ? 'Yes' : 'No'} />
        </Section>
      )}

      {view.destinations.length > 0 && (
        <Section title="Outputs">
          {view.destinations.map((destination, i) => (
            <Stack key={`${destination.outputIndex}-${i}`} spacing={0.5}>
              <Row label={`Output ${destination.outputIndex}`} value={`${destination.satoshis} sats`} />
              {destination.token && (
                <>
                  <Row label={destination.token.role === 'authority' ? 'Authority' : 'Tokens'} value={destination.token.amount} />
                  <Typography variant="caption" color="text.secondary" sx={monoSx}>Asset ID: {destination.token.assetId}</Typography>
                </>
              )}
            </Stack>
          ))}
        </Section>
      )}

      {satoshis && (
        <Section title="Satoshis">
          <Row label="Inputs" value={`${satoshis.inputs} sats`} />
          <Row label="Outputs" value={`${satoshis.outputs} sats`} />
          <Row label="Network fee" value={`${satoshis.fee} sats`} strong />
        </Section>
      )}

      {view.signatures.length > 0 && (
        <Section title={`Signatures released: ${view.signatures.length}`}>
          {view.signatures.map((signature, i) => (
            <Typography key={`${signature.outpoint}-${i}`} variant="caption" sx={monoSx}>
              {`Input ${signature.inputIndex}: ${signature.outpoint} (sighash ${signature.sighashType})`}
            </Typography>
          ))}
        </Section>
      )}

      {view.lockTime !== undefined && view.lockTime !== 0 && (
        <Row label="Lock time" value={String(view.lockTime)} />
      )}

      {access && (
        <Section title="Requested access">
          {access.basket !== undefined && <Row label="Basket" value={access.basket} mono />}
          {access.labels !== undefined && <Row label="Labels" value={access.labels.length > 0 ? access.labels.join(', ') : 'none'} mono />}
          {access.role !== undefined && <Row label="Role" value={access.role} />}
          {access.assetId !== undefined && <Typography variant="caption" color="text.secondary" sx={monoSx}>Asset ID: {access.assetId}</Typography>}
        </Section>
      )}

      {relinquish && (
        <Section title="Holding">
          <Row label="Role" value={relinquish.role} />
          <Typography variant="caption" sx={monoSx}>Asset ID: {relinquish.assetId}</Typography>
          <Typography variant="caption" color="text.secondary" sx={monoSx}>Outpoint: {relinquish.outpoint}</Typography>
        </Section>
      )}
    </Stack>
  )
}

/** FIFO prompts keep concurrent app calls from replacing an unanswered request. */
export const ColorPermissionPrompt: React.FC<PermissionPromptProps> = (props) => {
  const { theme, entry, armed, decide } = usePermissionPrompt<ColorConsentView>(props, handleColorPromptMessage)

  if (!entry) return null
  const { view } = entry

  return (
    <ThemeProvider theme={theme}>
      <Dialog
        key={entry.id}
        open
        onClose={() => decide(entry.id, false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="color-permission-title"
        aria-describedby="color-permission-description"
      >
        <DialogTitle id="color-permission-title">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TokenOutlinedIcon color="primary" />
            <Typography component="span" variant="h6">{view.title}</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <Chip label={entry.app || 'Unknown app'} variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { py: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' } }} />
            <ColorConsentDetails view={view} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button variant="outlined" onClick={() => decide(entry.id, false)} autoFocus>Deny</Button>
          <Button variant="contained" disabled={!armed} onClick={() => decide(entry.id, true)}>Approve</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}
