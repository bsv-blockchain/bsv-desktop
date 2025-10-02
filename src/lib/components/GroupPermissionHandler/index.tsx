import { useState, useEffect, useContext } from 'react'
import {
  DialogContent, DialogContentText, DialogActions, Button, Typography, Checkbox, FormControlLabel, CircularProgress
} from '@mui/material'
import { makeStyles } from '@mui/styles'
import CustomDialog from '../CustomDialog'
import { WalletContext, WalletContextValue } from '../../WalletContext'
import { UserContext, UserContextValue } from '../../UserContext'
import AppChip from '../AppChip'
import ProtoChip from '../ProtoChip'
import CertificateChip from '../CertificateChip'
import BasketChip from '../BasketChip'
import AmountDisplay from '../AmountDisplay'
import { GroupedPermissions } from '@bsv/wallet-toolbox-client'

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

interface SpendingAuthorization {
  amount: number;
  enabled?: boolean;
  description?: string;
  // Avoid using index signature with any
  [key: string]: unknown;
}

interface ProtocolPermission {
  protocolID: [number, string];
  counterparty?: string;
  description?: string;
  enabled?: boolean;
  // Avoid using index signature with any
  [key: string]: unknown;
}

interface BasketAccessItem {
  basket: string;
  description?: string;
  enabled?: boolean;
  // Avoid using index signature with any
  [key: string]: unknown;
}

interface CertificateAccessItem {
  type: string;
  fields?: string[];
  verifierPublicKey?: string;
  description?: string;
  enabled?: boolean;
  // Avoid using index signature with any
  [key: string]: unknown;
}

interface GroupPermissions {
  protocolPermissions?: ProtocolPermission[];
  basketAccess?: BasketAccessItem[];
  certificateAccess?: CertificateAccessItem[];
  spendingAuthorization?: SpendingAuthorization;
}

// We use the structure of requests from the wallet context
// Each request contains requestID, originator and groupPermissions

