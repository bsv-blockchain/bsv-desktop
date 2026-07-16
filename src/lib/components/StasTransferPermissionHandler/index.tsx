/**
 * StasTransferPermissionHandler — modal that prompts the user to approve or
 * deny a STAS transfer requested by an external app via POST /stas/transfer.
 *
 * Hooks into WalletContext's `stasTransferRequests` queue (populated by the
 * HTTP route handler in onWalletReady.ts). Renders the head of the queue;
 * Approve/Deny resolves the request and advances. While idle (empty queue)
 * the component renders nothing.
 */

import React, { useContext } from 'react'
import {
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  Box,
  Divider,
  Chip,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CustomDialog from '../CustomDialog'
import { WalletContext } from '../../WalletContext'

const StasTransferPermissionHandler: React.FC = () => {
  const { stasTransferRequests, advanceStasTransferQueue } = useContext(WalletContext)

  if (!stasTransferRequests || stasTransferRequests.length === 0) {
    return null
  }

  const req = stasTransferRequests[0]
  const symbolText = req.symbol ?? 'STAS'

  const onDeny = () => advanceStasTransferQueue(false)
  const onApprove = () => advanceStasTransferQueue(true)

  return (
    <CustomDialog open onClose={onDeny} title='Approve STAS transfer' maxWidth='sm' fullWidth>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant='caption' color='text.secondary'>Requested by</Typography>
            <Typography
              variant='body2'
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 600 }}
            >
              {req.originator}
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Typography variant='caption' color='text.secondary'>Sending</Typography>
            <Stack direction='row' spacing={1} alignItems='baseline' sx={{ mt: 0.5 }}>
              <Typography variant='h6' sx={{ fontWeight: 700 }}>
                {req.satoshis.toLocaleString()}
              </Typography>
              <Typography variant='body2' color='text.secondary'>sats</Typography>
              <Chip size='small' label={symbolText} variant='outlined' sx={{ ml: 0.5 }} />
            </Stack>
            {req.tokenId && (
              <Typography
                variant='caption'
                color='text.secondary'
                sx={{ fontFamily: 'monospace', display: 'block', mt: 0.5 }}
                title={req.tokenId}
              >
                token id {req.tokenId.substring(0, 12)}…
              </Typography>
            )}
          </Box>

          <Box>
            <Typography variant='caption' color='text.secondary'>From your wallet</Typography>
            <Stack direction='row' spacing={1} alignItems='center' sx={{ mt: 0.5 }}>
              {req.brc42KeyId && <Chip size='small' label={req.brc42KeyId} variant='outlined' />}
              <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                {req.outpoint.substring(0, 20)}…
              </Typography>
              <a
                href={`https://whatsonchain.com/tx/${req.outpoint.split('.')[0]}`}
                target='_blank'
                rel='noreferrer'
                style={{ color: 'inherit', display: 'inline-flex' }}
              >
                <OpenInNewIcon sx={{ fontSize: 14 }} />
              </a>
            </Stack>
          </Box>

          <Box>
            <Typography variant='caption' color='text.secondary'>Recipient</Typography>
            <Typography
              variant='body2'
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mt: 0.5 }}
            >
              {req.recipient}
            </Typography>
          </Box>

          <Typography variant='caption' color='text.secondary'>
            Approving will sign and broadcast a transaction. BSV fees come from your
            default basket. This action cannot be undone once the transaction
            confirms on chain.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDeny} color='inherit'>Deny</Button>
        <Button onClick={onApprove} variant='contained' startIcon={<SendIcon />}>
          Approve transfer
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default StasTransferPermissionHandler
