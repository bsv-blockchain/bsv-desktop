import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react'
import {
  List,
  ListItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Typography,
  Button,
  IconButton,
  Paper,
  ListSubheader,
  CircularProgress
} from '@mui/material'
import makeStyles from '@mui/styles/makeStyles'
import style from './style'
import { withRouter, RouteComponentProps } from 'react-router-dom'
import { formatDistance } from 'date-fns'
import CloseIcon from '@mui/icons-material/Close'
import { WalletContext } from '../../WalletContext'

// Simple cache for certificate permissions
const CERT_CACHE = new Map<string, GrantItem[]>();
import CertificateChip from '../CertificateChip'
import AppChip from '../AppChip'
import sortPermissions from './sortPermissions'
import { toast } from 'react-toastify'
import { PermissionToken } from '@bsv/wallet-toolbox-client'

interface AppGrant {
  originator: string
  permissions: PermissionToken[]
}

// When the list is not displayed as apps, we assume that the grant is simply a Permission.
type GrantItem = AppGrant | PermissionToken

// Props for the CertificateAccessList component.
interface CertificateAccessListProps extends RouteComponentProps {
  app: string
  itemsDisplayed: string
  counterparty: string
  type: string
  limit: number
  displayCount?: boolean
  listHeaderTitle?: string
  showEmptyList?: boolean
  canRevoke?: boolean
  onEmptyList?: () => void
}

const useStyles = makeStyles(style, {
  name: 'CertificateAccessList'
})

