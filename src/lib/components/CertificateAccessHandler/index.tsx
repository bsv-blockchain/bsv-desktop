import { useContext, useState } from 'react'
import { DialogContent, DialogActions, Button, Typography, Divider, Box, Stack, Tooltip, CircularProgress } from '@mui/material'
import CustomDialog from '../CustomDialog'
import AppChip from '../AppChip'
import CertificateChip from '../CertificateChip'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import deterministicColor from '../../utils/deterministicColor'
import { WalletContext } from '../../WalletContext'
import { UserContext } from '../../UserContext'
import { PermissionRequest } from '@bsv/wallet-toolbox-client'

type CertificateAccessRequest = {
  requestID: string
  certificateType?: string
  fields?: any
  fieldsArray?: string[]
  verifierPublicKey?: string
  originator: string
  description?: string
  renewal?: boolean
}

const CertificateAccessHandler = () => {
  const { certificateRequests, advanceCertificateQueue, managers } = useContext(WalletContext)
  const { certificateAccessModalOpen } = useContext(UserContext)

  const [granting, setGranting] = useState(false)
  const [denying, setDenying] = useState(false)

  const handleDeny = async () => {
    if (!certificateRequests.length) return
    try {
      setDenying(true)
      await managers.permissionsManager?.denyPermission(certificateRequests[0].requestID)
      const { originator } = certificateRequests[0] as CertificateAccessRequest
      window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'deny', originator } }))
    } finally {
      setDenying(false)
      advanceCertificateQueue()
    }
  }

  const handleGrant = async () => {
    if (!certificateRequests.length) return
    const { requestID, originator } = certificateRequests[0] as CertificateAccessRequest
    try {
      setGranting(true)
      await managers.permissionsManager?.grantPermission({ requestID })
      window.dispatchEvent(new CustomEvent('cert-access-changed', { detail: { op: 'grant', originator } }))
    } finally {
      setGranting(false)
      advanceCertificateQueue()
    }
  }

  if (!certificateAccessModalOpen || !certificateRequests.length) return null

  const { originator, verifierPublicKey, certificateType, fieldsArray, description, renewal } =
    certificateRequests[0] as CertificateAccessRequest

  return (
    <CustomDialog
      open={certificateAccessModalOpen}
      title={renewal ? 'Certificate Access Renewal' : 'Certificate Access Request'}
      onClose={handleDeny}
      icon={<VerifiedUserIcon fontSize="medium" />}
    >
      <DialogContent>
        <Stack spacing={1}>
          <AppChip size={1.5} showDomain label={originator || 'unknown'} clickable={false} />
          <Divider />

          <CertificateChip
            certType={certificateType}
            certVerifier={verifierPublicKey}
          />

          {description && (
            <>
              <Divider />
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                justifyContent="space-between"
                sx={{ height: '3em', width: '100%' }}
              >
                <Typography variant="body1" fontWeight="bold">Reason:</Typography>
                <Stack px={3}>
                  <Typography variant="body1">{description}</Typography>
                </Stack>
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>

      <Tooltip title="Unique visual signature for this request" placement="top">
        <Box sx={{ mb: 3, py: 0.5, background: deterministicColor(JSON.stringify(certificateRequests[0])) }} />
      </Tooltip>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={handleDeny} variant="outlined" color="inherit" disabled={granting || denying}>
          Deny
        </Button>

        <Button onClick={handleGrant} variant="contained" color="primary" disabled={granting || denying}>
          {granting ? <CircularProgress size={18} /> : 'Grant Access'}
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default CertificateAccessHandler
