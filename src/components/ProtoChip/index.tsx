import { useState, useEffect } from 'react'
import { Chip, Avatar, Stack, Typography, Divider, Box } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import CloseIcon from '@mui/icons-material/Close'
import makeStyles from '@mui/styles/makeStyles'
import { useTheme } from '@mui/styles'
import style from './style'
import { deterministicImage } from '../../utils/deterministicImage'
import CounterpartyChip from '../CounterpartyChip/index'

const useStyles = makeStyles(style as any, {
  name: 'ProtoChip'
})

interface ProtoChipProps extends RouteComponentProps {
  securityLevel: number
  protocolID: string
  counterparty?: string
  lastAccessed?: string
  originator?: string
  clickable?: boolean
  size?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  expires?: string
  onCloseClick?: () => void
  canRevoke?: boolean
  description?: string
  iconURL?: string
  backgroundColor?: string
}

const ProtoChip: React.FC<ProtoChipProps> = ({
  securityLevel,
  protocolID,
  counterparty,
  lastAccessed,
  originator,
  history,
  clickable = false,
  size = 1.3,
  onClick,
  expires,
  onCloseClick,
  canRevoke = true,
  description,
  iconURL,
  backgroundColor = 'transparent'
}) => {
  const classes = useStyles()
  const theme: any = useTheme()

  const navToProtocolDocumentation = (e: any) => {
    if (clickable) {
      if (typeof onClick === 'function') {
        onClick(e)
      } else {
        e.stopPropagation()
        history.push(`/dashboard/protocol/${encodeURIComponent(protocolID)}`)
      }
    }
  }

  // Validate protocolID before hooks
  if (typeof protocolID !== 'string') {
    console.error('ProtoChip: protocolID must be a string. Received:', protocolID)
    // Don't return null here to avoid conditional hook calls
  }

  const [protocolName, setProtocolName] = useState(protocolID)
  const [iconURLState, setIconURLState] = useState(iconURL || deterministicImage(protocolID))
  const [imageError, setImageError] = useState(false)
  const [documentationURL] = useState('https://projectbabbage.com')

  useEffect(() => {
    if (typeof protocolID === 'string') {
      // Update state if props change
      setProtocolName(protocolID)
      setIconURLState(iconURL || deterministicImage(protocolID))
    }
  }, [protocolID, iconURL])

  // Handle image loading events
  const handleImageLoad = () => {
    setImageError(false)
  }

  const handleImageError = () => {
    setImageError(true)
  }

  const securityLevelExplainer = (securityLevel: number) => {
    switch (securityLevel) {
      case 2:
        return 'only with this app and counterparty'
      case 1:
        return 'only with this app'
      case 0:
        return 'in general'
      default:
        return 'Unknown security level'
    }
  }

  // If protocolID is invalid, return null after hooks are defined
  if (typeof protocolID !== 'string') {
    return null
  }

  return (
    <Stack direction="column" spacing={1} alignItems="space-between">
      <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between" sx={{
        height: '3em', width: '100%'
      }}>
        <Typography variant="body1" fontWeight="bold">Protocol:</Typography>
        <Chip
          style={theme.templates.chip({ size, backgroundColor })}
          icon={
            <Avatar
              src={iconURLState}
              alt={protocolName}
              sx={{ 
                  width: '2.5em',
                  height: '2.5em',
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          }
          label={
            <div style={(theme as any).templates.chipLabel}>
              <span style={(theme as any).templates.chipLabelTitle({ size })}>
                {protocolID}
              </span>
            </div>
          }
          onClick={navToProtocolDocumentation}
          onDelete={canRevoke ? onCloseClick : undefined}
          deleteIcon={canRevoke ? <CloseIcon /> : undefined}
        />
      </Stack>
      {(counterparty && securityLevel > 1) && <CounterpartyChip
          counterparty={counterparty}
      />}
      {expires && 
      <>
        <Divider />
        <Stack sx={{
          height: '3em', width: '100%'
        }}>
          {expires}
        </Stack>
      </>}
      <Divider />
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{
        height: '3em', width: '100%'
      }}>
        <Typography variant="body1" fontWeight="bold">Scope:</Typography>
        <Box px={3}>
          <Typography variant="body1" sx={{ fontSize: '1rem' }}>{description && `${description} -`}{securityLevelExplainer(securityLevel)}</Typography>
        </Box>
      </Stack>
    </Stack>
  )
}

export default withRouter(ProtoChip)
