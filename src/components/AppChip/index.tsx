import { useState, useEffect } from 'react'
import { Chip, Badge, Tooltip, Avatar, Stack, Typography } from '@mui/material'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import isImageUrl from '../../utils/isImageUrl'
import { useTheme, styled } from '@mui/material/styles'
import { Img } from '@bsv/uhrp-react'
import Memory from '@mui/icons-material/Memory'
import CloseIcon from '@mui/icons-material/Close'
import { generateDefaultIcon } from '../../constants/popularApps'
import PlaceholderAvatar from '../PlaceholderAvatar'

// Create styled components for elements that need specific styling
const ChipContainer = styled('div')(() => ({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
}))

const ExpiryText = styled('span')(({ theme }) => ({
  position: 'absolute',
  opacity: 0,
  transition: 'opacity 0.3s ease',
  bottom: '-20px',
  left: '50%',
  transform: 'translateX(-50%)',
  backgroundColor: theme.palette.background.paper,
  padding: '2px 6px',
  borderRadius: '4px',
  boxShadow: theme.shadows[1],
  fontSize: '0.75rem',
  [`${ChipContainer}:hover &`]: {
    opacity: 1
  }
}))

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

  // Reset state values when label changes to prevent stale data
  useEffect(() => {
    // When label changes, reset to default state first to avoid showing stale data
    setParsedLabel(label)
    setAppIconImageUrl(generateDefaultIcon(label))
    setImageError(false)
  }, [label])

  // Handle data fetching in a separate effect
  useEffect(() => {
    const fetchAndCacheData = async () => {
      console.log(`AppChip: Fetching data for ${label}`)
      
      // Generate unique keys for this label
      const faviconKey = `favicon_label_${label}`
      const manifestKey = `manifest_label_${label}`

      // Try to load favicon from local storage
      const cachedFavicon = window.localStorage.getItem(faviconKey)
      if (cachedFavicon) {
        setAppIconImageUrl(cachedFavicon)
      }
      
      // Always try to fetch the latest favicon
      const faviconUrl = `https://${label}/favicon.ico`
      if (await isImageUrl(faviconUrl)) {
        setAppIconImageUrl(faviconUrl)
        window.localStorage.setItem(faviconKey, faviconUrl) 
      }

      // Try to load manifest from local storage
      const cachedManifest = window.localStorage.getItem(manifestKey)
      if (cachedManifest) {
        try {
          const manifest = JSON.parse(cachedManifest)
          if (manifest && manifest.name) {
            setParsedLabel(manifest.name)
          }
        } catch (e) {
          console.error('Error parsing cached manifest:', e)
          // If cache is corrupted, remove it
          window.localStorage.removeItem(manifestKey)
        }
      }

      try {
        const protocol = label.startsWith('localhost:') ? 'http' : 'https';
        const url = `${protocol}://${label}/manifest.json`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
        }

        const manifestResponse = await response.json();

        if (manifestResponse.name) {
          setParsedLabel(manifestResponse.name);
          window.localStorage.setItem(manifestKey, JSON.stringify(manifestResponse)); // Cache the manifest data
        }
      } catch (error) {
        console.error('Fetch error:', error); // Handle fetch errors
      }
    }

    fetchAndCacheData()
  }, [label])

  // Handle image loading events
  const handleImageLoad = () => {
    setImageError(false)
  }

  const handleImageError = () => {
    setImageError(true)
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="flex-start"
      sx={{
        height: '3em',
        width: '100%',
        gap: '0.75rem' // Add a more reasonable gap between the label and chip
      }}>
      <Typography variant="body1" fontWeight="bold">Application:</Typography>
      <ChipContainer>
        <Chip
          style={theme.templates?.chip ? theme.templates.chip({ size, backgroundColor }) : {
            height: `${size * 32}px`,
            minHeight: `${size * 32}px`,
            backgroundColor: backgroundColor || 'transparent',
            borderRadius: '16px',
            padding: '8px',
            margin: '4px'
          }}
          label={
            (showDomain && label !== parsedLabel)
              ? <div style={{
                textAlign: 'left'
              }}>
                <span
                  style={theme.templates?.chipLabelTitle ? theme.templates.chipLabelTitle({ size }) : {
                    fontSize: `${Math.max(size * 0.8, 0.8)}rem`,
                    fontWeight: '500'
                  }}
                >
                  {parsedLabel}
                </span>
                <br />
                <span
                  style={theme.templates?.chipLabelSubtitle || {
                    fontSize: '0.7rem',
                    opacity: 0.7
                  }}
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
                      backgroundColor: theme.palette.error.contrastText,
                      color: theme.palette.error.main,
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
                    backgroundColor: theme.palette.action.hover,
                    marginRight: '0.5em'
                  }}
                >
                  <Img
                    src={appIconImageUrl}
                    style={{
                      width: '75%',
                      height: '75%',
                      maxWidth: '5em'
                    }}
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
        {expires && <ExpiryText>{expires}</ExpiryText>}
      </ChipContainer>
    </Stack>
  )
}

export default withRouter(AppChip)
