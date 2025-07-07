import React, {
  useEffect,
  useState,
  useRef,
  ChangeEvent,
  useContext
} from 'react'
import {
  Typography,
  Container,
  TextField,
  FormControl,
  Button,
  Box,
  Divider,
  Fade,
  Tooltip
} from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import { makeStyles } from '@mui/styles'
import SearchIcon from '@mui/icons-material/Search'
import ExploreIcon from '@mui/icons-material/Explore'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import Fuse from 'fuse.js'
import { useHistory } from 'react-router-dom'

import style from './style'
import MetanetApp from '../../../components/MetanetApp'
import AppLogo from '../../../components/AppLogo'
import { WalletContext } from '../../../WalletContext'
import useOptimizedApps from '../../../hooks/useOptimizedApps'

// Define an interface to describe your app data
interface AppData {
  appName: string
  appIconImageUrl?: string
  domain: string
  isPinned?: boolean
}

const useStyles = makeStyles(style, {
  name: 'Actions'
})

const Apps: React.FC = () => {
  const classes = useStyles()
  const history = useHistory()
  const { managers, adminOriginator } = useContext(WalletContext)

  // State for UI and search
  const [filteredApps, setFilteredApps] = useState<AppData[]>([])
  const [fuseInstance, setFuseInstance] = useState<Fuse<AppData> | null>(null)
  const [search, setSearch] = useState<string>('')
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const [pinnedApps, setPinnedApps] = useState<Set<string>>(new Set())

  const inputRef = useRef<HTMLInputElement>(null)
  const pinnedAppsKey = 'pinned_apps'

  // Use optimized apps hook for progressive loading
  const { apps, loading, error, refreshApps, progress } = useOptimizedApps({
    permissionsManager: managers?.permissionsManager,
    adminOriginator,
    pinnedApps
  })

  // Show metanet loading indicator only if we're loading and have no apps to show
  const showMetanetLoading = loading && apps.length === 0

  // Configuration for Fuse
  const options = {
    threshold: 0.3,
    location: 0,
    distance: 100,
    includeMatches: true,
    useExtendedSearch: true,
    keys: ['appName']
  }

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)

    // Apply search immediately, with or without Fuse
    applySearch(value, apps, fuseInstance)
  }

  // Load pinned apps from localStorage
  const loadPinnedApps = () => {
    try {
      const stored = window.localStorage.getItem(pinnedAppsKey)
      if (stored) {
        setPinnedApps(new Set(JSON.parse(stored)))
      }
    } catch (error) {
      console.error('Error loading pinned apps:', error)
    }
  }

  // Save pinned apps to localStorage
  const savePinnedApps = (pinned: Set<string>) => {
    try {
      window.localStorage.setItem(pinnedAppsKey, JSON.stringify(Array.from(pinned)))
    } catch (error) {
      console.error('Error saving pinned apps:', error)
    }
  }

  // Toggle pin status for an app
  const togglePin = (domain: string) => {
    const newPinnedApps = new Set(pinnedApps)
    if (newPinnedApps.has(domain)) {
      newPinnedApps.delete(domain)
    } else {
      newPinnedApps.add(domain)
    }
    setPinnedApps(newPinnedApps)
    savePinnedApps(newPinnedApps)

    // Apps will be updated automatically by the hook
  }

  // Separate function to apply search logic
  const applySearch = (searchValue: string, appList: AppData[], fuse: Fuse<AppData> | null) => {
    if (searchValue === '') {
      setFilteredApps(appList)
      return
    }

    if (fuse) {
      // Use Fuse for fuzzy search when available
      const results = fuse.search(searchValue)
      setFilteredApps(results.map(result => result.item))
    } else {
      // Fallback to simple string matching when Fuse isn't ready
      const filtered = appList.filter(app =>
        app.appName.toLowerCase().includes(searchValue.toLowerCase()) ||
        app.domain.toLowerCase().includes(searchValue.toLowerCase())
      )
      setFilteredApps(filtered)
    }
  }

  const handleFocus = () => {
    setIsExpanded(true)
  }

  const handleBlur = () => {
    setIsExpanded(false)
  }

  const handleIconClick = () => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  const handleViewCatalog = () => {
    history.push('/dashboard/app-catalog')
  }

  // On mount, load the apps & recent apps
  useEffect(() => {
    // Load pinned apps on component mount
    loadPinnedApps()
  }, [])

  // Update search results when apps change
  useEffect(() => {
    if (apps.length > 0) {
      // Initialize or update Fuse instance
      const fuse = new Fuse(apps, options)
      setFuseInstance(fuse)
      // Apply current search
      applySearch(search, apps, fuse)
    } else {
      setFilteredApps([])
    }
  }, [apps, search])

  // Show metanet loading indicator when no cached apps are available
  if (showMetanetLoading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'inherit',
        zIndex: 1000
      }}>
        <AppLogo rotate size={128} />
      </div>
    )
  }

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
            onFocus={handleFocus}
            onBlur={handleBlur}
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

      {/* Show error state only if there's an error and no apps */}
      {error && apps.length === 0 && (
        <Typography
          variant="subtitle2"
          color="error"
          align="center"
          sx={{ marginBottom: '1em' }}
        >
          Failed to load apps.
          <Button
            size="small"
            onClick={refreshApps}
            sx={{ ml: 1 }}
          >
            Retry
          </Button>
        </Typography>
      )}

      {/* Show empty state only if no apps and not loading */}
      {!loading && apps.length === 0 && !error && (
        <Typography
          variant="subtitle2"
          color="textSecondary"
          align="center"
          sx={{ marginBottom: '1em' }}
        >
          You have no recent apps yet.
        </Typography>
      )}

      {/* Show no search results only when we have apps but none match search */}
      {apps.length > 0 && filteredApps.length === 0 && search.trim() !== '' && (
        <Typography
          variant="subtitle2"
          color="textSecondary"
          align="center"
          sx={{ marginBottom: '1em' }}
        >
          No apps match your search.
        </Typography>
      )}

      <Container>
        {filteredApps.length > 0 && (
          <>
            {/* Pinned Apps Section */}
            {(() => {
              const pinnedFilteredApps = filteredApps.filter(app => app.isPinned)
              if (pinnedFilteredApps.length === 0) return null

              return (
                <Fade in={true} timeout={300}>
                  <Box sx={{ mb: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <PushPinIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.2rem' }} />
                      <Typography variant="h6" color="primary" sx={{ fontWeight: 600 }}>
                        Pinned Apps
                      </Typography>
                    </Box>
                    <Grid2
                      container
                      spacing={3}
                      alignItems='center'
                      justifyContent='left'
                      className={classes.apps_view}
                    >
                      {pinnedFilteredApps.map((app) => (
                        <Grid2 key={app.domain} size={{ xs: 6, sm: 6, md: 3, lg: 2 }} className={classes.gridItem}>
                          <Box sx={{ position: 'relative' }}>
                            <MetanetApp
                              appName={app.appName}
                              domain={app.domain}
                              iconImageUrl={app.appIconImageUrl}
                            />
                            <Tooltip title="Unpin app" placement="top">
                              <Box
                                onClick={(e) => {
                                  e.stopPropagation()
                                  togglePin(app.domain)
                                }}
                                sx={{
                                  position: 'absolute',
                                  top: 6,
                                  right: 6,
                                  backgroundColor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(255, 255, 255, 0.15)'
                                    : 'rgba(0, 0, 0, 0.7)',
                                  borderRadius: '50%',
                                  width: 28,
                                  height: 28,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  opacity: 1,
                                  transition: 'all 0.2s ease',
                                  backdropFilter: 'blur(4px)',
                                  border: (theme) => theme.palette.mode === 'dark'
                                    ? '1px solid rgba(255, 255, 255, 0.2)'
                                    : 'none',
                                  '&:hover': {
                                    backgroundColor: (theme) => theme.palette.mode === 'dark'
                                      ? 'rgba(255, 255, 255, 0.25)'
                                      : 'rgba(0, 0, 0, 0.85)',
                                    transform: 'scale(1.05)'
                                  }
                                }}
                              >
                                <PushPinIcon
                                  sx={{
                                    color: (theme) => theme.palette.mode === 'dark'
                                      ? 'rgba(255, 255, 255, 0.9)'
                                      : 'white',
                                    fontSize: '1rem'
                                  }}
                                />
                              </Box>
                            </Tooltip>
                          </Box>
                        </Grid2>
                      ))}
                    </Grid2>
                  </Box>
                </Fade>
              )
            })()}

            {/* Regular Apps Section */}
            {(() => {
              const unpinnedFilteredApps = filteredApps.filter(app => !app.isPinned)
              if (unpinnedFilteredApps.length === 0) return null

              const showDivider = filteredApps.some(app => app.isPinned)

              return (
                <Fade in={true} timeout={400}>
                  <Box>
                    {showDivider && (
                      <>
                        <Divider sx={{ mb: 3, opacity: 0.3 }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                          <Typography variant="h6" color="textSecondary" sx={{ fontWeight: 500 }}>
                            All Apps
                          </Typography>
                        </Box>
                      </>
                    )}
                    <Grid2
                      container
                      spacing={3}
                      alignItems='center'
                      justifyContent='left'
                      className={classes.apps_view}
                    >
                      {unpinnedFilteredApps.map((app) => (
                        <Grid2 key={app.domain} size={{ xs: 6, sm: 6, md: 3, lg: 2 }} className={classes.gridItem}>
                          <Box
                            sx={{
                              position: 'relative',
                              '&:hover .pin-button': {
                                opacity: 1,
                                transform: 'scale(1)'
                              }
                            }}
                          >
                            <MetanetApp
                              appName={app.appName}
                              domain={app.domain}
                              iconImageUrl={app.appIconImageUrl}
                            />
                            <Tooltip title="Pin app" placement="top">
                              <Box
                                className="pin-button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  togglePin(app.domain)
                                }}
                                sx={{
                                  position: 'absolute',
                                  top: 6,
                                  right: 6,
                                  backgroundColor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(255, 255, 255, 0.15)'
                                    : 'rgba(0, 0, 0, 0.7)',
                                  borderRadius: '50%',
                                  width: 28,
                                  height: 28,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  opacity: 0,
                                  transform: 'scale(0.8)',
                                  transition: 'all 0.2s ease',
                                  backdropFilter: 'blur(4px)',
                                  border: (theme) => theme.palette.mode === 'dark'
                                    ? '1px solid rgba(255, 255, 255, 0.2)'
                                    : 'none',
                                  '&:hover': {
                                    backgroundColor: (theme) => theme.palette.mode === 'dark'
                                      ? 'rgba(255, 255, 255, 0.25)'
                                      : 'rgba(0, 0, 0, 0.85)',
                                    transform: 'scale(1.05)'
                                  }
                                }}
                              >
                                <PushPinOutlinedIcon
                                  sx={{
                                    color: (theme) => theme.palette.mode === 'dark'
                                      ? 'rgba(255, 255, 255, 0.9)'
                                      : 'white',
                                    fontSize: '1rem'
                                  }}
                                />
                              </Box>
                            </Tooltip>
                          </Box>
                        </Grid2>
                      ))}
                    </Grid2>
                  </Box>
                </Fade>
              )
            })()}
          </>
        )}

        {/* Show a subtle progress indicator at the bottom if still loading */}
        {loading && apps.length > 0 && (
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            mt: 3,
            opacity: 0.6
          }}>
            <Typography variant="caption" color="textSecondary">
              Updating app details... ({Math.round((progress || 0) * 100)}%)
            </Typography>
          </Box>
        )}
      </Container>
    </div>
  )
}

export default Apps
