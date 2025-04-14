import React, { useContext, useEffect, useState } from 'react'
import {
  Typography,
  Box,
  Tabs,
  Tab,
  Grid,
  IconButton
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { makeStyles, useTheme } from '@mui/styles'
import { useHistory } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'
import CounterpartyChip from '../../../components/CounterpartyChip'
import style from './style'
import ProtocolPermissionList from '../../../components/ProtocolPermissionList'
import CertificateAccessList from '../../../components/CertificateAccessList'
import { SettingsContext } from '../../../context/SettingsContext'
import { Signia } from 'babbage-signia'
import confederacyHost from '../../../utils/confederacyHost'
import { defaultIdentity, parseIdentity } from 'identinator'
import { discoverByIdentityKey } from '@babbage/sdk-ts'

const TabPanel = (props) => {
  const { children, value, index, ...other } = props

  return (
    <div
      role='tabpanel'
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  )
}

const SimpleTabs = ({ counterparty, trustEndorsements }) => {
  const [value, setValue] = useState(0)
  const { settings } = useContext(SettingsContext)
  const theme = useTheme()

  const handleChange = (event, newValue) => {
    setValue(newValue)
  }

  return (
    <Box>
      <Tabs value={value} onChange={handleChange} aria-label='basic tabs example'>
        <Tab label='Trust Endorsements' />
        <Tab label='Protocol Access' />
        <Tab label='Certificates Revealed' />
      </Tabs>
      <TabPanel value={value} index={0}>
        <Typography variant='body'>
          Trust endorsements given to this counterparty by other people.
        </Typography>
        <div style={{ ...theme.templates.boxOfChips, paddingTop: '1em' }}>
          {trustEndorsements.map((endorsement, index) => (
            <CounterpartyChip
              counterparty={endorsement.certifier}
              key={index}
              clickable
            />
          ))}
        </div>
      </TabPanel>
      <TabPanel value={value} index={1}>
        Apps that can be used within specific protocols to interact with this counterparty.
        <ProtocolPermissionList counterparty={counterparty} itemsDisplayed='protocols' showEmptyList canRevoke />
      </TabPanel>
      <TabPanel value={value} index={2}>
        The certificate fields that you have revealed to this counterparty within specific apps.
        <CertificateAccessList counterparty={counterparty} itemsDisplayed='apps' canRevoke />
      </TabPanel>
    </Box>
  )
}

const useStyles = makeStyles(style, { name: 'counterpartyAccess' })

const CounterpartyAccess = ({ match }) => {
  const { settings } = useContext(SettingsContext)
  const history = useHistory()
  const classes = useStyles()
  const [name, setName] = useState(defaultIdentity.name)
  const [profilePhoto, setProfilePhoto] = useState(defaultIdentity.avatarURL)
  const [trustEndorsements, setTrustEndorsements] = useState([])

  const { counterparty } = match.params
  const [copied, setCopied] = useState({ id: false })

  const handleCopy = (data, type) => {
    navigator.clipboard.writeText(data)
    setCopied({ ...copied, [type]: true })
    setTimeout(() => {
      setCopied({ ...copied, [type]: false })
    }, 2000)
  }

  // Construct a new Signia instance for querying identity
  const signia = new Signia()
  signia.config.confederacyHost = confederacyHost()

  useEffect(() => {
    (async () => {
      let cacheKey
      try {
        cacheKey = `endorsements_${counterparty}_${settings.trustedEntities.map(x => x.publicKey).join('_')}`
        const cachedData = window.localStorage.getItem(cacheKey)

        // Set state from cache immediately for a faster initial response
        if (cachedData) {
          setTrustEndorsements(JSON.parse(cachedData))
        }
      } catch (error) {
        console.error('Failed to fetch cached results:', error)
      }
      // Fetch the latest data regardless of the cache
      try {
        const certifiers = settings.trustedEntities.map(x => x.publicKey)
        // Use the Signia function directly because we want to show all the results instead of filtering based on trust.
        const results = await signia.discoverByIdentityKey(counterparty, certifiers)
        if (results && results.length > 0) {
          setTrustEndorsements(results)
          if (cacheKey) {
            window.localStorage.setItem(cacheKey, JSON.stringify(results))
          }
        }
      } catch (e) {
        console.error('Error fetching trust endorsements: ', e)
      }
    })()
  }, [counterparty, settings, setTrustEndorsements])

  useEffect(() => {
    const cacheKey = `signiaIdentity_${counterparty}`

    const fetchAndCacheIdentity = async () => {
      // Try to load data from cache first
      const cachedData = window.localStorage.getItem(cacheKey)
      if (cachedData) {
        const parsedIdentity = JSON.parse(cachedData)
        setName(parsedIdentity.name)
        setProfilePhoto(parsedIdentity.avatarURL)
      }
      try {
        // Fetch the identity information from Signia
        const results = await discoverByIdentityKey({ identityKey: counterparty })
        if (results && results.length > 0) {
          const parsedIdentity = parseIdentity(results[0])
          setName(parsedIdentity.name)
          setProfilePhoto(parsedIdentity.avatarURL)

          // Cache the fetched data
          window.window.localStorage.setItem(cacheKey, JSON.stringify(parsedIdentity))
        } else {
          // Reset to default state
          setName(defaultIdentity.name)
          setProfilePhoto(defaultIdentity.avatarURL)
          setTrustEndorsements([])
        }
      } catch (e) {
        console.error('Failed to fetch identity details:', e)
      }
    }

    fetchAndCacheIdentity()
  }, [counterparty, setName, setProfilePhoto])

  return (
    <Grid container spacing={3} direction='column' className={classes.grid}>
      <Grid item>
        <PageHeader
          history={history}
          title={name}
          subheading={
            <div>
              <Typography variant='caption' color='textSecondary'>
                Public Key: <Typography variant='caption' fontWeight='bold'>{counterparty}</Typography>
                <IconButton size='small' onClick={() => handleCopy(counterparty, 'id')} disabled={copied.id}>
                  {copied.id ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
                </IconButton>
              </Typography>
            </div>
          }
          icon={profilePhoto}
          showButton={false}
        />
      </Grid>
      <Grid item>
        <SimpleTabs counterparty={counterparty} trustEndorsements={trustEndorsements} />
      </Grid>
    </Grid>
  )
}

export default CounterpartyAccess
