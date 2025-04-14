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
  Grid,
  Container,
  TextField,
  LinearProgress,
} from '@mui/material'
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
  const theme = useTheme()

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
  const options: Fuse.IFuseOptions<AppData> = {
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
      if (domain.startsWith('https://')) {
        domain = domain.substring(8)
      }
      if (domain.startsWith('http://')) {
        domain = domain.substring(7)
      }
      let appIconImageUrl: string | undefined
      let appName: string = domain

      try {
        if (await isImageUrl(`https://${domain}/favicon.ico`)) {
          appIconImageUrl = `https://${domain}/favicon.ico`
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
        <TextField
          variant='outlined'
          fullWidth
          value={search}
          onChange={handleSearchChange}
          placeholder='Search'
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          inputRef={inputRef}
          InputProps={{
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
          }}
          sx={{
            marginTop: theme.spacing(3),
            marginBottom: theme.spacing(2),
            width: isExpanded ? 'calc(50%)' : '8em',
            transition: 'width 0.3s ease'
          }}
        />
      </Container>

      <Typography
        variant='h3'
        color='textPrimary'
        gutterBottom
        style={{ paddingBottom: '0.2em' }}
      >
        All Your Apps
      </Typography>

      {loading && <LinearProgress style={{ marginTop: '1em' }} />}

      {filteredApps.length === 0 && !loading && (
        <center>
          <br />
          <Typography variant='h4' align='center' color='textSecondary' paddingTop='2em'>
            No apps found!
          </Typography>
        </center>
      )}

      <Grid
        container
        spacing={3}
        alignItems='center'
        justifyContent='left'
        className={classes.apps_view}
      >
        {filteredApps.map((app, index) => (
          <Grid item key={index} xs={6} sm={6} md={3} lg={2} className={classes.gridItem}>
            <MetanetApp
              appName={app.appName}
              iconImageUrl={app.appIconImageUrl}
              domain={app.domain}
            />
          </Grid>
        ))}
      </Grid>
    </div>
  )
}

export default Apps
