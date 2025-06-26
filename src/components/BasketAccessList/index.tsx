import React, { useState, useEffect, useCallback, useContext } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  ListSubheader
} from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import style from './style';
import { toast } from 'react-toastify';
import BasketChip from '../BasketChip';
import { useHistory } from 'react-router-dom/cjs/react-router-dom.min';
import AppChip from '../AppChip';
import { formatDistance } from 'date-fns';
import { WalletContext } from '../../WalletContext'

const useStyles = makeStyles(style, {
  name: 'BasketAccessList'
});

// Enhanced PermissionToken interface to represent both input and output formats
interface PermissionToken {
  id?: string;
  originator?: string;
  counterparty?: string;
  basket?: string;
  expiry?: number;
  expires?: string;
  tags?: Record<string, string>;
  app?: string;
  domain?: string;
  accessGrantID?: string;
  permissionGrant?: unknown;
}

// Our component's working Grant type that ensures we have the fields we need
interface Grant extends PermissionToken {
  domain?: string; // Will extract from app or originator if needed
  expiry?: number; // Will convert from expires string if needed
}

interface AppWithGrants {
  grant: any;
  grants: { permissionGrant: any }[];
}

interface BasketAccessListProps {
  app?: string;
  basket?: string;
  limit?: number;
  securityLevel?: number;
  itemsDisplayed?: 'baskets' | 'apps';
  canRevoke?: boolean;
  displayCount?: boolean;
  listHeaderTitle?: string;
  showEmptyList?: boolean;
  onEmptyList?: () => void;
}

/**
 * A component for displaying a list of basket permissions as apps with access to a basket, or baskets an app can access.
 */
const BasketAccessList: React.FC<BasketAccessListProps> = ({
  app,
  basket,
  limit,
  itemsDisplayed = 'baskets',
  canRevoke = false,
  displayCount = true,
  listHeaderTitle,
  showEmptyList = false,
  onEmptyList = () => { }
}) => {
  // Validate params
  if (itemsDisplayed === 'apps' && app) {
    const e = new Error('Error in BasketAccessList: apps cannot be displayed when providing an app param! Please provide a valid basket instead.');
    throw e;
  }
  if (itemsDisplayed === 'baskets' && basket) {
    const e = new Error('Error in BasketAccessList: baskets cannot be displayed when providing a basket param! Please provide a valid app domain instead.');
    throw e;
  }

  const [currentApp, setCurrentApp] = useState<AppWithGrants | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [currentAccessGrant, setCurrentAccessGrant] = useState<Grant | null>(null);
  const [dialogLoading, setDialogLoading] = useState<boolean>(false);
  const classes = useStyles();
  const history = useHistory();
  const { managers, adminOriginator } = useContext(WalletContext)

  const refreshGrants = useCallback(async () => {
    if (!managers || !adminOriginator) return;

    try {
      // Use the enhanced listBasketAccess method with basket parameter
      // Call the listBasketAccess API with the appropriate parameters
      const tokens = await managers.permissionsManager.listBasketAccess({
        basket: basket,
        originator: app
      } as { basket?: string; originator?: string });

      // Transform tokens into grants with necessary display properties
      const grants = tokens.map((token: PermissionToken) => {
        // Extract the domain from the token - may be in different fields based on context
        const domain = token.originator || token.app || token.domain || 'unknown';

        // Calculate expiry based on token data
        const expiry = token.expiry ||
          (token.expires ? Math.floor(new Date(token.expires).getTime() / 1000) : undefined);

        return {
          ...token,
          domain,
          expiry,
          // Use either explicit ID or fallback to accessGrantID
          accessGrantID: (token as { id?: string }).id || token.accessGrantID || ''
        } as Grant;
      });

      setGrants(grants);
      if (grants.length === 0) {
        onEmptyList();
      }
    } catch (error) {
      console.error('Failed to refresh grants:', error);
      toast.error(`Failed to load access list: ${(error as Error).message}`);
    }
  }, [app, basket, limit]);

  const revokeAccess = async (grant: Grant) => {
    setCurrentAccessGrant(grant);
    setDialogOpen(true);
  };

  const handleConfirm = async () => {
    if (!managers || !adminOriginator) return;

    try {
      setDialogLoading(true);
      if (currentAccessGrant) {
        // Revoke the specific access grant
        await managers.permissionsManager.denyPermission(
          currentAccessGrant.accessGrantID
        );
      } else {
        if (!currentApp || !currentApp.grant) {
          const e = new Error('Unable to revoke permissions!');
          throw e;
        }
        for (const permission of currentApp.grants) {
          try {
            // Revoke each permission in the app grants
            await managers.permissionsManager.denyPermission(
              permission.permissionGrant.accessGrantID
            );
          } catch (error) {
            console.error(error);
          }
        }
        setCurrentApp(null);
      }

      setCurrentAccessGrant(null);
      setDialogOpen(false);
      setDialogLoading(false);
      refreshGrants();
    } catch (e) {
      toast.error(`Access may not have been revoked: ${(e as Error).message}`);
      refreshGrants();
      setCurrentAccessGrant(null);
      setDialogOpen(false);
      setDialogLoading(false);
    }
  };

  const handleDialogClose = () => {
    setCurrentAccessGrant(null);
    setDialogOpen(false);
  };

  useEffect(() => {
    refreshGrants();
  }, [refreshGrants]);

  if (grants.length === 0 && !showEmptyList) {
    return (<></>);
  }

  return (
    <>
      <Dialog
        open={dialogOpen}
      >
        <DialogTitle color='textPrimary'>
          Revoke Access?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            You can re-authorize this access grant next time you use this app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            color='primary'
            disabled={dialogLoading}
            onClick={handleDialogClose}
          >
            Cancel
          </Button>
          <Button
            color='primary'
            disabled={dialogLoading}
            onClick={handleConfirm}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>
      {listHeaderTitle && (
        <ListSubheader>
          {listHeaderTitle}
        </ListSubheader>
      )}
      <div className={classes.basketContainer}>
        {grants.map((grant, i) => (
          <React.Fragment key={i}>
            {itemsDisplayed === 'apps' && (
              <div className={classes.basketContainer}>
                <AppChip
                  label={grant.domain || 'unknown'}
                  showDomain
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    history.push({
                      pathname: `/dashboard/app/${encodeURIComponent(grant.domain)}`,
                      state: {
                        domain: grant.domain
                      }
                    });
                  }}
                  onCloseClick={canRevoke ? () => { revokeAccess(grant); } : undefined}
                  backgroundColor='default'
                  expires={grant.expiry ? formatDistance(new Date(grant.expiry * 1000), new Date(), { addSuffix: true }) : undefined}
                />
              </div>
            )}

            {itemsDisplayed !== 'apps' && (
              <div style={{ marginRight: '0.4em' }}>
                <BasketChip
                  basketId={grant.basket}
                  lastAccessed={grant.tags?.lastAccessed}
                  domain={grant.domain}
                  clickable
                  expires={formatDistance(new Date(grant.expiry * 1000), new Date(), { addSuffix: true })}
                  onCloseClick={() => revokeAccess(grant)}
                  canRevoke={canRevoke}
                />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </>
  );
};

export default BasketAccessList;
