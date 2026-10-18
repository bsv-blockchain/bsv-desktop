import React from 'react'
import { Alert, Box, Button, Typography } from '@mui/material'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import HourglassTopOutlined from '@mui/icons-material/HourglassTopOutlined'
import AmountDisplay from '../../../components/AmountDisplay'
import type { ReceivedDirectPayment } from './directCodes'
import { payeeReceipt } from './directReceipts'

/**
 * The payee's code-exchange screen once a payment arrived. Only a payment the wallet took is
 * shown as a success; one that was only received and kept is not verified yet and says so
 * (final review D6). The amount, and a requested amount it differs from (Ruling 29), always show.
 */
export default function DirectReceiptView({ received, onAgain }: { received: ReceivedDirectPayment; onAgain: () => void }) {
  const view = payeeReceipt(received.status)
  return <Box sx={{ textAlign: 'center', py: 4 }}>
    {view.added ? <CheckCircleOutline color="primary" sx={{ fontSize: 54 }} /> : <HourglassTopOutlined color="warning" sx={{ fontSize: 54 }} />}
    <Typography variant="h6" sx={{ mt: 2 }}>{view.heading}</Typography>
    <Typography variant="h4" sx={{ my: 1.5, fontWeight: 700 }}><AmountDisplay>{received.amount}</AmountDisplay></Typography>
    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>From {received.sender}</Typography>
    {received.requested !== undefined && <Alert severity="warning" sx={{ mt: 2, textAlign: 'left' }}>Received {received.amount.toLocaleString()} satoshis — you requested {received.requested.toLocaleString()}.</Alert>}
    {view.detail && <Alert severity="warning" sx={{ mt: 2, textAlign: 'left' }}>{view.detail}</Alert>}
    <Button sx={{ mt: 2 }} onClick={onAgain}>Receive another payment</Button>
  </Box>
}
