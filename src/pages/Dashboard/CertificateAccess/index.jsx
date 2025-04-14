import React, { useContext, useEffect, useState } from 'react'
import {
  Typography,
  Grid,
  IconButton,
  Avatar
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { makeStyles } from '@mui/styles'
import { useHistory } from 'react-router-dom'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import PageHeader from '../../../components/PageHeader'
import CounterpartyChip from '../../../components/CounterpartyChip'
import style from './style'
import ProtocolPermissionList from '../../../components/ProtocolPermissionList'
import CertificateAccessList from '../../../components/CertificateAccessList'
import { SettingsContext } from '../../../context/SettingsContext'
import { CertMap } from 'certmap'
import confederacyHost from '../../../utils/confederacyHost'
import { Img } from 'uhrp-react'
const useStyles = makeStyles(style, { name: 'certificateAccess' })

const CertificateAccess = ({ match }) => {
  const history = useHistory()
  const classes = useStyles()
  let { certType } = match.params
  certType = decodeURIComponent(certType)
  const [copied, setCopied] = useState({ id: false })
  const [documentTitle, setDocumentTitle] = useState(certType)
  const [documentIcon, setDocumentIcon] = useState(DEFAULT_APP_ICON)
  const [description, setDescription] = useState('- -')
  const [documentationURL, setDocumentationURL] = useState('https://projectbabbage.com/docs')
  const [fields, setFields] = useState({})
  const certmap = new CertMap()
  certmap.config.confederacyHost = confederacyHost()
  const { settings } = useContext(SettingsContext)

  useEffect(() => {
    const cacheKey = `certData_${certType}_${settings.trustedEntities.map(x => x.publicKey).join('_')}`

    const fetchAndCacheData = async () => {
      // Attempt to load the cached data and update UI immediately
      const cachedData = window.localStorage.getItem(cacheKey)
      if (cachedData) {
        const parsedData = JSON.parse(cachedData)
        setDocumentTitle(parsedData.name)
        setDocumentIcon(parsedData.iconURL)
        setDescription(parsedData.description)
        setDocumentationURL(parsedData.documentationURL)
        setFields(JSON.parse(parsedData.fields))
      }

      // Fetch the latest data
      const registryOperators = settings.trustedEntities.map(x => x.publicKey)
      const results = await certmap.resolveCertificateByType(certType, registryOperators)
      if (results && results.length > 0) {
        // Compute the most trusted of the results
        let mostTrustedIndex = 0
        let maxTrustPoints = 0
        for (let i = 0; i < results.length; i++) {
          const resultTrustLevel = settings.trustedEntities.find(x => x.publicKey === results[i].registryOperator)?.trust || 0
          if (resultTrustLevel > maxTrustPoints) {
            mostTrustedIndex = i
            maxTrustPoints = resultTrustLevel
          }
        }
        const mostTrustedResult = results[mostTrustedIndex]
        setDocumentTitle(mostTrustedResult.name)
        setDocumentIcon(mostTrustedResult.iconURL)
        setDescription(mostTrustedResult.description)
        setDocumentationURL(mostTrustedResult.documentationURL)
        setFields(JSON.parse(mostTrustedResult.fields))

        // Update the cache with the latest data
        window.localStorage.setItem(cacheKey, JSON.stringify(mostTrustedResult))
      }
    }

    fetchAndCacheData()
  }, [settings, certType, setDocumentTitle, setDocumentIcon, setDescription, setDocumentationURL, setFields])

  const handleCopy = (data, type) => {
    navigator.clipboard.writeText(data)
    setCopied({ ...copied, [type]: true })
    setTimeout(() => {
      setCopied({ ...copied, [type]: false })
    }, 2000)
  }

  return (
    <Grid container spacing={3} direction='column'>
      <Grid item>
        <PageHeader
          history={history}
          title={documentTitle}
          subheading={
            <div>
              <Typography variant='caption' color='textSecondary'>
                Certificate Type: <Typography variant='caption' fontWeight='bold'>{certType}</Typography>
                <IconButton size='small' onClick={() => handleCopy(certType, 'id')} disabled={copied.id}>
                  {copied.id ? <CheckIcon /> : <ContentCopyIcon fontSize='small' />}
                </IconButton>
              </Typography>
            </div>
          }
          icon={documentIcon}
          showButton={false}
        />
      </Grid>
      <Grid item>
        <Typography>{description}</Typography>
        <Typography>
          <b>Documentation: </b>
          <a href={documentationURL} target='_blank' rel='noreferrer'>
            {documentationURL}
          </a>
        </Typography>
        <Typography paddingTop='1em' variant='h4'>Fields</Typography>
        <ul>
          {Object.entries(fields).map(([key, value], index) => {
            return (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'start',
                  marginBottom: 16
                }}>
                {value.fieldIcon && (
                  <Avatar style={{ marginRight: 16 }}>
                    <Img
                      style={{ width: '75%', height: '75%' }}
                      src={value.fieldIcon}
                      confederacyHost={confederacyHost()}
                    />
                  </Avatar>
                )}
                <div>
                  <Typography variant='subtitle2' color='textSecondary'>
                    {value.friendlyName}
                  </Typography>
                  <Typography variant='body2' style={{ marginBottom: 8 }}>
                    {value.description}
                  </Typography>
                </div>
              </div>
            )
          })}
        </ul>
      </Grid>
      <Grid item>
        <Typography variant='h4'>Issued Certificates</Typography>
        <CertificateAccessList
          itemsDisplayed='apps'
          canRevoke
          clickable={false}
          type={certType}
        />
      </Grid>
    </Grid>
  )
}

export default CertificateAccess
