import { useContext } from 'react'
import { DialogContent, DialogActions, Button, Typography, Divider, Box, Stack, Tooltip } from '@mui/material'
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

    // Handle denying the top request in the queue
    const handleDeny = async () => {
        if (certificateRequests.length > 0) {
            managers.permissionsManager?.denyPermission(certificateRequests[0].requestID)
        }
        advanceCertificateQueue()
    }

    // Handle granting the top request in the queue
    const handleGrant = async () => {
        if (certificateRequests.length > 0) {
            managers.permissionsManager?.grantPermission({
                requestID: certificateRequests[0].requestID
            })
        }
        advanceCertificateQueue()
    }

    if (!certificateAccessModalOpen || !certificateRequests.length) return null

    // Extract certificate data from request
    const { originator, verifierPublicKey, certificateType, fieldsArray, description, renewal } = certificateRequests[0] as CertificateAccessRequest

    return (
        <CustomDialog
            open={certificateAccessModalOpen}
            title={renewal ? 'Certificate Access Renewal' : 'Certificate Access Request'}
            onClose={handleDeny} // If the user closes via the X, treat as "deny"
            icon={<VerifiedUserIcon fontSize="medium" />}
        >
            <DialogContent>
                <Stack spacing={1}>
                    {/* App section */}
                    <AppChip
                        size={1.5}
                        showDomain
                        label={originator || 'unknown'}
                        clickable={false}
                    />
                    
                    <Divider />

                    {/* Certificate section */}
                    <CertificateChip
                        certType={certificateType}
                        fieldsToDisplay={fieldsArray}
                        verifier={verifierPublicKey}
                    />

                    {/* Reason section */}
                    {description && (
                        <>
                         <Divider />
                            <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between" sx={{
                                height: '3em', width: '100%'
                            }}>
                                <Typography variant="body1" fontWeight="bold">
                                    Reason:
                                </Typography>
                                <Stack px={3}>
                                    <Typography variant="body1">
                                        {description}
                                    </Typography>
                                </Stack>
                            </Stack>
                        </>
                    )}
                </Stack>
            </DialogContent>

            {/* Visual signature */}
            <Tooltip title="Unique visual signature for this request" placement="top">
                <Box sx={{ mb: 3, py: 0.5, background: deterministicColor(JSON.stringify(certificateRequests[0])) }} />
            </Tooltip>

            <DialogActions sx={{ justifyContent: 'space-between' }}>
                <Button 
                    onClick={handleDeny}
                    variant="outlined"
                    color="inherit"
                >
                    Deny
                </Button>
                <Button 
                    onClick={handleGrant}
                    variant="contained"
                    color="primary"
                >
                    Grant Access
                </Button>
            </DialogActions>
        </CustomDialog>
    )
}

export default CertificateAccessHandler
