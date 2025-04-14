import { useContext, useEffect, useState } from 'react'
import { Chip, Badge, Avatar, Tooltip, Stack, Typography, Divider } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import makeStyles from '@mui/styles/makeStyles'
import style from './style'
import { generateDefaultIcon } from '../../constants/popularApps'
import { useTheme } from '@mui/styles'
import ShoppingBasket from '@mui/icons-material/ShoppingBasket'
import { WalletContext } from '../../WalletContext'
import { RegistryClient } from '@bsv/sdk'

const useStyles = makeStyles(style as any, {
  name: 'BasketChip'
})

interface BasketChipProps extends RouteComponentProps {
  basketId: string
  lastAccessed?: string
  domain?: string
  clickable?: boolean
  size?: number
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  expires?: string
  onCloseClick?: () => void
  canRevoke?: boolean
}

const BasketChip: React.FC<BasketChipProps> = ({
  basketId,
  lastAccessed,
  domain,
  history,
  clickable = false,
  size = 1.3,
  onClick,
  expires,
  onCloseClick = () => { },
  canRevoke = false
}) => {
  const {
    managers,
    settings,
  } = useContext(WalletContext)

  if (typeof basketId !== 'string') {
    throw new Error('BasketChip was initialized without a valid basketId')
  }
  const classes = useStyles()
  const theme = useTheme()

  // Initialize BasketMap
  const registrant = new RegistryClient(managers.permissionsManager)

  const [basketName, setBasketName] = useState(basketId)
  const [iconURL, setIconURL] = useState(generateDefaultIcon(basketId))
  const [description, setDescription] = useState('Basket description not found.')
  const [documentationURL, setDocumentationURL] = useState('https://docs.bsvblockchain.org')

  useEffect(() => {
    const cacheKey = `basketInfo_${basketId}`

    const fetchAndCacheData = async () => {
      // Try to load data from cache
      const cachedData = window.localStorage.getItem(cacheKey)
      if (cachedData) {
        const { name, iconURL, description, documentationURL } = JSON.parse(cachedData)
        setBasketName(name)
        setIconURL(iconURL)
        setDescription(description)
        setDocumentationURL(documentationURL)
      }
      try {
        // Fetch basket info by ID and trusted entities' public keys
        const trustedEntities = settings.trustSettings.trustedCertifiers.map(x => x.identityKey)
        const results = await registrant.resolve('basket', {
          basketID: basketId,
          registryOperators: trustedEntities
        })

        if (results && results.length > 0) {
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
          const basket = results[mostTrustedIndex]

          // Update state and cache the results
          setBasketName(basket.name)
          setIconURL(basket.iconURL)
          setDescription(basket.description)
          setDocumentationURL(basket.documentationURL)

          // TODO: Store data in local storage
          window.localStorage.setItem(cacheKey, JSON.stringify({
            name: basket.name,
            iconURL: basket.iconURL,
            description: basket.description,
            documentationURL: basket.documentationURL
          }))
        }
      } catch (error) {
        console.error(error)
      }
    }

    fetchAndCacheData()
  }, [basketId, settings])

  return (
    <Stack direction="column" spacing={1} alignItems="space-between">
      <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between" sx={{
        height: '3em', width: '100%'
      }}>
        <Typography variant="body1" fontWeight="bold">Basket:</Typography>
        <Chip
          style={(theme as any).templates.chip({ size })}
          sx={{
            '& .MuiChip-label': {
              width: '100% !important'
            }
          }}
          label={
            <div style={(theme as any).templates.chipLabel}>
              <span style={(theme as any).templates.chipLabelTitle({ size })}>
                <b>{basketName}</b>
              </span>
              <span style={(theme as any).templates.chipLabelSubtitle}>
                {lastAccessed || description}
              </span>
            </div>
          }
          onDelete={() => {
            onCloseClick()
          }}
          deleteIcon={canRevoke ? <CloseIcon /> : <></>}
          // disableRipple={!clickable}
          icon={
            <Badge
              overlap='circular'
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right'
              }}
              badgeContent={
                <Tooltip
                  arrow
                  title='Token Basket (click to learn more about baskets)'
                  onClick={e => {
                    e.stopPropagation()
                    window.open(
                      'https://projectbabbage.com/docs/babbage-sdk/concepts/baskets',
                      '_blank'
                    )
                  }}
                >
                  <Avatar
                    sx={{
                      backgroundColor: '#FFFFFF',
                      color: 'green',
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
                    <ShoppingBasket style={{ width: 16, height: 16 }} />
                  </Avatar>
                </Tooltip>
              }
            >
              <Avatar
                variant='square'
                sx={{
                  width: '2.2em',
                  height: '2.2em',
                  borderRadius: '4px',
                  backgroundColor: '#000000AF'
                }}
              >
                <img // Img (TODO: UHRP)
                  src={iconURL}
                  style={{ width: '75%', height: '75%' }}
                  className={classes.table_picture}
                // confederacyHost={confederacyHost()}
                />
              </Avatar>
            </Badge>
          }
          onClick={(e: React.MouseEvent<HTMLDivElement>) => {
            if (clickable) {
              if (typeof onClick === 'function') {
                onClick(e)
              } else {
                e.stopPropagation()
                history.push({
                  pathname: `/dashboard/basket/${encodeURIComponent(basketId)}`,
                  state: {
                    id: basketId,
                    name: basketName,
                    description,
                    iconURL,
                    documentationURL,
                  }
                })
              }
            }
          }}
        />
      </Stack>
      {expires &&
        <>
          <Divider />
          <Stack sx={{
            height: '3em', width: '100%'
          }}>
            {expires}
          </Stack>
        </>}
    </Stack>
  )
}

export default withRouter(BasketChip)
