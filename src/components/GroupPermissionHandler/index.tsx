import { useState, useEffect, useContext } from 'react'
import {
  DialogContent, DialogContentText, DialogActions, Button, Typography, Checkbox, FormControlLabel
} from '@mui/material'
import { makeStyles } from '@mui/styles'
import CustomDialog from '../CustomDialog/index.jsx'
import WalletContext from '../../WalletContext.js'
import AppChip from '../AppChip/index.jsx'
import ProtoChip from '../ProtoChip/index.jsx'
import CertificateChip from '../CertificateChip/index.jsx'
import BasketChip from '../BasketChip/index.jsx'
import AmountDisplay from '../AmountDisplay'

// TODO: This file must be refactored for the new way of doing context.
// Unfortunately, this new context system is witchcraft to me.

const useStyles = makeStyles({
  protocol_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    alignItems: 'center',
    gridColumnGap: '0.5em',
    padding: '1em 0px'
  },
  protocol_inset: {
    marginLeft: '2.5em',
    paddingLeft: '0.5em',
    borderLeft: '3px solid #bbb',
    paddingTop: '0.5em',
    marginBottom: '1em'
  },
  basket_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    alignItems: 'center',
    gridColumnGap: '0.5em',
    padding: '0.5em 0px'
  },
  basket_inset: {
    marginLeft: '2.5em',
    paddingLeft: '0.5em',
    borderLeft: '3px solid #bbb',
    paddingTop: '0.5em',
    marginBottom: '1em'
  },
  certificate_grid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    alignItems: 'center',
    gridColumnGap: '0.5em',
    padding: '0.5em 0px'
  },
  certificate_inset: {
    marginLeft: '2.5em',
    paddingLeft: '0.5em',
    borderLeft: '3px solid #bbb',
    marginBottom: '1em'
  },
  certificate_attribute_wrap: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    alignItems: 'center',
    gridGap: '0.5em'
  },
  certificate_display: {
    display: 'grid',
    gridTemplateRows: 'auto'
  }
}, { name: 'GroupPermissionHandler' })

