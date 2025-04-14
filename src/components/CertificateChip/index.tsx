import { useContext, useState } from 'react'
import { Chip, Box, Typography, IconButton } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import { useTheme, makeStyles } from '@mui/styles'
import style from './style'
import CounterpartyChip from '../CounterpartyChip'
import { Base64String } from '@bsv/sdk'
import { WalletContext } from '../../WalletContext'
import DeleteIcon from '@mui/icons-material/Delete'

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
  description,
  iconURL,
  onRevoke
}) => {
  if (typeof certType !== 'string') {
    throw new Error('The certType in CertificateChip is not a string')
  }
  const classes = useStyles()
  const theme = useTheme()

  const [certName] = useState('Unknown Cert')
  const [descriptionState] = useState(description || `${certType.substr(0, 12)}...`)
  const [isRevoked, setIsRevoked] = useState(false)

  const fields = (Array.isArray(fieldsToDisplay) && fieldsToDisplay.length > 0) ? fieldsToDisplay : Object.entries(fieldsToDisplay || {}).map(([k, v]) => `${k}: ${v}`)

  const {
    managers
  } = useContext(WalletContext)

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
        {lastAccessed || descriptionState}
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
      {fields.length > 0 && (
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
            {fields.map(y => (
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
