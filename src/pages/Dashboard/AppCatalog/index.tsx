import React, { useState, useEffect } from 'react'
import {
  Typography,
  Container,
  TextField,
  LinearProgress,
  Box,
  Chip,
  Card,
  Modal,
  IconButton
} from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import { makeStyles } from '@mui/styles'
import SearchIcon from '@mui/icons-material/Search'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CloseIcon from '@mui/icons-material/Close'
import Fuse from 'fuse.js'
import { useHistory } from 'react-router-dom'
import { Img } from '@bsv/uhrp-react'

import PageHeader from '../../../components/PageHeader'
import { openUrl } from '../../../utils/openUrl'

import { AppCatalog as AppCatalogAPI } from 'metanet-apps'
import type { PublishedApp } from 'metanet-apps/src/types'
import CounterpartyChip from '../../../components/CounterpartyChip'

// Define a type for our views
type AppCatalogView = 'list' | 'details'

const useStyles = makeStyles({
  root: {
    width: '100%'
  }
}, {
  name: 'AppCatalog'
})

const AppCatalog: React.FC = () => {
  const classes = useStyles()
  const history = useHistory()

  // State
  const [catalogApps, setCatalogApps] = useState<PublishedApp[]>([])
  const [filteredCatalogApps, setFilteredCatalogApps] = useState<PublishedApp[]>([])
  const [selectedApp, setSelectedApp] = useState<PublishedApp | null>(null)
  const [currentView, setCurrentView] = useState<AppCatalogView>('list')
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')
  const [fuseInstance, setFuseInstance] = useState<Fuse<PublishedApp> | null>(null)
  const [activeScreenshot, setActiveScreenshot] = useState<number>(0)
  const [openModal, setOpenModal] = useState(false)
  const [modalImage, setModalImage] = useState<string>('')

  // Configuration for Fuse
  const options = {
    threshold: 0.3,
    location: 0,
    distance: 100,
    includeMatches: true,
    useExtendedSearch: true,
    keys: ['metadata.name', 'metadata.description', 'metadata.tags', 'metadata.category']
  }

  // Load catalog apps
  const loadCatalogApps = async () => {
    setCatalogLoading(true)
    try {
      const catalog = new AppCatalogAPI({})
      const apps = await catalog.findApps()
      setCatalogApps(apps)
      setFilteredCatalogApps(apps)

      // Initialize Fuse instance
      const fuse = new Fuse(apps, options)
      setFuseInstance(fuse)
    } catch (error) {
      console.error('Failed to load catalog apps:', error)
    }
    setCatalogLoading(false)
  }

  // Handle search
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)

    if (fuseInstance) {
      if (value === '') {
        setFilteredCatalogApps(catalogApps)
      } else {
        const results = fuseInstance.search(value)
        setFilteredCatalogApps(results.map(result => result.item))
      }
    }
  }

  // Handle app selection for details view
  const handleAppClick = (app: PublishedApp) => {
    setSelectedApp(app)
    setCurrentView('details')
  }

  // Handle back navigation from details to list
  const handleBackToList = () => {
    setCurrentView('list')
    setSelectedApp(null)
  }

  // Handle back navigation from catalog to apps page
  const handleBackToApps = () => {
    history.push('/dashboard/apps')
  }

  const handleNavigateToApp = () => {
    if (selectedApp) {
      if (selectedApp.metadata.httpURL) {
        openUrl(selectedApp.metadata.httpURL)
      } else if (selectedApp.metadata.domain) {
        openUrl(`https://${selectedApp.metadata.domain}`)
      }
    }
  }

  // Load apps on mount
  useEffect(() => {
    loadCatalogApps()
  }, [])

  return (
    <div className={classes.root}>
      {currentView === 'list' && (
        <>
          <PageHeader
            title="App Catalog"
            subheading="Discover and explore apps from the Metanet ecosystem"
            icon="https://metanetapps.com/favicon.ico"
            buttonTitle=""
            onClick={() => { }}
            history={history}
            showBackButton={true}
            showButton={false}
            onBackClick={handleBackToApps}
          />

          <Container>
            {/* Search */}
            <Box sx={{ mb: 3 }}>
              <TextField
                fullWidth
                placeholder="Search apps by name, description, category or tags..."
                variant="outlined"
                value={search}
                onChange={handleSearchChange}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'action.active' }} />
                }}
              />
            </Box>

            {/* App Grid */}
            {catalogLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <LinearProgress style={{ width: '80%' }} />
              </Box>
            ) : filteredCatalogApps.length === 0 ? (
              <Box sx={{ textAlign: 'center', p: 4 }}>
                <Typography variant="h6" color="textSecondary">
                  No apps found
                </Typography>
              </Box>
            ) : (
              <Grid2 container spacing={3}>
                {filteredCatalogApps.map((app) => (
                  <Grid2 key={`${app.token.txid}-${app.token.outputIndex}`} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Box
                      sx={{
                        p: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': {
                          borderColor: 'primary.main',
                          transform: 'translateY(-2px)',
                          boxShadow: 2
                        }
                      }}
                      onClick={() => handleAppClick(app)}
                    >
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
                              mr: 2
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://metanetapps.com/favicon.ico'
                            }}
                          />
                        )}
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                            {app.metadata.name}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            {app.metadata.domain}
                          </Typography>
                        </Box>
                      </Box>

                      <Typography
                        variant="body2"
                        color="textSecondary"
                        sx={{
                          mb: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical'
                        }}
                      >
                        {app.metadata.description}
                      </Typography>

                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                        {app.metadata.tags && app.metadata.tags.slice(0, 3).map((tag, index) => (
                          <Chip
                            key={index}
                            label={tag}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                        {app.metadata.tags && app.metadata.tags.length > 3 && (
                          <Chip
                            label={`+${app.metadata.tags.length - 3} more`}
                            size="small"
                            variant="outlined"
                          />
                        )}
                      </Box>

                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {app.metadata.category && (
                          <Chip
                            label={app.metadata.category}
                            color="primary"
                            size="small"
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
          </Container>
        </>
      )}

      {currentView === 'details' && selectedApp && (
        <>
          <PageHeader
            title={selectedApp.metadata.name}
            subheading={selectedApp.metadata.domain}
            icon={selectedApp.metadata.icon || "https://metanetapps.com/favicon.ico"}
            buttonTitle="Open App"
            buttonIcon={<OpenInNewIcon />}
            onClick={handleNavigateToApp}
            history={history}
            showBackButton={true}
            onBackClick={handleBackToList}
          />

          <Container>
            {/* Banner Image */}
            {selectedApp.metadata.banner_image_url && (
              <Box sx={{ mb: 3 }}>
                <Card>
                  <Img
                    src={selectedApp.metadata.banner_image_url}
                    alt={`${selectedApp.metadata.name} banner`}
                    style={{ 
                      height: '200px',
                      width: '100%',
                      objectFit: 'cover' 
                    }}
                  />
                </Card>
              </Box>
            )}

            {/* Description */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                Description
              </Typography>
              <Typography variant="body1" color="textSecondary">
                {selectedApp.metadata.description}
              </Typography>
            </Box>

            {/* Publisher */}
            {selectedApp.metadata.publisher && (
              <Box sx={{ mb: 3 }}>
                <Box sx={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  maxWidth: 'fit-content',
                  '& > div': {
                    width: 'auto !important',
                    '& .MuiStack-root': {
                      justifyContent: 'flex-start !important',
                      width: 'auto !important'
                    }
                  }
                }}>
                  <CounterpartyChip
                    counterparty={selectedApp.metadata.publisher}
                    label='Publisher'
                  />
                </Box>
              </Box>
            )}

            {/* App Info */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                App Information
              </Typography>
              <Grid2 container spacing={2}>
                {selectedApp.metadata.category && (
                  <Grid2 size={{ xs: 12, sm: 6, md: 4 }}>
                    <Typography variant="subtitle2" color="textSecondary">
                      Category
                    </Typography>
                    <Chip
                      label={selectedApp.metadata.category}
                      color="primary"
                      variant="filled"
                      size="small"
                    />
                  </Grid2>
                )}
                <Grid2 size={{ xs: 12, sm: 6, md: 4 }}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Release Date
                  </Typography>
                  <Typography variant="body2">
                    {new Date(selectedApp.metadata.release_date).toLocaleDateString()}
                  </Typography>
                </Grid2>
                <Grid2 size={{ xs: 12, sm: 6, md: 4 }}>
                  <Typography variant="subtitle2" color="textSecondary">
                    Version
                  </Typography>
                  <Typography variant="body2">
                    {selectedApp.metadata.version}
                  </Typography>
                </Grid2>
              </Grid2>
            </Box>

            {/* Tags */}
            {selectedApp.metadata.tags && selectedApp.metadata.tags.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                  Tags
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {selectedApp.metadata.tags.map((tag, index) => (
                    <Chip
                      key={index}
                      label={tag}
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* Screenshots */}
            {selectedApp.metadata.screenshot_urls && selectedApp.metadata.screenshot_urls.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                  Screenshots
                </Typography>
                <Box sx={{ position: 'relative' }}>
                  {/* Horizontal scrollable carousel */}
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      overflowX: 'auto', 
                      overflowY: 'hidden',
                      pb: 2,
                      scrollBehavior: 'smooth',
                      WebkitOverflowScrolling: 'touch',
                      '&::-webkit-scrollbar': {
                        height: 4,
                      },
                      '&::-webkit-scrollbar-track': {
                        backgroundColor: 'rgba(0,0,0,0.1)',
                        borderRadius: 2,
                      },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: 'primary.main',
                        borderRadius: 2,
                      }
                    }}
                  >
                    {selectedApp.metadata.screenshot_urls.map((screenshot, index) => (
                      <Box 
                        key={index} 
                        sx={{ 
                          mr: 2, 
                          minWidth: '400px',
                          flexShrink: 0,
                          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                          '&:hover': {
                            transform: 'translateY(-4px)',
                            boxShadow: '0 8px 25px rgba(0,0,0,0.15)'
                          }
                        }}
                      >
                        <Card 
                          sx={{ 
                            borderRadius: 3,
                            overflow: 'hidden',
                            border: index === activeScreenshot ? '2px solid' : '1px solid',
                            borderColor: index === activeScreenshot ? 'primary.main' : 'divider'
                          }}
                        >
                          <Img
                            src={screenshot}
                            alt={`${selectedApp.metadata.name} screenshot ${index + 1}`}
                            style={{ 
                              height: '400px',
                              width: '400px',
                              objectFit: 'cover', 
                              cursor: 'pointer' 
                            }}
                            onClick={() => {
                              setActiveScreenshot(index)
                              setModalImage(screenshot)
                              setOpenModal(true)
                            }}
                          />
                        </Card>
                      </Box>
                    ))}
                  </Box>
                  
                  {/* Dot indicators */}
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    mt: 2,
                    gap: 1
                  }}>
                    {selectedApp.metadata.screenshot_urls.map((_, index) => (
                      <Box
                        key={index}
                        onClick={() => setActiveScreenshot(index)}
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: index === activeScreenshot ? 'primary.main' : 'grey.300',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            backgroundColor: index === activeScreenshot ? 'primary.dark' : 'grey.400',
                            transform: 'scale(1.2)'
                          }
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              </Box>
            )}

            {/* Changelog */}
            {selectedApp.metadata.changelog && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                  Changelog
                </Typography>
                <Typography variant="body2" color="textSecondary" sx={{ whiteSpace: 'pre-wrap' }}>
                  {selectedApp.metadata.changelog}
                </Typography>
              </Box>
            )}
          </Container>
        </>
      )}

      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <Box sx={{ position: 'relative', width: '80%', maxWidth: '800px', maxHeight: '90vh', overflow: 'auto' }}>
          <IconButton
            sx={{ position: 'absolute', top: 8, right: 8 }}
            onClick={() => setOpenModal(false)}
          >
            <CloseIcon />
          </IconButton>
          <Img
            src={modalImage}
            alt="Screenshot"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </Box>
      </Modal>
    </div>
  )
}

export default AppCatalog
