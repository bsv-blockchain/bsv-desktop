import { useState, useEffect } from 'react'
import { Chip, Badge, Tooltip, Avatar, Stack, Typography } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import boomerang from 'boomerang-http'
import isImageUrl from '../../utils/isImageUrl'
import { useTheme } from '@mui/styles'
// import confederacyHost from '../../utils/confederacyHost'
// import { Img } from 'uhrp-react'
import Memory from '@mui/icons-material/Memory'
import makeStyles from '@mui/styles/makeStyles'
import CloseIcon from '@mui/icons-material/Close'
import style from './style'
import { generateDefaultIcon } from '../../constants/popularApps'
import PlaceholderAvatar from '../PlaceholderAvatar'

const useStyles = makeStyles(style, {
  name: 'AppChip'
})

interface AppChipProps extends RouteComponentProps {
  label: string
  showDomain?: boolean
  clickable?: boolean
  size?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  backgroundColor?: string
  expires?: string
  onCloseClick?: () => void
}

const AppChip: React.FC<AppChipProps> = ({
  label,
  showDomain = false,
  history,
  clickable = true,
  size = 1,
  onClick,
  backgroundColor = 'transparent',
  expires,
  onCloseClick
}) => {
  const theme = useTheme()
  const classes = useStyles()
  if (typeof label !== 'string') {
    throw new Error('Error in AppChip: label prop must be a string!')
  }
  if (label.startsWith('babbage_app_')) {
    label = label.substring(12)
  }
  if (label.startsWith('https://')) {
    label = label.substring(8)
  }
  if (label.startsWith('http://')) {
    label = label.substring(7)
  }
  const [parsedLabel, setParsedLabel] = useState(label)
  const [appIconImageUrl, setAppIconImageUrl] = useState(generateDefaultIcon(label))
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    const fetchAndCacheData = async () => {
      const faviconKey = `favicon_label_${label}`
      const manifestKey = `manifest_label_${label}`

      // Load favicon from local storage
      const cachedFavicon = window.localStorage.getItem(faviconKey)
      if (cachedFavicon) {
        setAppIconImageUrl(cachedFavicon)
      }
      const faviconUrl = `https://${label}/favicon.ico`
      if (await isImageUrl(faviconUrl)) {
        setAppIconImageUrl(faviconUrl)
        window.localStorage.setItem(faviconKey, faviconUrl) // Cache the favicon URL
      }

      // Load manifest from local storage
      const cachedManifest = window.localStorage.getItem(manifestKey)
      if (cachedManifest) {
        const manifest = JSON.parse(cachedManifest)
        setParsedLabel(manifest.name)
      }

      try {
        const manifestResponse = await boomerang(
          'GET',
          `${label.startsWith('localhost:') ? 'http' : 'https'}://${label}/manifest.json`
        )
        if (manifestResponse.name) {
          setParsedLabel(manifestResponse.name)
          window.localStorage.setItem(manifestKey, JSON.stringify(manifestResponse)) // Cache the manifest data
        }
      } catch (error) {
        console.error(error) // Handle fetch errors
      }
    }

    fetchAndCacheData()
  }, [label, setAppIconImageUrl, setParsedLabel])

  // Handle image loading events
  const handleImageLoad = () => {
    setImageError(false)
  }

  const handleImageError = () => {
    setImageError(true)
  }

  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{
      height: '3em', width: '100%'
    }}>
      <Typography variant="body1" fontWeight="bold">Application:</Typography>
        <div className={classes.chipContainer}>
        <Chip
          style={(theme as any).templates.chip({ size, backgroundColor })}
          label={
            (showDomain && label !== parsedLabel)
            ? <div style={{
              textAlign: 'left'
            }}>
              <span
                style={(theme as any).templates.chipLabelTitle({ size })}
              >
                {parsedLabel}
              </span>
              <br />
              <span
                style={(theme as any).templates.chipLabelSubtitle}
              >
                {label}
              </span>
            </div>
            : <span style={{ fontSize: `${size}em` }}>{parsedLabel}</span>
        }
        onDelete={onCloseClick}
        deleteIcon={typeof onCloseClick === 'function' ? <CloseIcon /> : undefined}
        icon={(
          <Badge
            overlap='circular'
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right'
            }}
            badgeContent={
              <Tooltip
                arrow
                title='App (click to learn more about apps)'
                onClick={e => {
                  e.stopPropagation()
                  window.open(
                    'https://projectbabbage.com/docs/babbage-sdk/concepts/apps',
                    '_blank'
                  )
                }}
              >
                <Avatar
                  sx={{
                    backgroundColor: '#FFFFFF',
                    color: 'darkRed',
                    width: 20,
                    height: 20,
                    borderRadius: '10px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    fontSize: '1.2em',
                    marginRight: '0.25em',
                    marginBottom: '0.3em'
                  }}
                >
                  <Memory style={{ width: 16, height: 16 }} />
                </Avatar>
              </Tooltip>
            }
          >
            {!imageError ? (
              <Avatar
                variant='square'
                sx={{
                  width: '2.2em',
                  height: '2.2em',
                  borderRadius: '4px',
                  backgroundColor: '#000000AF',
                  marginRight: '0.5em'
                }}
              >
                <img
                  src={appIconImageUrl}
                  style={{ width: '75%', height: '75%' }}
                  className={classes.table_picture}
                  alt={`${parsedLabel} app icon`}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              </Avatar>
            ) : (
              <PlaceholderAvatar
                name={parsedLabel || label}
                variant="square"
                size={2.2 * 16} 
                sx={{ borderRadius: '4px', marginRight: '0.5em' }}
              />
            )}
          </Badge>
        )}
        onClick={(e: any) => {
          if (clickable) {
            if (typeof onClick === 'function') {
              onClick(e)
            } else {
              e.stopPropagation()
              history.push(
                `/dashboard/app/${encodeURIComponent(label)}`
              )
            }
          }
        }}
      />
      <span className={classes.expiryHoverText}>{expires}</span>
    </div>
    </Stack>
  )
}

export default withRouter(AppChip)
