/* eslint-disable react/prop-types */
import React, { useState, useEffect } from 'react'
import { Typography, IconButton, Grid, Tab, Tabs } from '@mui/material'
import makeStyles from '@mui/styles/makeStyles'
import style from './style'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import ProtocolPermissionList from '../../../components/ProtocolPermissionList'
import SpendingAuthorizationList from '../../../components/SpendingAuthorizationList'
import BasketAccessList from '../../../components/BasketAccessList'
import CertificateAccessList from '../../../components/CertificateAccessList'
import PageHeader from '../../../components/PageHeader'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import fetchAndCacheAppData from '../../../utils/fetchAndCacheAppData'

const useStyles = makeStyles(style, { name: 'appaccess' })
const AppAccess = ({ match, history }) => {
  const originator = decodeURIComponent(match.params.originator)
  const [tabValue, setTabValue] = useState(history.appAccessTab ? history.appAccessTab : '0')
  const [appDomain, setAppDomain] = useState('')
  const [appName, setAppName] = useState('')
  const [appIcon, setAppIcon] = useState(DEFAULT_APP_ICON)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(false)
  const [copied, setCopied] = useState({ id: false, registryOperator: false })

  // Copies the data and timeouts the checkmark icon
  const handleCopy = (data, type) => {
    navigator.clipboard.writeText(data)
    setCopied({ ...copied, [type]: true })
    setTimeout(() => {
      setCopied({ ...copied, [type]: false })
    }, 2000)
  }

  const classes = useStyles()
  useEffect(() => {
    if (appDomain === '') {
      setAppDomain(originator)
    }
    if (appDomain === 'localhost:8088' || appDomain === '') {
      setAppIcon(DEFAULT_APP_ICON)
    }

    fetchAndCacheAppData(appDomain, setAppIcon, setAppName, setLoading, setRefresh, DEFAULT_APP_ICON)

    return () => {
      // Cleanup if necessary
      history.appAccessTab = undefined
    }
  }, [appDomain, originator, DEFAULT_APP_ICON, setLoading, setRefresh, setAppIcon, setAppName])

  const url = appDomain.startsWith('http') ? appDomain : `https://${appDomain}`

  return (
    <div>
      <Grid container spacing={3} direction='column' sx={{ padding: '16px' }}>
        <Grid item>
          <PageHeader
            history={history} title={appName}
            subheading={
              <div>
                <Typography variant='caption' color='textSecondary'>
                  {url}
                  <IconButton size='small' onClick={() => handleCopy(url, 'id')} disabled={copied.id}>
                    {copied.id ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
                  </IconButton>
                </Typography>
              </div>
            } icon={appIcon} buttonTitle='Launch' onClick={() => {
              window.open(url, '_blank')
            }}
          />
        </Grid>
        <Grid item>
          <Typography variant='body' gutterBottom>
            {'You have the power to decide what each app can do, whether it\'s using certain tools (protocols), accessing specific bits of your data (baskets), verifying your identity (certificates), or spending amounts.'}
          </Typography>
        </Grid>
      </Grid>
      <br />
      <Tabs
        className={classes.tabs}
        value={tabValue}
        onChange={(e, v) => {
          setTabValue(v)
          history.appAccessTab = v
        }}
        indicatorColor='primary'
        textColor='primary'
        variant='fullWidth'
      >
        <Tab
          label='Protocols'
          value='0'
        />
        <Tab
          label='Spending'
          value='1'
        />
        <Tab
          label='Baskets'
          value='2'
        />
        <Tab
          label='Certificates'
          value='3'
        />
      </Tabs>
      {tabValue === '0' &&
        <ProtocolPermissionList
          app={url}
          canRevoke
          showEmptyList
        />}
      {tabValue === '1' &&
        <SpendingAuthorizationList
          app={appDomain}
        />}
      {tabValue === '2' &&
        <BasketAccessList
          app={appDomain}
          showEmptyList
          canRevoke
        />}
      {tabValue === '3' &&
        <CertificateAccessList
          app={appDomain}
          canRevoke
          showEmptyList
        />}
    </div>
  )
}

export default AppAccess
