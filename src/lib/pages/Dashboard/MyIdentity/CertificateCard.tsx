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
  IconButton,
  Stack,
  Divider,
  Tooltip
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Img } from '@bsv/uhrp-react'
import CounterpartyChip from '../../../components/CounterpartyChip'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import { useHistory } from 'react-router-dom'
import { WalletContext } from '../../../WalletContext'
import { CertificateDefinitionData, CertificateFieldDescriptor, IdentityCertificate, RegistryClient } from '@bsv/sdk'
import DeleteIcon from '@mui/icons-material/Delete'
import { Description } from '@mui/icons-material'

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
  certName?: string
  iconURL?: string
  description?: string
  type?: string
  serialNumber?: string
  certificateType?: string
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
  const [certName, setCertName] = useState<string>('Custom Certificate')
  const [iconURL, setIconURL] = useState<string>(DEFAULT_APP_ICON)
  const [description, setDescription] = useState<string>('')
  const [fields, setFields] = useState<{ [key: string]: CertificateFieldDescriptor }>({})
  const { managers, settings, adminOriginator, activeProfile } = useContext(WalletContext)
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [isRevoked, setIsRevoked] = useState<boolean>(false)
  const [documentationURL, setDocumentationURL] = useState<string>('')

  const registrant = new RegistryClient(managers.walletManager, undefined, adminOriginator)

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
    ;(async () => {
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
          setDocumentationURL(mostTrustedCert?.documentationURL)
          setDescription(mostTrustedCert.description)
          setFields(mostTrustedCert.fields)

          // Cache the fetched data
          window.localStorage.setItem(cacheKey, JSON.stringify(mostTrustedCert))
        } else {
          window.localStorage.removeItem(cacheKey)
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
        </Box>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Serial Number:{certificate.serialNumber}
          </Typography>
        </Box>
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

        <CertificateDetailsModal
          open={modalOpen}
          onClose={(event) => handleModalClose(event)}
          fieldDetails={fields}
          actualData={certificate.decryptedFields || {}}
          certName={certName}
          iconURL={iconURL}
          description={description}
          serialNumber={certificate.serialNumber}
          certificateType={certificate.type} 
        />
        {modalOpen && (() => {
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
  actualData,
  certName,
  iconURL,
  description,
  serialNumber,
  certificateType
}) => {
  // Merge the field details with the actual data
  const mergedFields: Record<string, any> = {}

  if (Object.keys(fieldDetails || {}).length > 0) {
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

const MetaRow: React.FC<{
  label: React.ReactNode
  value?: React.ReactNode
  dividerBelow?: boolean
}> = ({ label, value, dividerBelow = false }) => {
  if (!value && value !== 0) return null
  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          columnGap: 1,
          my: 0.5
        }}
      >
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
          <b>{label}</b>
        </Typography>
        <Box />
        <Typography
          variant="body2"
          sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}
          title={typeof value === 'string' ? value : undefined}
        >
          {value}
        </Typography>
      </Box>
      {dividerBelow && <Divider sx={{ my: 2 }} />}
    </>
  )
}

const CopyableMetaRow: React.FC<{
  label: React.ReactNode
  value?: React.ReactNode
  dividerBelow?: boolean
}> = ({ label, value, dividerBelow = false }) => {
  if (!value && value !== 0) return null
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(String(value ?? ''))
  }
  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          columnGap: 1,
          my: 0.5
        }}
      >
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
          <b>{label}</b>
        </Typography>
        <Box />
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
          <Typography
            variant="body2"
            sx={{ whiteSpace: 'nowrap' }}
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </Typography>
          <Tooltip title="Copy">
            <IconButton size="small" onClick={copy}>
              <ContentCopyIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      {dividerBelow && <Divider sx={{ my: 2 }} />}
    </>
  )
}
  const CT = certificateType ?? actualData?.certType ?? actualData?.type ?? ''

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{justifySelf: 'center', textAlign: 'center', variant: 'h6', fontWeight: 'bold'}}>Certificate Details</DialogTitle>

      <DialogContent dividers onClick={(e) => e.stopPropagation()} sx={{ cursor: 'default' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            alignItems: 'center',
            columnGap: 2,
            mb: 2
          }}
        >
          {/* Left: Icon */}
          <Box sx={{ justifySelf: 'start' }}>
            {iconURL ? (
              <Avatar sx={{ width: 48, height: 48 }}>
                <Img style={{ width: '100%', height: '100%', objectFit: 'contain' }} src={iconURL} />
              </Avatar>
            ) : (
              <Avatar sx={{ width: 48, height: 48 }}>
                {(certName?.[0] ?? 'C').toUpperCase()}
              </Avatar>
            )}
          </Box>

          {/* Center: Name */}
          <Typography variant="h6" fontWeight={700} sx={{ justifySelf: 'center', textAlign: 'center' }}>
            {certName || 'Certificate'}
          </Typography>

          {/* Right spacer: match avatar width so center is truly centered */}
          <Box sx={{ width: 48 }} />
        </Box>

        <Box sx={{ mt: 1 }}>
        {(() => {
          const rows = [
            { key: 'ct',     comp: 'copy' as const, label: 'Certificate Type:', value: CT },
            { key: 'serial', comp: 'copy' as const, label: 'Serial Number:',    value: serialNumber },
            { key: 'desc',   comp: 'plain' as const, label: 'Description:',     value: description },
          ].filter(r => r.value !== undefined && r.value !== null && r.value !== '')

          return rows.map((r, i) => {
            const dividerBelow = i < rows.length - 1
            return r.comp === 'copy' ? (
              <CopyableMetaRow key={r.key} label={r.label} value={r.value} dividerBelow={dividerBelow} />
            ) : (
              <MetaRow key={r.key} label={r.label} value={r.value} dividerBelow={dividerBelow} />
            )
          })
        })()}
      </Box>
        <Divider sx={{ my: 2 }} />
        {/* FIELDS */}
          <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            alignItems: 'center',
            columnGap: 2,
            mb: 1
          }}
        >
          <Box sx={{ width: 48 }} />
          <Typography variant="h6" fontWeight={700} sx={{ justifySelf: 'center', textAlign: 'center' }}>
            Fields
          </Typography>
          <Box sx={{ width: 48 }} />
        </Box>

        {Object.keys(mergedFields).length === 0 ? (
          <Typography variant="body1" sx={{ p: 2, textAlign: 'center' }}>
            No certificate fields available to display.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {Object.entries(mergedFields).map(([key, value], index) => (
              <Stack
                key={index}
                direction="row"
                spacing={2}
                alignItems="flex-start"
                sx={{ width: '100%' }}
              >
                {/* Field Icon */}
                {value.fieldIcon ? (
                  <Avatar sx={{ width: 36, height: 36 }}>
                    <Img
                      style={{ width: '75%', height: '75%', objectFit: 'contain' }}
                      src={value.fieldIcon}
                    />
                  </Avatar>
                ) : (
                  <Avatar sx={{ width: 36, height: 36 }}>
                    {(value.friendlyName?.[0] ?? key?.[0] ?? 'F').toUpperCase()}
                  </Avatar>
                )}

                {/* Field content */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2" color="textSecondary">
                      {value.friendlyName}
                    </Typography>

                    {value.description && (
                      <Typography variant="body2" color="text.secondary">
                        {value.description}
                      </Typography>
                    )}

                    {/* Value (render as NON-clickable text) */}
                    {value.type === 'imageURL' ? (
                      <Img
                        style={{
                          width: '5em',
                          height: '5em',
                          objectFit: 'cover',
                          borderRadius: 8
                        }}
                        src={value.value}
                      />
                    ) : value.type === 'other' || typeof value.value === 'object' ? (
                      <Box
                        sx={{
                          mt: 1,
                          p: 2,
                          bgcolor: 'background.paper',
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: 'divider'
                        }}
                      >
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {typeof value.value === 'object'
                            ? JSON.stringify(value.value, null, 2)
                            : String(value.value)}
                        </Typography>
                      </Box>
                    ) : (
                      <Stack direction="row" spacing={1} alignItems="baseline">
                        <Typography variant="body1">Value:</Typography>
                        <Typography variant="h6" sx={{ wordBreak: 'break-word' }}>
                          {String(value.value)}
                        </Typography>
                      </Stack>
                    )}
                  </Stack>
                </Box>
              </Stack>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={(e) => {
            e.stopPropagation()
            onClose(e)
          }}
          color="primary"
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CertificateCard