const GroupPermissionHandler = () => {
  const {
    groupPermissionRequests,
    advanceGroupQueue,
    managers
  } = useContext<WalletContextValue>(WalletContext)

  const {
    groupPermissionModalOpen
  } = useContext<UserContextValue>(UserContext)

  const [originator, setOriginator] = useState('')
  const [requestID, setRequestID] = useState<string | null>(null)
  const [spendingAuthorization, setSpendingAuthorization] = useState<SpendingAuthorization | undefined>(undefined)
  const [protocolPermissions, setProtocolPermissions] = useState<ProtocolPermission[]>([])
  const [basketAccess, setBasketAccess] = useState<BasketAccessItem[]>([])
  const [certificateAccess, setCertificateAccess] = useState<CertificateAccessItem[]>([])
  const [isGranting, setIsGranting] = useState(false)
  const classes = useStyles()

  const handleCancel = async () => {
    // Deny the current group permission request
    if (requestID) {
      try {
        await managers?.permissionsManager.denyGroupedPermission(requestID)
        console.log('Denying group permission for requestID:', requestID)
      } catch (error) {
        console.error('Error denying group permission:', error)
      }
    }

    advanceGroupQueue()
  }

  const handleGrant = async () => {
    setIsGranting(true)
    try {
      const granted: GroupPermissions = {
        protocolPermissions: [],
        basketAccess: [],
        certificateAccess: []
      }

      if (
        typeof spendingAuthorization === 'object' &&
        spendingAuthorization?.enabled
      ) {
        const spendingAuthCopy = { ...spendingAuthorization }
        delete spendingAuthCopy.enabled
        granted.spendingAuthorization = spendingAuthCopy
      }

      for (const x of protocolPermissions) {
        if (x.enabled) {
          const xCopy = { ...x }
          delete xCopy.enabled
          granted.protocolPermissions.push(xCopy)
        }
      }

      for (const x of basketAccess) {
        if (x.enabled) {
          const xCopy = { ...x }
          delete xCopy.enabled
          granted.basketAccess.push(xCopy)
        }
      }

      for (const x of certificateAccess) {
        if (x.enabled) {
          const xCopy = { ...x }
          delete xCopy.enabled
          granted.certificateAccess.push(xCopy)
        }
      }

      if (requestID) {
        try {
          await managers?.permissionsManager.grantGroupedPermission({
            requestID,
            granted: granted as GroupedPermissions, //? TODO: Confirm this is correct
            expiry: 0 // ?
          })
          console.log('Granting group permission for requestID:', requestID, 'with granted:', granted)
        } catch (error) {
          console.error('Error granting group permission:', error)
        }
      }

      advanceGroupQueue()
    } finally {
      setIsGranting(false)
    }
  }

  useEffect(() => {
    // Monitor the group permission requests from the wallet context
    if (groupPermissionRequests && groupPermissionRequests.length > 0) {
      // Get the first group permission request
      const currentRequest = groupPermissionRequests[0]

      // Process the current request
      const processRequest = async () => {
        try {
          // Ensure we have proper typing for the current request
          const { requestID, originator, permissions } = currentRequest
          // Use the permissions property from the request as our groupPermissions
          const groupPermissions = permissions || {
            protocolPermissions: [],
            basketAccess: [],
            certificateAccess: []
          }

          // Set the request ID
          setRequestID(requestID)

          // Set the originator
          setOriginator(originator || '')

          // Set protocol permissions
          setProtocolPermissions(
            (groupPermissions?.protocolPermissions)
              ? groupPermissions.protocolPermissions.map(x => ({ ...x, enabled: true }))
              : []
          )

          // Set basket access permissions
          setBasketAccess(
            (groupPermissions?.basketAccess)
              ? groupPermissions.basketAccess.map(x => ({ ...x, enabled: true }))
              : []
          )

          // Set certificate access permissions
          setCertificateAccess(
            (groupPermissions?.certificateAccess)
              ? groupPermissions.certificateAccess.map(x => ({
                ...x,
                enabled: true,
                fields: Array.isArray(x.fields)
                  ? x.fields
                  : x.fields
                    ? Object.keys(x.fields)
                    : []
              }))
              : []
          )

          // Set spending authorization
          setSpendingAuthorization(
            (groupPermissions?.spendingAuthorization)
              ? { ...groupPermissions.spendingAuthorization, enabled: true }
              : undefined
          )
        } catch (e) {
          console.error('Error processing group permission request:', e)
        }
      }

      processRequest()
    } else {
      // Reset the dialog when there are no requests
      setOriginator('')
      setRequestID(null)
      setSpendingAuthorization(undefined)
      setProtocolPermissions([])
      setBasketAccess([])
      setCertificateAccess([])
    }
  }, [groupPermissionRequests, advanceGroupQueue])

  const toggleProtocolPermission = (index: number) => {
    setProtocolPermissions(prevPerms => {
      const newPerms = [...prevPerms]
      if (newPerms[index]) {
        newPerms[index] = { ...newPerms[index], enabled: !newPerms[index].enabled }
      }
      return newPerms
    })
  }

  const toggleCertificateAccess = (index: number) => {
    setCertificateAccess(prevAccess => {
      const newAccess = [...prevAccess]
      if (newAccess[index]) {
        newAccess[index] = {
          ...newAccess[index],
          enabled: !newAccess[index].enabled
        }
      }
      return newAccess
    })
  }

  const toggleBasketAccess = (index: number) => {
    setBasketAccess(prevAccess => {
      const newAccess = [...prevAccess]
      if (newAccess[index]) {
        newAccess[index] = { ...newAccess[index], enabled: !newAccess[index].enabled }
      }
      return newAccess
    })
  }

  return (
    <CustomDialog
      open={groupPermissionModalOpen && groupPermissionRequests.length > 0}
      onClose={handleCancel}
      maxWidth='md'
      fullWidth
      title='Select App Permissions'
    >
      <DialogContent>
        <DialogContentText>
          <br />
          An app is requesting access to some of your information, and it wants to do some things on your behalf. Have a look through the below list of items, and select the ones you'd be okay with.
        </DialogContentText>
        <br />
        <center>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            alignItems: 'center',
            width: 'min-content',
            gap: '2em'
          }}>
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
                    certVerifier={x.verifierPublicKey}
                  />
                </div>
                <div className={classes.certificate_inset}>
                  <div className={classes.certificate_attribute_wrap}>
                    <div style={{ minHeight: '0.5em' }} />
                    <div></div>
                  </div>
                  <p style={{ marginBottom: '0px' }}><b>Reason:{' '}</b>{x.description || ''}</p>
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
          disabled={isGranting}
        >
          Deny All
        </Button>
        <Button
          color='primary'
          onClick={handleGrant}
          disabled={isGranting}
          startIcon={isGranting ? <CircularProgress size={16} /> : undefined}
        >
          {isGranting ? 'Granting...' : 'Grant Selected'}
        </Button>
      </DialogActions>
    </CustomDialog>
  )
}

export default GroupPermissionHandler