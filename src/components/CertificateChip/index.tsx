import { useContext, useEffect, useState } from 'react'
import { Chip, Box, Typography, IconButton } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import { useTheme, makeStyles } from '@mui/styles'
import style from './style'
import CounterpartyChip from '../CounterpartyChip'
import { Base64String, CertificateDefinitionData, CertificateFieldDescriptor, RegistryClient } from '@bsv/sdk'
import { WalletContext } from '../../WalletContext'
import DeleteIcon from '@mui/icons-material/Delete'
import { DEFAULT_APP_ICON } from '../../constants/popularApps'

const useStyles = makeStyles(style, {
  name: 'CertificateChip'
})

interface CertificateChipProps extends RouteComponentProps {
  certType?: Base64String
  serialNumber?: Base64String
  certifier?: string
  verifier?: string
  lastAccessed?: string
  fieldsToDisplay?: string[]
  clickable?: boolean
  size?: number
  backgroundColor?: string
  expires?: string
  canRevoke?: boolean
  description?: string
  iconURL?: string
  onIssuerClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  onVerifierClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  onCloseClick?: () => void
  onRevoke?: (serialNumber: Base64String) => void
}

const CertificateChip: React.FC<CertificateChipProps> = ({
  lastAccessed,
  onIssuerClick,
  certType,
  certifier,
  serialNumber,
  verifier,
  onVerifierClick,
  onClick,
  fieldsToDisplay,
  history,
  clickable = true,
  size = 1.3,
  backgroundColor = 'transparent',
  expires,
  onCloseClick,
  canRevoke = false,
  // description,
  // iconURL,
  onRevoke
}) => {
  if (typeof certType !== 'string') {
    throw new Error('The certType in CertificateChip is not a string')
  }
  const classes = useStyles()
  const theme = useTheme()

  const {
    managers,
    settings
  } = useContext(WalletContext)

  const [certName, setCertName] = useState('Unknown Cert')
  const [iconURL, setIconURL] = useState(
    DEFAULT_APP_ICON
  )
  const [description, setDescription] = useState(`${certType.substr(0, 12)}...`)
  const [documentationURL, setDocumentationURL] = useState('unknown')
  const [fields, setFields] = useState<Record<string, CertificateFieldDescriptor>>({})
  const [isRevoked, setIsRevoked] = useState(false)
  const registrant = new RegistryClient(managers.walletManager)

  useEffect(() => {
    const fetchAndCacheData = async () => {
      const registryOperators: string[] = settings.trustSettings.trustedCertifiers.map((x: any) => x.identityKey)
      const cacheKey = `certData_${certType}_${registryOperators.join('_')}`
      const cachedData = window.localStorage.getItem(cacheKey)

      if (cachedData) {
        const cachedCert = JSON.parse(cachedData)
        setCertName(cachedCert.name)
        setIconURL(cachedCert.iconURL)
        setDescription(cachedCert.description)
        setDocumentationURL(cachedCert.documentationURL)
        setFields(cachedCert.fields)
      }

      try {
        const results = (await registrant.resolve('certificate', {
          type: certType,
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
          setDocumentationURL(mostTrustedCert.documentationURL)
          setFields(mostTrustedCert.fields)

          // Cache the fetched data
          window.localStorage.setItem(cacheKey, JSON.stringify(mostTrustedCert))
        } else {
          console.log('No certificates found.')
        }
      } catch (error) {
        console.error('Failed to fetch certificate details:', error)
      }
    }

    fetchAndCacheData()
  }, [settings, certType, setCertName, setIconURL, setDescription, setDocumentationURL, setFields])


  const handleRelinquishCertificate = async () => {
    try {
      const result = await managers.permissionsManager.relinquishCertificate({
        type: certType,
        serialNumber: serialNumber,
        certifier
      })

      // Set the certificate as revoked locally
      setIsRevoked(true)

      // Notify parent component about the revocation
      if (onRevoke) {
        onRevoke(serialNumber)
      }

      // Call onCloseClick if provided (for backward compatibility)
      if (onCloseClick) {
        onCloseClick()
      }
    } catch (error) {
      console.error('Error revoking certificate:', error)
    }
  }

  // If the certificate has been revoked, don't render anything
  if (isRevoked) {
    return null
  }

  return (
    <Box sx={{
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      position: 'relative'
    }}>
      <Typography variant="h5" fontWeight="bold">
        {certName}
      </Typography>

      <Typography variant='body1'>
        {lastAccessed || description}
      </Typography>
      {/* Revoke button - only shown when canRevoke is true */}
      {canRevoke && (
        <Box sx={{
          position: 'absolute',
          top: 0,
          right: 0
        }}>
          <IconButton
            color="primary"
            size="small"
            onClick={handleRelinquishCertificate}
            aria-label="revoke certificate"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      )}

      {/* Fields display section */}
      {Object.keys(fields).length > 0 && (
        <Box sx={{
          ...(theme as any).templates.boxOfChips,
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '100%'
        }}>
          <Typography variant="body1" fontWeight="bold">
            Fields:
          </Typography>
          <Box sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            maxWidth: '100%',
            overflow: 'hidden'
          }}>
            {Object.keys(fields).map(y => (
              <Chip
                sx={{ margin: '0.4em 0.25em' }}
                key={`field-${y}`}
                label={y}
                size="small"
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Issuer section */}
      {certifier && <CounterpartyChip
        counterparty={certifier}
        onClick={onIssuerClick}
        label="Issuer"
      />}

      {/* Verifier section */}
      {verifier &&
        <CounterpartyChip
          counterparty={verifier}
          onClick={onVerifierClick}
          clickable
          size={0.85}
          label="Verifier"
        />}
      {expires && (
        <Typography className={classes.expires}>{expires}</Typography>
      )}
    </Box>
  )
}

export default withRouter(CertificateChip)