const CertificateAccessList: React.FC<CertificateAccessListProps> = ({
  app,
  itemsDisplayed = 'certificates',
  counterparty = '',
  type = 'certificate',
  limit,
  displayCount = true,
  listHeaderTitle,
  showEmptyList = false,
  canRevoke = false,
  onEmptyList = () => { },
  history
}) => {
  // Build stable query key
  const queryKey = useMemo(() => JSON.stringify({ app, itemsDisplayed, counterparty, type, limit }), [app, itemsDisplayed, counterparty, type, limit]);

  const [grants, setGrants] = useState<GrantItem[]>([])
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)
  const [currentAccessGrant, setCurrentAccessGrant] = useState<PermissionToken | null>(null)
  const [currentApp, setCurrentApp] = useState<AppGrant | null>(null)
  const [dialogLoading, setDialogLoading] = useState<boolean>(false)
  const classes = useStyles()
  const { managers, adminOriginator } = useContext(WalletContext)

  // NOTE: add `force` parameter so we can bypass cache after revocation
  const refreshGrants = useCallback(async (force: boolean = false) => {
    try {
      if (!managers?.permissionsManager) return

      if (!force && CERT_CACHE.has(queryKey)) {
        setGrants(CERT_CACHE.get(queryKey)!);
        return;
      }

      // invalidate cache for this key when forcing
      if (force) {
        CERT_CACHE.delete(queryKey)
      }

      console.log('Fetching certificate access grants...', { app, type, counterparty, limit, itemsDisplayed })
      const permissions: PermissionToken[] = await managers.permissionsManager.listCertificateAccess({
        originator: app,
      })
      console.log('Fetched certificate access grants:', permissions)

      if (itemsDisplayed === 'apps') {
        const results = sortPermissions(permissions)
        setGrants(results)
        CERT_CACHE.set(queryKey, results)
      } else {
        setGrants(permissions)
        CERT_CACHE.set(queryKey, permissions)
      }

      if (permissions.length === 0) {
        onEmptyList()
      }
    } catch (error) {
      console.error(error)
    }
  }, [app, counterparty, type, limit, itemsDisplayed, onEmptyList, managers?.permissionsManager, queryKey])

  const revokeAccess = async (grant: PermissionToken) => {
    setCurrentAccessGrant(grant)
    setDialogOpen(true)
  }

  const revokeAllAccess = async (appGrant: AppGrant) => {
    setCurrentApp(appGrant)
    setDialogOpen(true)
  }

  // Handle revoke dialog confirmation
  const handleConfirm = async () => {
    try {
      setDialogLoading(true)

      if (currentAccessGrant) {
        await managers.permissionsManager.revokePermission(currentAccessGrant)
      } else {
        if (!currentApp || !currentApp.permissions) {
          throw new Error('Unable to revoke permissions!')
        }
        for (const permission of currentApp.permissions) {
          try {
            await managers.permissionsManager.revokePermission(permission)
          } catch (error) {
            console.error(error)
          }
        }
        setCurrentApp(null)
      }

      setCurrentAccessGrant(null)
      await refreshGrants(true)

      setDialogOpen(false)
      setDialogLoading(false)
    } catch (e: any) {
      toast.error('Certificate access grant may not have been revoked: ' + e.message)
      await refreshGrants(true) // still try to refresh
      setCurrentAccessGrant(null)
      setCurrentApp(null)
      setDialogOpen(false)
      setDialogLoading(false)
    }
  }

  const handleDialogClose = () => {
    if (dialogLoading) return // prevent closing while in-flight
    setCurrentAccessGrant(null)
    setCurrentApp(null)
    setDialogOpen(false)
  }

  useEffect(() => {
    refreshGrants()
  }, [refreshGrants])

  
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail || {}
      if (detail.originator && detail.originator !== app) return
      refreshGrants(true)
    }

  window.addEventListener('cert-access-changed', handler as EventListener)
  return () => window.removeEventListener('cert-access-changed', handler as EventListener)
}, [app, refreshGrants])

  if (grants.length === 0 && !showEmptyList) {
    return <></>
  }

  return (
    <>
      <Dialog open={dialogOpen} onClose={handleDialogClose}>
        <DialogTitle>Revoke Access?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You can re-authorize this certificate access grant next time you use this app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="primary" disabled={dialogLoading} onClick={handleDialogClose}>
            Cancel
          </Button>
          <Button color="primary" disabled={dialogLoading} onClick={handleConfirm} startIcon={dialogLoading ? <CircularProgress size={16} /> : null}>
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      <List>
        {listHeaderTitle && <ListSubheader>{listHeaderTitle}</ListSubheader>}
        {grants.map((grant, i) => (
          <React.Fragment key={i}>
            {itemsDisplayed === 'apps' ? (
              <div className={(classes as any).appList}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingRight: '1em',
                    alignItems: 'center'
                  }}
                >
                  <AppChip
                    label={(grant as AppGrant).originator}
                    showDomain
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      history.push({
                        pathname: `/dashboard/app/${encodeURIComponent((grant as AppGrant).originator)}`,
                        state: { domain: (grant as AppGrant).originator }
                      })
                    }}
                  />
                  {canRevoke && (
                    <>
                      {(grant as AppGrant).permissions.length > 0 && (grant as AppGrant).originator ? (
                        <Button
                          onClick={() => revokeAllAccess(grant as AppGrant)}
                          color="secondary"
                          className={(classes as any).revokeButton}
                        >
                          Revoke All
                        </Button>
                      ) : (
                        <IconButton
                          edge="end"
                          onClick={() => revokeAccess((grant as AppGrant).permissions[0])}
                          size="large"
                        >
                          <CloseIcon />
                        </IconButton>
                      )}
                    </>
                  )}
                </div>
                <Paper elevation={4}>
                  <ListItem>
                    <div className={classes.counterpartyContainer}>
                      {(grant as AppGrant).permissions.map((permission, idx) => (
                        <div className={classes.gridItem} key={idx}>
                          <h1>{permission.certType}</h1>
                          <CertificateChip
                            certType={(permission as PermissionToken).certType}
                            expiry={(permission as PermissionToken).expiry}
                            canRevoke={canRevoke}
                            onRevokeClick={() => revokeAccess(permission)}
                            certVerifier={(permission as PermissionToken).verifier}
                            clickable
                            size={1.3}
                          />
                        </div>
                      ))}
                    </div>
                  </ListItem>
                </Paper>
              </div>
            ) : (
              <Paper elevation={4}>
                <ListItem className={(classes as any).action_card}>
                  <CertificateChip
                    certType={(grant as PermissionToken).certType}
                    expiry={(grant as PermissionToken).expiry}
                    canRevoke={canRevoke}
                    onRevokeClick={() => revokeAccess(grant as PermissionToken)}
                    certVerifier={(grant as PermissionToken).verifier}
                    clickable
                    size={1.3}
                  />
                </ListItem>
              </Paper>
            )}
          </React.Fragment>
        ))}
      </List>

      {displayCount && (
        <center>
          <Typography color="textSecondary">
            <i>Total Certificate Access Grants: {grants.length}</i>
          </Typography>
        </center>
      )}
    </>
  )
}

export default withRouter(CertificateAccessList)
