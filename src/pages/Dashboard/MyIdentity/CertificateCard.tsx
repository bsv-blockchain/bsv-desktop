import React, { useState, useEffect, useContext } from 'react'
import {
  Card,
  CardContent,
  Typography,
  Grid,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Avatar,
  IconButton
} from '@mui/material'
import { Img } from '@bsv/uhrp-react'
import CounterpartyChip from '../../../components/CounterpartyChip'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import { useHistory } from 'react-router-dom'
import { WalletContext } from '../../../WalletContext'
import { CertificateDefinitionData, CertificateFieldDescriptor, IdentityCertificate, RegistryClient } from '@bsv/sdk'
import DeleteIcon from '@mui/icons-material/Delete'

// Props for the CertificateCard component.
interface CertificateCardProps {
  certificate: IdentityCertificate
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  clickable?: boolean
  canRevoke?: boolean
  onRevoke?: (certificate: IdentityCertificate) => void
}

// Props for the CertificateDetailsModal component.
interface CertificateDetailsModalProps {
  open: boolean
  onClose: (event?: React.SyntheticEvent | Event) => void
  fieldDetails: { [key: string]: CertificateFieldDescriptor }
  actualData: { [key: string]: any }
}

// Responsible for displaying certificate information within the MyIdentity page
const CertificateCard: React.FC<CertificateCardProps> = ({
  certificate,
  onClick,
  clickable = true,
  canRevoke = false,
  onRevoke
}) => {
  const history = useHistory()
  const [certName, setCertName] = useState<string>('Unknown Cert')
  const [iconURL, setIconURL] = useState<string>(DEFAULT_APP_ICON)
  const [description, setDescription] = useState<string>('')
  const [fields, setFields] = useState<{ [key: string]: CertificateFieldDescriptor }>({})
  const { managers, settings, adminOriginator, activeProfile } = useContext(WalletContext)
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [isRevoked, setIsRevoked] = useState<boolean>(false)
  const registrant = new RegistryClient(managers.walletManager)

  // Handle modal actions
  const handleModalOpen = () => {
    setModalOpen(true)
  }
  const handleModalClose = (event?: React.SyntheticEvent | Event) => {
    if (event) {
      event.stopPropagation()
    }
    setModalOpen(false)
  }

  // Handle certificate revocation
  const handleRelinquishCertificate = async () => {
    try {
      await managers.permissionsManager.relinquishCertificate({
        type: certificate.type,
        serialNumber: certificate.serialNumber,
        certifier: certificate.certifier
      }, adminOriginator)

      // Set the certificate as revoked locally
      setIsRevoked(true)

      // Notify parent component about the revocation
      if (onRevoke) {
        onRevoke(certificate)
      }
    } catch (error) {
      console.error('Error revoking certificate:', error)
    }
  }

  useEffect(() => {
    ; (async () => {
      try {
        const registryOperators: string[] = settings.trustSettings.trustedCertifiers.map(
          (x: any) => x.identityKey
        )
        const cacheKey = `certData_${certificate.type}_${registryOperators.join('_')}+${activeProfile.id}`
        const cachedData = window.localStorage.getItem(cacheKey)

        if (cachedData) {
          const cachedCert = JSON.parse(cachedData)
          setCertName(cachedCert.name)
          setIconURL(cachedCert.iconURL)
          setDescription(cachedCert.description)
          setFields(JSON.parse(cachedCert.fields))
        }
        const results = (await registrant.resolve('certificate', {
          type: certificate.type,
          registryOperators
        })) as CertificateDefinitionData[]
        console.log('results: ', results)
        if (results && results.length > 0) {
          // Compute the most trusted of the results
          let mostTrustedIndex = 0
          let maxTrustPoints = 0
          for (let i = 0; i < results.length; i++) {
            const resultTrustLevel =
              settings.trustSettings.trustedCertifiers.find(
                (x: any) => x.identityKey === results[i].registryOperator
              )?.trust || 0
            if (resultTrustLevel > maxTrustPoints) {
              mostTrustedIndex = i
              maxTrustPoints = resultTrustLevel
            }
          }
          const mostTrustedCert = results[mostTrustedIndex]
          setCertName(mostTrustedCert.name)
          setIconURL(mostTrustedCert.iconURL)
          setDescription(mostTrustedCert.description)
          setFields(mostTrustedCert.fields)

          // Cache the fetched data
          // window.localStorage.setItem(cacheKey, JSON.stringify(mostTrustedCert))
        }
      } catch (error) {
        console.error('Failed to fetch certificate details:', error)
      }
    })()
  }, [certificate, settings, managers.walletManager])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (clickable) {
      if (typeof onClick === 'function') {
        onClick(e)
      } else {
        e.stopPropagation()
        history.push(`/dashboard/certificate/${encodeURIComponent(certificate.type)}`)
      }
    }
  }

  // If the certificate has been revoked, don't render anything
  if (isRevoked) {
    return null
  }

  return (
    <Card
      sx={{
        cursor: clickable ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        '&:hover': clickable ? {
          boxShadow: 3,
          transform: 'translateY(-2px)'
        } : {},
        position: 'relative'
      }}
      onClick={handleClick}
    >
      <CardContent>
        {/* Revoke button - only shown when canRevoke is true */}
        {canRevoke && (
          <Box sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1
          }}>
            <IconButton
              color="primary"
              size="small"
              onClick={(e) => {
                e.stopPropagation() // Prevent card click
                handleRelinquishCertificate()
              }}
              aria-label="revoke certificate"
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        )}

        <Grid container spacing={2} alignItems="center">
          <Grid item>
            <Avatar sx={{ width: 56, height: 56 }}>
              <Img
                style={{ width: '75%', height: '75%' }}
                src={iconURL}
              />
            </Avatar>
          </Grid>
          <Grid item xs>
            <Typography variant="h6" component="h3" gutterBottom>
              {certName}
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              {description}
            </Typography>
            <CounterpartyChip
              counterparty={certificate.certifier}
              label="Issuer"
            />
          </Grid>
        </Grid>

        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Type: {certificate.type}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              handleModalOpen()
            }}
          >
            View Details
          </Button>
        </Box>

        <CertificateDetailsModal
          open={modalOpen}
          onClose={(event) => handleModalClose(event)}
          fieldDetails={fields}
          actualData={certificate.decryptedFields || {}}
        />
        {modalOpen && (() => {
          console.log('Certificate passed to modal:', certificate)
          return null
        })()}
      </CardContent>
    </Card>
  )
}

