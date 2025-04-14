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
  Avatar
} from '@mui/material'
import { Img } from '@bsv/uhrp-react'
import CounterpartyChip from '../../../components/CounterpartyChip'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import { useHistory } from 'react-router-dom'
import { WalletContext } from '../../../WalletContext'
import { CertificateDefinitionData, CertificateFieldDescriptor, IdentityCertificate, RegistryClient } from '@bsv/sdk'

// Props for the CertificateCard component.
interface CertificateCardProps {
  certificate: IdentityCertificate
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  clickable?: boolean
}

// Props for the CertificateDetailsModal component.
interface CertificateDetailsModalProps {
  open: boolean
  onClose: () => void
  fieldDetails: { [key: string]: CertificateFieldDescriptor }
  actualData: { [key: string]: any }
}

// Responsible for displaying certificate information within the MyIdentity page
const CertificateCard: React.FC<CertificateCardProps> = ({
  certificate,
  onClick,
  clickable = true
}) => {
  const history = useHistory()
  const [certName, setCertName] = useState<string>('Unknown Cert')
  const [iconURL, setIconURL] = useState<string>(DEFAULT_APP_ICON)
  const [description, setDescription] = useState<string>('')
  const [fields, setFields] = useState<{ [key: string]: CertificateFieldDescriptor }>({})
  const { managers, settings } = useContext(WalletContext)
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const registrant = new RegistryClient(managers.walletManager)

  // Handle modal actions
  const handleModalOpen = () => {
    setModalOpen(true)
  }
  const handleModalClose = () => {
    setModalOpen(false)
  }

  useEffect(() => {
    ; (async () => {
      try {
        const registryOperators: string[] = settings.trustSettings.trustedCertifiers.map(
          (x: any) => x.identityKey
        )
        const cacheKey = `certData_${certificate.type}_${registryOperators.join('_')}`
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
          window.localStorage.setItem(cacheKey, JSON.stringify(mostTrustedCert))
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

  return (
    <Card>
      <CardContent>
        <Box
          onClick={handleClick}
          style={{
            cursor: clickable ? 'pointer' : 'default',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'start',
            flex: 1
          }}
        >
          <Img
            src={iconURL}
            style={{ width: 50, height: 50 }}
          />
          <Box padding="0 0 0.5em 0.5em">
            <Typography variant="h5">{certName}</Typography>
            <Typography variant="body1" fontSize="0.85em">
              {description}
            </Typography>
          </Box>
        </Box>
        {certificate && certificate.certifier ? (
          <div>
            <Grid container alignContent="center" style={{ alignItems: 'center' }}>
              <Grid item>
                <p
                  style={{
                    fontSize: '0.9em',
                    fontWeight: 'normal',
                    marginRight: '1em'
                  }}
                >
                  Issuer:
                </p>
              </Grid>
              <Grid item paddingBottom="1em">
                <CounterpartyChip size={0.89} counterparty={certificate.certifier} clickable />
              </Grid>
            </Grid>
          </div>
        ) : (
          ''
        )}
        <Button onClick={handleModalOpen} color="primary">
          View Details
        </Button>
        <CertificateDetailsModal
          open={modalOpen}
          onClose={handleModalClose}
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
        <Button onClick={onClose} color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CertificateCard
