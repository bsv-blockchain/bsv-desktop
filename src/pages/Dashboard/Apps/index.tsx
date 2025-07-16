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
import { WalletContext } from '../../../WalletContext'
import { getRecentApps, RecentApp, updateRecentApp } from './getApps'
import { Utils } from '@bsv/sdk'

const useStyles = makeStyles(style, {
  name: 'Actions'
})

const Apps: React.FC = () => {
  const classes = useStyles()
  const history = useHistory()
  const { managers } = useContext(WalletContext)

  // State for UI and search
  const [apps, setApps] = useState<RecentApp[]>([])
  const [filteredApps, setFilteredApps] = useState<RecentApp[]>([])
  const [fuseInstance, setFuseInstance] = useState<Fuse<RecentApp> | null>(null)
  const [search, setSearch] = useState<string>('')
  const [isExpanded, setIsExpanded] = useState<boolean>(false)

  const inputRef = useRef<HTMLInputElement>(null)

  // Configuration for Fuse
  const options = {
    threshold: 0.3,
    location: 0,
    distance: 100,
    includeMatches: true,
    useExtendedSearch: true,
    keys: ['name', 'domain'] // Search both app name and domain
  }

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)

    // Apply search immediately, with or without Fuse
    applySearch(value, apps, fuseInstance)
  }

  // Toggle pin status for an app
  const togglePin = async (domain: string) => {
    const profileId = managers.walletManager?.listProfiles()[0]?.id
    if (!profileId) return

    // Find the app to toggle
    const appToToggle = apps.find(app => app.domain === domain)
    if (!appToToggle) return

    // Create updated app with toggled pin status
    const updatedApp: RecentApp = {
      ...appToToggle,
      isPinned: !appToToggle.isPinned
    }

    try {
      // Update the app in localStorage
      const updatedApps = await updateRecentApp(Utils.toBase64(profileId), updatedApp)

      // Update local state
      setApps(updatedApps)

      // If we're currently searching, re-apply the search to update filtered results
      if (search.trim() !== '') {
        applySearch(search, updatedApps, fuseInstance)
      } else {
        setFilteredApps(updatedApps)
      }
    } catch (error) {
      console.error('Error toggling pin status:', error)
    }
  }

  // Separate function to apply search logic
  const applySearch = (searchValue: string, appList: RecentApp[], fuse: Fuse<RecentApp> | null) => {
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
        app.name.toLowerCase().includes(searchValue.toLowerCase()) ||
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
    const loadApps = () => {
      const profileId = managers.walletManager?.listProfiles()[0]?.id
      if (profileId) {
        const recentApps = getRecentApps(Utils.toBase64(profileId))
        setApps(recentApps)
        setFilteredApps(recentApps)
      }
    }

    loadApps()
  }, [managers.walletManager])

  // Listen for recent apps updates from wallet requests
  useEffect(() => {
    const handleRecentAppsUpdate = (event: CustomEvent) => {
      const { profileId } = event.detail
      const currentProfileId = managers.walletManager?.listProfiles()[0]?.id
      
      // Only reload if the update is for the current profile
      if (currentProfileId && Utils.toBase64(currentProfileId) === profileId) {
        const recentApps = getRecentApps(profileId)
        setApps(recentApps)
        
        // If we're currently searching, re-apply the search
        if (search.trim() !== '') {
          applySearch(search, recentApps, fuseInstance)
        } else {
          setFilteredApps(recentApps)
        }
      }
    }

    window.addEventListener('recentAppsUpdated', handleRecentAppsUpdate as EventListener)
    
    return () => {
      window.removeEventListener('recentAppsUpdated', handleRecentAppsUpdate as EventListener)
    }
  }, [managers.walletManager, search, fuseInstance])

  // Update search results when apps or search changes
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

      {/* Show empty state only if no apps and not loading */}
      {apps.length === 0 && (
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
              console.log('pinnedFilteredApps', pinnedFilteredApps)
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
                              appName={app.name}
                              domain={app.domain}
                              iconImageUrl={app.iconImageUrl}
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
                              appName={app.name}
                              domain={app.domain}
                              iconImageUrl={app.iconImageUrl}
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
      </Container>
    </div>
  )
}

export default Apps