const CertificateDetailsModal: React.FC<CertificateDetailsModalProps> = ({
  open,
  onClose,
  fieldDetails,
  actualData
}) => {
  // Merge the field details with the actual data
  // Create a simpler approach that works with both empty and populated data
  const mergedFields: Record<string, any> = {}

  // First check if we have field details to display
  if (Object.keys(fieldDetails || {}).length > 0) {
    // Process actual field details from the certificate definition
    Object.entries(fieldDetails || {}).forEach(([key, fieldDetail]) => {
      if (typeof fieldDetail === 'object') {
        mergedFields[key] = {
          friendlyName: fieldDetail.friendlyName || key,
          description: fieldDetail.description || '',
          type: fieldDetail.type || 'text',
          fieldIcon: fieldDetail.fieldIcon || '',
          value: actualData && key in actualData ? actualData[key] : 'No data available'
        }
      }
    })
  } else if (Object.keys(actualData || {}).length > 0) {
    // If no field details but we have decrypted data, create simple fields
    Object.keys(actualData || {}).forEach(key => {
      mergedFields[key] = {
        friendlyName: key,
        description: '',
        type: 'text',
        fieldIcon: '',
        value: actualData[key]
      }
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Certificate Fields</DialogTitle>
      <DialogContent dividers>
        {Object.keys(mergedFields).length === 0 ? (
          <Typography variant="body1" sx={{ p: 2, textAlign: 'center' }}>
            No certificate fields available to display.
          </Typography>
        ) : Object.entries(mergedFields).map(([key, value], index) => (
          <div
            key={index}
            style={{ display: 'flex', alignItems: 'start', marginBottom: 16 }}
          >
            {value.fieldIcon && (
              <Avatar style={{ marginRight: 16 }}>
                <Img
                  style={{ width: '75%', height: '75%' }}
                  src={value.fieldIcon}
                />
              </Avatar>
            )}
            <div>
              <Typography variant="subtitle2" color="textSecondary">
                {value.friendlyName}
              </Typography>
              <Typography variant="body2" style={{ marginBottom: 8 }}>
                {value.description}
              </Typography>
              {value.type === 'imageURL' ? (
                <Img
                  style={{ width: '5em', height: '5em' }}
                  src={value.value}
                />
              ) : value.type === 'other' ? (
                <Box sx={{ mt: 1, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {typeof value.value === 'object' ? JSON.stringify(value.value, null, 2) : String(value.value)}
                  </Typography>
                </Box>
              ) : (
                <div style={{ display: 'flex' }}>
                  <Typography variant="body1" paddingRight="0.5em">
                    Value:
                  </Typography>
                  <Typography variant="h5">{value.value}</Typography>
                </div>
              )}
            </div>
          </div>
        ))}
      </DialogContent>
      {/* Show field count for debugging */}
      <Typography variant="caption" sx={{ p: 1, textAlign: 'right', color: 'text.secondary' }}>
        {Object.keys(mergedFields).length} field(s) available
      </Typography>
      <DialogActions>
        <Button onClick={(e) => {
          e.stopPropagation()
          onClose(e)
        }} color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CertificateCard
