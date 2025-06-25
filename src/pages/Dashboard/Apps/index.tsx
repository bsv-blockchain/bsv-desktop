import React, {
  useEffect,
  useState,
  useRef,
  ChangeEvent,
  FocusEvent,
  MouseEvent,
  useContext
} from 'react'
import {
  Typography,
  Container,
  TextField,
  LinearProgress,
  FormControl,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Chip,
  IconButton
} from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import { makeStyles } from '@mui/styles'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import ExploreIcon from '@mui/icons-material/Explore'
import Fuse from 'fuse.js'

import { openUrl } from '../../../utils/openUrl'

import style from './style'
import MetanetApp from '../../../components/MetanetApp'
import parseAppManifest from '../../../utils/parseAppManifest'
import isImageUrl from '../../../utils/isImageUrl'
import getApps from './getApps'
import { WalletContext } from '../../../WalletContext'
import { AppCatalog } from 'metanet-apps'
import type { PublishedApp } from 'metanet-apps/src/types'

// Define an interface to describe your app data
interface AppData {
  appName: string
  appIconImageUrl?: string
  domain: string
}

const useStyles = makeStyles(style, {
  name: 'Actions'
})

const Apps: React.FC = () => {
  const classes = useStyles()

  // State
  const [apps, setApps] = useState<AppData[]>([])
  const [filteredApps, setFilteredApps] = useState<AppData[]>([])
  const [catalogApps, setCatalogApps] = useState<PublishedApp[]>([])
  const [showCatalogModal, setShowCatalogModal] = useState<boolean>(false)
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false)
  const [fuseInstance, setFuseInstance] = useState<Fuse<AppData> | null>(null)
  const [search, setSearch] = useState<string>('')
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const cachedAppsKey = 'cached_apps'
  const catalog = new AppCatalog({})

  // Configuration for Fuse
  const options = {
    threshold: 0.3,
    location: 0,
    distance: 100,
    includeMatches: true,
    useExtendedSearch: true,
    keys: ['appName']
  }

  const { managers, adminOriginator } = useContext(WalletContext)

  // Handler for changes in the search TextField
  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)

    if (value === '') {
      setFilteredApps(apps)
      return
    }
    if (fuseInstance) {
      const results = fuseInstance.search(value).map(match => match.item)
      setFilteredApps(results)
    }
  }

  // Support the search field expand animation
  const handleSearchFocus = (e: FocusEvent<HTMLInputElement>) => {
    setIsExpanded(true)
  }

  const handleSearchBlur = (e: FocusEvent<HTMLInputElement>) => {
    setIsExpanded(false)
  }

  const handleIconClick = (e: MouseEvent<SVGSVGElement>) => {
    setIsExpanded(true)
    inputRef.current?.focus()
  }

  // Resolve additional data (icon, name) for each domain
  const resolveAppDataFromDomain = async ({
    appDomains
  }: {
    appDomains: string[]
  }): Promise<AppData[]> => {
    const dataPromises = appDomains.map(async domain => {
      let formattedDomain = domain
      if (domain.startsWith('https://')) {
        formattedDomain = domain.substring(8)
      }
      if (domain.startsWith('http://')) {
        formattedDomain = domain.substring(7)
      }
      let appIconImageUrl: string | undefined
      let appName: string = formattedDomain

      try {
        if (await isImageUrl(`https://${formattedDomain}/favicon.ico`)) {
          appIconImageUrl = `https://${formattedDomain}/favicon.ico`
        }
        // Attempt to fetch the manifest
        const manifest = await parseAppManifest({ domain })
        if (manifest && typeof manifest.name === 'string') {
          appName = manifest.name
        }
      } catch (error) {
        console.error(error)
      }

      return { appName, appIconImageUrl, domain }
    })

    return Promise.all(dataPromises)
  }

  // Load catalog apps
  const loadCatalogApps = async () => {
    setCatalogLoading(true)
    try {
      const apps = await catalog.findApps()
      setCatalogApps(apps)
    } catch (error) {
      console.error('Failed to load catalog apps:', error)
    }
    setCatalogLoading(false)
  }

  // Handle catalog modal
  const handleViewCatalog = () => {
    setShowCatalogModal(true)
    if (catalogApps.length === 0) {
      loadCatalogApps()
    }
  }

  const handleCloseCatalog = () => {
    setShowCatalogModal(false)
  }

  // On mount, load the apps & recent apps
  useEffect(() => {
    if (typeof managers.permissionsManager === 'object') {
      (async () => {
        try {
          // Check if there is storage app data for this session
          let parsedAppData: AppData[] | null = JSON.parse(
            window.localStorage.getItem(cachedAppsKey) || 'null'
          )

          if (parsedAppData) {
            setApps(parsedAppData)
            setFilteredApps(parsedAppData)
          } else {
            setLoading(true)
          }

          // Fetch app domains
          const appDomains = await getApps({ permissionsManager: managers.permissionsManager, adminOriginator })
          parsedAppData = await resolveAppDataFromDomain({ appDomains })
          parsedAppData.sort((a, b) => a.appName.localeCompare(b.appName))

          // Cache them
          window.localStorage.setItem(cachedAppsKey, JSON.stringify(parsedAppData))

          setApps(parsedAppData)
          setFilteredApps(parsedAppData)

          // Initialize Fuse
          const fuse = new Fuse(parsedAppData, options)
          setFuseInstance(fuse)
        } catch (error) {
          console.error(error)
        }
        setLoading(false)
      })()
    }
  }, [managers?.permissionsManager])

  return (
    <div className={classes.apps_view}>
      <Container
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
          Apps
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          Browse and manage your application permissions.
        </Typography>

        {/* View App Catalog Button */}
        <Button
          variant="outlined"
          startIcon={<ExploreIcon />}
          onClick={handleViewCatalog}
          sx={{ mb: 2 }}
        >
          View App Catalog
        </Button>

        <FormControl sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <TextField
            variant='outlined'
            value={search}
            onChange={handleSearchChange}
            placeholder='Search'
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            inputRef={inputRef}
            slotProps={{
              input: {
                startAdornment: (
                  <SearchIcon
                    onClick={handleIconClick}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                  />
                ),
                sx: {
                  borderRadius: '25px',
                  height: '3em'
                }
              }
            }}
            sx={{
              marginTop: '24px',
              marginBottom: '16px',
              width: isExpanded ? 'calc(50%)' : '8em',
              transition: 'width 0.3s ease'
            }}
          />
        </FormControl>
      </Container>

      <Typography
        variant="subtitle2"
        color="textSecondary"
        align="center"
        sx={{
          marginBottom: '1em'
        }}
      >
        {loading && 'Loading your apps...'}
        {!loading && apps.length === 0 && 'You have no apps yet.'}
        {!loading && apps.length !== 0 && filteredApps.length === 0 && 'No apps match your search.'}
      </Typography>

      <Container>
        <Grid2
          container
          spacing={3}
          alignItems='center'
          justifyContent='left'
          className={classes.apps_view}
        >
          {filteredApps.map((app) => (
            <Grid2 key={app.domain} size={{ xs: 6, sm: 6, md: 3, lg: 2 }} className={classes.gridItem}>
              <MetanetApp
                appName={app.appName}
                domain={app.domain}
                iconImageUrl={app.appIconImageUrl}
              />
            </Grid2>
          ))}
        </Grid2>
      </Container>

      {loading && <LinearProgress style={{ marginTop: '1em' }} />}

      {/* App Catalog Modal */}
      <Dialog
        open={showCatalogModal}
        onClose={handleCloseCatalog}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            minHeight: '70vh',
            maxHeight: '90vh'
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h5">Popular Apps Catalog</Typography>
          <IconButton onClick={handleCloseCatalog} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          {catalogLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
              <LinearProgress sx={{ width: '100%', mb: 2 }} />
              <Typography variant="body2" color="textSecondary">
                Loading popular apps...
              </Typography>
            </Box>
          ) : catalogApps.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="textSecondary">
                No apps found in the catalog.
              </Typography>
            </Box>
          ) : (
            <Grid2 container spacing={3}>
              {catalogApps.map((app) => (
                <Grid2 key={`${app.token.txid}-${app.token.outputIndex}`} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Box
                    sx={{
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 2,
                      p: 2,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: 'primary.main',
                        transform: 'translateY(-2px)',
                        boxShadow: 2
                      }
                    }}
                    onClick={() => {
                      if (app.metadata.httpURL) {
                        openUrl(app.metadata.httpURL)
                      } else if (app.metadata.domain) {
                        openUrl(`https://${app.metadata.domain}`)
                      }
                    }}
                  >
                    {/* App Icon and Name */}
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      {app.metadata.icon && (
                        <Box
                          component="img"
                          src={app.metadata.icon}
                          alt={app.metadata.name}
                          sx={{
                            width: 48,
                            height: 48,
                            borderRadius: 1,
                            mr: 2,
                            objectFit: 'cover'
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      )}
                      <Box>
                        <Typography variant="h6" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                          {app.metadata.name}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {app.metadata.domain}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Description */}
                    <Typography
                      variant="body2"
                      color="textSecondary"
                      sx={{
                        mb: 2,
                        flexGrow: 1,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}
                    >
                      {app.metadata.description}
                    </Typography>

                    {/* Tags */}
                    {app.metadata.tags && app.metadata.tags.length > 0 && (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                        {app.metadata.tags.slice(0, 3).map((tag, tagIndex) => (
                          <Chip
                            key={tagIndex}
                            label={tag}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: '0.7rem' }}
                          />
                        ))}
                        {app.metadata.tags.length > 3 && (
                          <Chip
                            label={`+${app.metadata.tags.length - 3}`}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                    )}

                    {/* Category and Release Date */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {app.metadata.category && (
                        <Chip
                          label={app.metadata.category}
                          size="small"
                          color="primary"
                          variant="filled"
                          sx={{ fontSize: '0.7rem' }}
                        />
                      )}
                      <Typography variant="caption" color="textSecondary">
                        {new Date(app.metadata.release_date).toLocaleDateString()}
                      </Typography>
                    </Box>
                  </Box>
                </Grid2>
              ))}
            </Grid2>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleCloseCatalog}>Close</Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

export default Apps
