import { useContext, useEffect, useState } from 'react'
import { Avatar, Chip, Divider, Stack, Typography } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import makeStyles from '@mui/styles/makeStyles'
import CloseIcon from '@mui/icons-material/Close'
import { useTheme } from '@mui/material/styles'
import style from './style'
import PlaceholderAvatar from '../PlaceholderAvatar'
import deterministicImage from '../../utils/deterministicImage'
import { WalletContext } from '../../WalletContext'
import { IdentityClient } from '@bsv/sdk'
import { Img } from '@bsv/uhrp-react'

const useStyles = makeStyles(style, {
  name: 'CounterpartyChip'
})

interface CounterpartyChipProps extends RouteComponentProps {
  counterparty: string
  clickable?: boolean
  size?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  expires?: string
  onCloseClick?: () => void
  canRevoke?: boolean
  label?: string
}

const CounterpartyChip: React.FC<CounterpartyChipProps> = ({
  counterparty,
  history,
  clickable = false,
  size = 1.3,
  onClick,
  expires,
  onCloseClick = () => { },
  canRevoke = false,
  label = 'Counterparty'
}) => {
  const theme = useTheme()
  const classes = useStyles()
  const [identity, setIdentity] = useState({
    name: 'Unknown',
    badgeLabel: 'Unknown',
    abbreviatedKey: counterparty.substring(0, 10),
    badgeIconURL: 'https://bsvblockchain.org/favicon.ico',
    avatarURL: deterministicImage(counterparty)
  })
  const [resolvedCounterparty, setResolvedCounterparty] = useState(counterparty)

  const [avatarError, setAvatarError] = useState(false)
  const [badgeError, setBadgeError] = useState(false)

  const { managers, adminOriginator } = useContext(WalletContext)

  // Handle image loading errors
  const handleAvatarError = () => {
    setAvatarError(true)
  }

  const handleBadgeError = () => {
    setBadgeError(true)
  }


  useEffect(() => {
    // Function to load and potentially update identity for a specific counterparty
    const loadIdentity = async (counterpartyKey) => {
      let actualCounterpartyKey = counterpartyKey // Store the actual key
      
      // Initial load from local storage for a specific counterparty
      const cachedIdentity = window.localStorage.getItem(`identity_${counterpartyKey}`)
      if (cachedIdentity) {
        setIdentity(JSON.parse(cachedIdentity))
      }

      try {
        // Resolve the counterparty key for 'self' or 'anyone'
        if (counterpartyKey === 'self') {
          actualCounterpartyKey = (await managers.permissionsManager.getPublicKey({ identityKey: true }, adminOriginator)).publicKey
          setResolvedCounterparty(actualCounterpartyKey) // Update resolved counterparty
        } else if (counterpartyKey === 'anyone') {
          actualCounterpartyKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
          setResolvedCounterparty(actualCounterpartyKey) // Update resolved counterparty
        } else {
          setResolvedCounterparty(counterpartyKey) // Keep original for regular counterparties
        }

        // Fetch the latest identity info from the server
        const identityClient = new IdentityClient(managers.permissionsManager, undefined, adminOriginator)
        const results = await identityClient.resolveByIdentityKey({ identityKey: actualCounterpartyKey })
        if (results && results.length > 0) {
          setIdentity(results[0])
          // Update component state and cache in local storage
          window.localStorage.setItem(`identity_${actualCounterpartyKey}`, JSON.stringify(results[0]))
        }
      } catch (e) {
        console.error(e)
      }
    }

    // Execute the loading function with the initial counterparty
    loadIdentity(counterparty)
  }, [counterparty, managers.permissionsManager, adminOriginator])

  return (
    <>
      <Divider />
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{
        height: '3em', width: '100%'
      }}>
        <Typography variant="body1" fontWeight="bold">
          {label}:
        </Typography>
        <Chip
          style={theme.templates?.chip ? theme.templates.chip({ size }) : {
            height: `${size * 32}px`,
            minHeight: `${size * 32}px`,
            backgroundColor: 'transparent',
            borderRadius: '16px',
            padding: '8px',
            margin: '4px'
          }}
          onDelete={onCloseClick}
          deleteIcon={canRevoke ? <CloseIcon /> : <></>}
          sx={{ '& .MuiTouchRipple-root': { display: clickable ? 'block' : 'none' } }}
          icon={
            identity.avatarURL && !avatarError ? (
              <Avatar alt={identity.name} sx={{ width: '2.5em', height: '2.5em' }}>
                <Img
                  src={identity.avatarURL}
                  alt={identity.name}
                  className={classes.table_picture}
                  onError={handleAvatarError}
                  loading="lazy"
                />
              </Avatar>
            ) : (
              <PlaceholderAvatar
                name={identity.name}
                sx={{ width: '2.5em', height: '2.5em' }}
              />
            )
          }
          label={
            <div style={theme.templates?.chipLabel || { display: 'flex', flexDirection: 'column' }}>
              <span style={theme.templates?.chipLabelTitle ? theme.templates.chipLabelTitle({ size }) : {
                fontSize: `${Math.max(size * 0.8, 0.8)}rem`,
                fontWeight: '500'
              }}>
                {counterparty === 'self' ? 'Self' : identity.name}
              </span>
              <span style={theme.templates?.chipLabelSubtitle || {
                fontSize: '0.7rem',
                opacity: 0.7
              }}>
                {counterparty === 'self' ? '' : (identity.abbreviatedKey || `${counterparty.substring(0, 10)}...`)}
              </span>
            </div>
          }
          onClick={e => {
            if (clickable) {
              if (typeof onClick === 'function') {
                onClick(e)
              } else {
                e.stopPropagation()
                // Use the resolved counterparty key instead of the original
                history.push({
                  pathname: `/dashboard/counterparty/${encodeURIComponent(resolvedCounterparty)}`
                })
              }
            }
          }}
        />
      </Stack>
      {expires && <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{
        height: '2.5em', width: '100%'
      }}>
        <span className={classes.expiryHoverText}>{expires}</span>
      </Stack>}
    </>
  )
}

export default withRouter(CounterpartyChip)
