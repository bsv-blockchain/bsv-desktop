/* eslint-disable react/prop-types */
import { useState } from 'react'
import { Avatar, Badge, Chip, Divider, Icon, Stack, Tooltip, Typography } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
// import { Signia } from 'babbage-signia'
// import { Img } from 'uhrp-react'
import makeStyles from '@mui/styles/makeStyles'
import CloseIcon from '@mui/icons-material/Close'
import { useTheme } from '@mui/styles'
import style from './style'
import PlaceholderAvatar from '../PlaceholderAvatar'
import { generateDefaultIcon } from '../../constants/popularApps'
import deterministicImage from '../../utils/deterministicImage'
// import confederacyHost from '../../utils/confederacyHost'
// import { discoverByIdentityKey, getPublicKey } from '@babbage/sdk-ts'
// import { defaultIdentity, parseIdentity } from 'identinator'

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
  // const signia = new Signia()
  // signia.config.confederacyHost = confederacyHost()

  const theme = useTheme()
  const classes = useStyles()

  //TODO: const [signiaIdentity, setSigniaIdentity] = useState(defaultIdentity)
  const [signiaIdentity] = useState({
    name: 'Unknown',
    badgeLabel: 'Unknown',
    abbreviatedKey: counterparty.substring(0, 10),
    badgeIconURL: 'https://projectbabbage.com/favicon.ico',
    avatarURL: deterministicImage(counterparty)
  })
  
  const [avatarError, setAvatarError] = useState(false)
  const [badgeError, setBadgeError] = useState(false)

  // Handle image loading errors
  const handleAvatarError = () => {
    setAvatarError(true)
  }
  
  const handleBadgeError = () => {
    setBadgeError(true)
  }

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
                {counterparty === 'self' ? 'Self' : signiaIdentity.name}
              </span>
              <span style={(theme as any).templates.chipLabelSubtitle}>
                {counterparty === 'self' ? '' : (signiaIdentity.abbreviatedKey || `${counterparty.substring(0, 10)}...`)}
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
                        src={signiaIdentity.badgeIconURL}
                        alt={`${signiaIdentity.badgeLabel} badge`}
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
                  <Avatar alt={signiaIdentity.name} sx={{ width: '2.5em', height: '2.5em' }}>
                    <img
                      src={signiaIdentity.avatarURL}
                      alt={signiaIdentity.name}
                      className={classes.table_picture}
                      onError={handleAvatarError}
                      loading="lazy"
                    />
                  </Avatar>
                ) : (
                  <PlaceholderAvatar
                    name={signiaIdentity.name !== 'Unknown' ? signiaIdentity.name : counterparty.substring(0, 10)}
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
