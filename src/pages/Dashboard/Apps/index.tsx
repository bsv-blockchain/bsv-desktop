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
} from '@mui/material'
import Grid2 from '@mui/material/Grid2'
import { makeStyles, useTheme } from '@mui/styles'
import SearchIcon from '@mui/icons-material/Search'
import Fuse from 'fuse.js'

import style from './style'
import MetanetApp from '../../../components/MetanetApp'
import parseAppManifest from '../../../utils/parseAppManifest'
import isImageUrl from '../../../utils/isImageUrl'
import getApps from './getApps'
import { WalletContext } from '../../../WalletContext'

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
  const [fuseInstance, setFuseInstance] = useState<Fuse<AppData> | null>(null)
  const [search, setSearch] = useState<string>('')
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const cachedAppsKey = 'cached_apps'

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
          Applications
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
          Browse and manage your application permissions.
        </Typography>
        <FormControl sx={{ width: '100%' }}>
          <TextField
            variant='outlined'
            fullWidth
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
    </div>
  )
}

export default Apps
