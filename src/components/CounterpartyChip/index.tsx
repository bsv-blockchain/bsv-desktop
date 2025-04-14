/* eslint-disable react/prop-types */
import { useContext, useEffect, useState } from 'react'
import { Avatar, Badge, Chip, Divider, Icon, Stack, Typography } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import makeStyles from '@mui/styles/makeStyles'
import CloseIcon from '@mui/icons-material/Close'
import { useTheme } from '@mui/styles'
import style from './style'
import PlaceholderAvatar from '../PlaceholderAvatar'
import deterministicImage from '../../utils/deterministicImage'
import { WalletContext } from '../../WalletContext'
import { IdentityClient } from '@bsv/sdk'

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

  const [avatarError, setAvatarError] = useState(false)
  const [badgeError, setBadgeError] = useState(false)

  const { managers } = useContext(WalletContext)

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
      // Initial load from local storage for a specific counterparty
      const cachedIdentity = window.localStorage.getItem(`identity_${counterpartyKey}`)
      if (cachedIdentity) {
        setIdentity(JSON.parse(cachedIdentity))
      }

      try {
        // Resolve the counterparty key for 'self' or 'anyone'
        if (counterpartyKey === 'self') {
          counterpartyKey = (await managers.permissionsManager.getPublicKey({ identityKey: true })).publicKey
        } else if (counterpartyKey === 'anyone') {
          counterpartyKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
        }

        // Fetch the latest identity info from the server
        const identityClient = new IdentityClient(managers.permissionsManager)
        const results = await identityClient.resolveByIdentityKey({ identityKey: counterpartyKey })
        if (results && results.length > 0) {
          setIdentity(results[0])
          // Update component state and cache in local storage
          window.localStorage.setItem(`identity_${counterpartyKey}`, JSON.stringify(results[0]))
        }
      } catch (e) {
        console.error(e)
      }
    }

    // Execute the loading function with the initial counterparty
    loadIdentity(counterparty)
  }, [counterparty])

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
          component="div"
          style={(theme as any).templates.chip({ size })}
          onDelete={onCloseClick}
          deleteIcon={canRevoke ? <CloseIcon /> : <></>}
          sx={{ '& .MuiTouchRipple-root': { display: clickable ? 'block' : 'none' } }}
          label={
            <div style={(theme as any).templates.chipLabel}>
              <span style={(theme as any).templates.chipLabelTitle({ size })}>
                {counterparty === 'self' ? 'Self' : identity.name}
              </span>
              <span style={(theme as any).templates.chipLabelSubtitle}>
                {counterparty === 'self' ? '' : (identity.abbreviatedKey || `${counterparty.substring(0, 10)}...`)}
              </span>
            </div>
          }
          icon={
            <Badge
              overlap='circular'
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              badgeContent={
                !badgeError ? (
                  <Icon style={{ width: '20px', height: '20px', backgroundColor: 'white', borderRadius: '20%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img
                      style={{ width: '95%', height: '95%', objectFit: 'cover', borderRadius: '20%' }}
                      src={identity.badgeIconURL}
                      alt={`${identity.badgeLabel} badge`}
                      onError={handleBadgeError}
                      loading="lazy"
                    />
                  </Icon>
                ) : (
                  <Avatar
                    sx={{
                      width: '20px',
                      height: '20px',
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      fontSize: '10px'
                    }}
                  >
                    ID
                  </Avatar>
                )
              }
            >
              {!avatarError ? (
                <Avatar alt={identity.name} sx={{ width: '2.5em', height: '2.5em' }}>
                  <img
                    src={identity.avatarURL}
                    alt={identity.name}
                    className={classes.table_picture}
                    onError={handleAvatarError}
                    loading="lazy"
                  />
                </Avatar>
              ) : (
                <PlaceholderAvatar
                  name={identity.name !== 'Unknown' ? identity.name : counterparty.substring(0, 10)}
                  size={2.5 * 16}
                />
              )}
            </Badge>
          }
          onClick={e => {
            if (clickable) {
              if (typeof onClick === 'function') {
                onClick(e)
              } else {
                e.stopPropagation()
                history.push({
                  pathname: `/dashboard/counterparty/${encodeURIComponent(counterparty)}`
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