const GroupPermissionHandler = () => {
  const {
    onFocusRequested,
    onFocusRelinquished,
    isFocused
  } = useContext(WalletContext)
  const [wasOriginallyFocused, setWasOriginallyFocused] = useState(false)
  const [originator, setOriginator] = useState('')
  const [appName, setAppName] = useState(null)
  const [requestID, setRequestID] = useState(null)
  const [open, setOpen] = useState(false)
  const [spendingAuthorization, setSpendingAuthorization] = useState(undefined)
  const [protocolPermissions, setProtocolPermissions] = useState([])
  const [basketAccess, setBasketAccess] = useState([])
  const [certificateAccess, setCertificateAccess] = useState([])
  const classes = useStyles()

  const handleCancel = async () => {
    window.CWI.denyGroupPermission({ requestID })
    setOpen(false)
    if (!wasOriginallyFocused) {
      await onFocusRelinquished()
    }
  }

  const handleGrant = async () => {
    const granted = {
      protocolPermissions: [],
      basketAccess: [],
      certificateAccess: []
    }
    if (
      typeof spendingAuthorization === 'object' &&
      spendingAuthorization.enabled
    ) {
      delete spendingAuthorization.enabled
      granted.spendingAuthorization = spendingAuthorization
    }
    for (const x of protocolPermissions) {
      if (x.enabled) {
        delete x.enabled
        granted.protocolPermissions.push(x)
      }
    }
    for (const x of basketAccess) {
      if (x.enabled) {
        delete x.enabled
        granted.basketAccess.push(x)
      }
    }
    for (const x of certificateAccess) {
      if (x.enabled) {
        delete x.enabled
        granted.certificateAccess.push(x)
      }
    }
    window.CWI.grantGroupPermission({ requestID, granted })
    setOpen(false)
    if (!wasOriginallyFocused) {
      await onFocusRelinquished()
    }
  }

  useEffect(() => {
    let id
    (async () => {
      id = await window.CWI.bindCallback(
        'onGroupPermissionRequested',
        async ({
          requestID,
          groupPermissions,
          originator
        }) => {
          try {
            const result = await boomerang(
              'GET',
              `${originator.startsWith('localhost:') ? 'http' : 'https'}://${originator}/manifest.json`
            )
            if (typeof result === 'object') {
              if (result.name && result.name.length < 64) {
                setAppName(result.name)
              } else if (result.short_name && result.short_name.length < 64) {
                setAppName(result.short_name)
              }
            }
          } catch (e) {
            setAppName(originator)
          }
          const wasOriginallyFocused = await isFocused()
          setRequestID(requestID)
          if (typeof groupPermissions.spendingAuthorization === 'object') {
            setSpendingAuthorization({
              ...groupPermissions.spendingAuthorization,
              enabled: true
            })
          }
          setProtocolPermissions(
            groupPermissions.protocolPermissions
              ? groupPermissions.protocolPermissions
                .map(x => ({ ...x, enabled: true }))
              : []
          )
          setBasketAccess(
            groupPermissions.basketAccess
              ? groupPermissions.basketAccess
                .map(x => ({ ...x, enabled: true }))
              : []
          )
          setCertificateAccess(
            groupPermissions.certificateAccess
              ? groupPermissions.certificateAccess
                .map(x => ({ ...x, enabled: true }))
              : []
          )
          setOriginator(originator)
          setOpen(true)
          setWasOriginallyFocused(wasOriginallyFocused)
          if (!wasOriginallyFocused) {
            await onFocusRequested()
          }
        }
      )
    })()
    return () => {
      if (id) {
        window.CWI.unbindCallback('onGroupPermissionRequested', id)
      }
    }
  }, [])

  const toggleProtocolPermission = (index) => {
    setProtocolPermissions(prev => prev.map((item, idx) => (
      idx === index ? { ...item, enabled: !item.enabled } : item
    )))
  }

  const toggleCertificateAccess = (index) => {
    setCertificateAccess(prev => prev.map((item, idx) => (
      idx === index ? { ...item, enabled: !item.enabled } : item
    )))
  }

  const toggleBasketAccess = (index) => {
    setBasketAccess(prev => prev.map((item, idx) => (
      idx === index ? { ...item, enabled: !item.enabled } : item
    )))
  }

  return (
    <CustomDialog
      open={open}
      // onClose={handleCancel}
      title='Select App Permissions'
    >
      <DialogContent>
        <DialogContentText>
          <br />
          An app is requesting access to some of your information, and it wants to do some things on your behalf. Have a look through the below list of items, and select the ones you'd be okay with.
        </DialogContentText>
        <br />
        <center>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gridGap: '0.2em', alignItems: 'center', width: 'min-content', gridGap: '2em' }}>
            <span>app:</span>
            {originator && <div>
              <AppChip
                size={2.5}
                showDomain
                label={originator}
                clickable={false}
              />
            </div>}
          </div>
        </center>
        <br />
        {spendingAuthorization && (
          <>
            <Typography variant='h3'>Spending Authorization</Typography>
            <FormControlLabel
              control={<Checkbox
                checked={spendingAuthorization.enabled}
                onChange={() => setSpendingAuthorization(prev => ({ ...prev, enabled: !prev.enabled }))}
              />}
              label={<span>Let the app spend <AmountDisplay abbreviate>{spendingAuthorization.amount}</AmountDisplay> over the next 2 months without asking.</span>}
            />
            <br />
            <br />
          </>
        )}
        {protocolPermissions && protocolPermissions.length > 0 && <>
          <Typography variant='h3'>Protocol Permissions</Typography>
          <Typography color='textSecondary' variant='caption'>
            Protocols let apps talk in specific languages using your information.
          </Typography>
          {protocolPermissions.map((x, i) => (
            <div key={i} className={classes.protocol_grid}>
              <div>
                <Checkbox
                  checked={x.enabled}
                  onChange={() => toggleProtocolPermission(i)}
                />
              </div>
              <div>
                <ProtoChip
                  protocolID={x.protocolID[1]}
                  securityLevel={x.protocolID[0]}
                  counterparty={x.counterparty}
                />
                <div className={classes.protocol_inset}>
                  <p style={{ marginBottom: '0px' }}><b>Reason:{' '}</b>{x.description}</p>
                </div>
              </div>
            </div>
          ))}
        </>}
        {certificateAccess && certificateAccess.length > 0 && <>
          <Typography variant='h3'>Certificate Access</Typography>
          <Typography color='textSecondary' variant='caption'>
            Certificates are documents issued to you by various third parties.
          </Typography>
          {certificateAccess.map((x, i) => (
            <div key={i} className={classes.certificate_grid}>
              <div>
                <Checkbox
                  checked={x.enabled}
                  onChange={() => toggleCertificateAccess(i)}
                />
              </div>
              <div className={classes.certificate_display}>
                <div>
                  <CertificateChip
                    certType={x.type}
                    verifier={x.verifierPublicKey}
                    fieldsToDisplay={x.fields}
                  />
                </div>
                <div className={classes.certificate_inset}>
                  <div className={classes.certificate_attribute_wrap}>
                    <div style={{ minHeight: '0.5em' }} />
                    <div />
                  </div>
                  <p style={{ marginBottom: '0px' }}><b>Reason:{' '}</b>{x.description}</p>
                </div>
              </div>
            </div>
          ))}
        </>}
        {basketAccess && basketAccess.length > 0 && <>
          <Typography variant='h3'>Basket Access</Typography>
          <Typography color='textSecondary' variant='caption'>
            Baskets hold various tokens or "things" you own.
          </Typography>
          {basketAccess.map((x, i) => (
            <div key={i} className={classes.basket_grid}>
              <div>
                <Checkbox
                  checked={x.enabled}
                  onChange={() => toggleBasketAccess(i)}
                />
              </div>
              <div>
                <BasketChip
                  basketId={x.basket}
                />
                <div className={classes.basket_inset}>
                  <p style={{ marginBottom: '0px' }}><b>Reason:{' '}</b>{x.description}</p>
                </div>
              </div>
            </div>
          ))}
        </>}
      </DialogContent>
      <br />
      <DialogActions style={{
        justifyContent: 'space-around',
        padding: '1em',
        flex: 'none'
      }}
      >
        <Button
          onClick={handleCancel}
          color='primary'
        >
          Deny All
        </Button>
        <Button
          color='primary'
          onClick={handleGrant}
        >
          Grant Selected
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default GroupPermissionHandler