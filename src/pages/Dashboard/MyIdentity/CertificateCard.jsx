import React, { useState, useEffect, useContext } from 'react'
import { Card, CardContent, Typography, Grid, Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, Avatar } from '@mui/material'
import { CertMap } from 'certmap'
import { SettingsContext } from '../../../context/SettingsContext'
import confederacyHost from '../../../utils/confederacyHost'
import { Img } from 'uhrp-react'
import CounterpartyChip from '../../../components/CounterpartyChip'
import { DEFAULT_APP_ICON } from '../../../constants/popularApps'
import { useHistory } from 'react-router-dom/cjs/react-router-dom.min'

// TODO: Document certificate type
// Responsible for displaying certificate information within the MyIdentity page
const CertificateCard = ({ certificate, onClick, clickable = true }) => {
  const history = useHistory()
  const [certName, setCertName] = useState('Unknown Cert')
  const [iconURL, setIconURL] = useState(
    DEFAULT_APP_ICON
  )
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState({})
  const certmap = new CertMap()
  certmap.config.confederacyHost = confederacyHost()
  const { settings } = useContext(SettingsContext)
  const [modalOpen, setModalOpen] = useState(false)

  // Handle modal actions
  const handleModalOpen = () => {
    setModalOpen(true)
  }
  const handleModalClose = () => {
    setModalOpen(false)
  }

  useEffect(() => {
    (async () => {
      try {
        const registryOperators = settings.trustedEntities.map(x => x.publicKey)
        const cacheKey = `certData_${certificate.type}_${registryOperators.join('_')}`
        const cachedData = window.localStorage.getItem(cacheKey)

        if (cachedData) {
          const cachedCert = JSON.parse(cachedData)
          setCertName(cachedCert.name)
          setIconURL(cachedCert.iconURL)
          setDescription(cachedCert.description)
          setFields(JSON.parse(cachedCert.fields))
        }

        const results = await certmap.resolveCertificateByType(certificate.type, registryOperators)
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
          const mostTrustedCert = results[mostTrustedIndex]
          setCertName(mostTrustedCert.name)
          setIconURL(mostTrustedCert.iconURL)
          setDescription(mostTrustedCert.description)
          setFields(JSON.parse(mostTrustedCert.fields))

          // Cache the fetched data
          window.localStorage.setItem(cacheKey, JSON.stringify(mostTrustedCert))
        }
      } catch (error) {
        console.error('Failed to fetch certificate details:', error)
      }
    })()
  }, [certificate, settings])



  const handleClick = (e) => {
    if (clickable) {
      if (typeof onClick === 'function') {
        onClick(e)
      } else {
        e.stopPropagation()
        history.push(`/dashboard/certificate/${encodeURIComponent(certificate.type)}`)
      }
    }
  }

  return (
    <Card>
      <CardContent>
        <Box onClick={handleClick} style={{ cursor: clickable ? 'pointer' : 'default', display: 'flex', flexDirection: 'row', alignItems: 'start', flex: 1 }}>
          <Img
            src={iconURL}
            style={{ width: 50, height: 50 }}
            confederacyHost={confederacyHost()}
          />
          <Box padding='0 0 0.5em 0.5em'>
            <Typography variant='h5'>{certName}</Typography>
            <Typography variant='body' fontSize='0.85em'>{description}</Typography>
          </Box>
        </Box>
        <span>
          {certificate && certificate.certifier
            ? <div>
              <Grid container alignContent='center' style={{ alignItems: 'center' }}>
                <Grid item>
                  <p style={{ fontSize: '0.9em', fontWeight: 'normal', marginRight: '1em' }}>Issuer:</p>
                </Grid>
                <Grid item paddingBottom='1em'>
                  <CounterpartyChip
                    size={0.89}
                    counterparty={certificate.certifier}
                    clickable
                  // onClick={onIssuerClick}
                  />
                </Grid>
              </Grid>
            </div>
            : ''}
        </span>
        <Button onClick={handleModalOpen} color='primary'>
          View Details
        </Button>
        <CertificateDetailsModal open={modalOpen} onClose={handleModalClose} fieldDetails={fields} actualData={certificate.decryptedFields} />
      </CardContent>
    </Card>
  )
}

const CertificateDetailsModal = ({ open, onClose, fieldDetails, actualData }) => {
  // Merge the field details with the actual data
  const mergedFields = Object.entries(fieldDetails).reduce((acc, [key, value]) => {
    acc[key] = { ...value, value: actualData[key] }
    return acc
  }, {})

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth='md'>
      <DialogTitle>Certificate Fields</DialogTitle>
      <DialogContent dividers>
        {Object.entries(mergedFields).map(([key, value], index) => {
          return (
            <div key={index} style={{
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
                {value.type === 'imageURL'
                  ? (
                    <Img
                      style={{ width: '5em', height: '5em' }}
                      src={value.value}
                      confederacyHost={confederacyHost()}
                    />
                  )
                  : (
                    <div style={{ display: 'flex' }}>
                      <Typography variant='body1' paddingRight='0.5em'>Value:</Typography>
                      <Typography variant='h5'>
                        {value.value}
                      </Typography>
                    </div>
                  )}
              </div>
            </div>
          )
        })}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color='primary'>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CertificateCard
