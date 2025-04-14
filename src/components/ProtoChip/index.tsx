import { useState, useEffect, useContext } from 'react'
import { Chip, Avatar, Stack, Typography, Divider, Box } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import CloseIcon from '@mui/icons-material/Close'
import makeStyles from '@mui/styles/makeStyles'
import { useTheme } from '@mui/styles'
import style from './style'
import { deterministicImage } from '../../utils/deterministicImage'
import CounterpartyChip from '../CounterpartyChip/index'
import { WalletContext } from '../../WalletContext'
import { RegistryClient, SecurityLevel } from '@bsv/sdk'

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
  // description,
  // iconURL,
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
  const [iconURL, setIconURL] = useState(deterministicImage(protocolID))
  const [description, setDescription] = useState('Protocol description not found.')
  const [imageError, setImageError] = useState(false)
  const [documentationURL, setDocumentationURL] = useState('https://docs.bsvblockchain.org')
  const { managers, settings } = useContext(WalletContext)
  const registrant = new RegistryClient(managers.permissionsManager)

  useEffect(() => {
    const cacheKey = `protocolInfo_${protocolID}_${securityLevel}`

    const fetchAndCacheData = async () => {
      // Try to load data from cache
      const cachedData = window.localStorage.getItem(cacheKey)
      if (cachedData) {
        const { name, iconURL, description, documentationURL } = JSON.parse(cachedData)
        setProtocolName(name)
        setIconURL(iconURL)
        setDescription(description)
        setDocumentationURL(documentationURL)
      }
      try {
        // Resolve a Protocol info from id and security level
        const certifiers = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
        const results = await registrant.resolve('protocol', {
          protocolID: [securityLevel as SecurityLevel, protocolID],
          registryOperators: certifiers
        })

        // Compute the most trusted of the results
        let mostTrustedIndex = 0
        let maxTrustPoints = 0
        for (let i = 0; i < results.length; i++) {
          const resultTrustLevel = settings.trustSettings.trustedCertifiers.find(x => x.identityKey === results[i].registryOperator)?.trust || 0
          if (resultTrustLevel > maxTrustPoints) {
            mostTrustedIndex = i
            maxTrustPoints = resultTrustLevel
          }
        }
        const trusted = results[mostTrustedIndex]

        // Update state and cache the results
        setProtocolName(trusted.name)
        setIconURL(trusted.iconURL)
        setDescription(trusted.description)
        setDocumentationURL(trusted.documentationURL)

        // Store data in local storage
        window.localStorage.setItem(cacheKey, JSON.stringify({
          name: trusted.name,
          iconURL: trusted.iconURL,
          description: trusted.description,
          documentationURL: trusted.documentationURL
        }))
      } catch (error) {
        console.error(error)
      }
    }

    fetchAndCacheData()
  }, [protocolID, securityLevel, settings])

  useEffect(() => {
    if (typeof protocolID === 'string') {
      // Update state if props change
      setProtocolName(protocolID)
      setIconURL(iconURL || deterministicImage(protocolID))
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
              src={iconURL}
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
