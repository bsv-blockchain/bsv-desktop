import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import {
  List,
  ListItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Typography,
  ListSubheader,
  Divider,
  CircularProgress,
  Box,
} from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import { toast } from 'react-toastify';
import { formatDistance } from 'date-fns';

// Local components & utilities
import ProtoChip from '../ProtoChip';
import AppChip from '../AppChip';
import CounterpartyChip from '../CounterpartyChip';

// Wallet context (replace with the actual path)
import { WalletContext } from '../../WalletContext';
import { PermissionToken } from '@bsv/wallet-toolbox-client';

/* -------------------------------------------------------------------------- */
/*                              Types & Helpers                               */
/* -------------------------------------------------------------------------- */

/**
 * Grouped permission when the list is rendered in **app‑centric** view
 */
interface AppPermissionGroup {
  /** Application (originator) domain */
  originator: string;
  /** All permissions for this application (unique counterparties) */
  permissions: PermissionToken[];
}

/**
 * Grouped permission when the list is rendered in **protocol‑centric** view
 */
interface ProtocolPermissionGroup {
  /** Protocol identifier (e.g. "todo tokens") */
  protocolName: string;
  /** Associated security level */
  securityLevel: number;
  /** All permissions for this protocol/security level (unique counterparties) */
  permissions: PermissionToken[];
}

/**
 * Union type to cover both grouping modes so we can share state easily
 */
type PermissionGroup = AppPermissionGroup | ProtocolPermissionGroup;

/**
 * Props for <ProtocolPermissionList />
 */
export interface ProtocolPermissionListProps {
  /** App domain to filter permissions by (mutually exclusive with `protocol`) */
  app?: string;
  /** Maximum number of groups to display */
  limit?: number;
  /** Protocol ID to filter permissions by (mutually exclusive with `app`) */
  protocol?: string;
  /** Optional security level filter */
  securityLevel?: number;
  /** Counter‑party DID / address to filter by */
  counterparty?: string;
  /** Choose whether the list is grouped by protocol or by application */
  itemsDisplayed?: 'protocols' | 'apps';
  /** Show revoke buttons */
  canRevoke?: boolean;
  /** Display a numeric total below the list */
  displayCount?: boolean;
  /** Optional header text */
  listHeaderTitle?: string;
  /** Render an empty placeholder instead of returning `null` */
  showEmptyList?: boolean;
  /** Make the list items clickable */
  clickable?: boolean;
  /** Callback when the list is empty (e.g. collapse parent) */
  onEmptyList?: () => void;
}

/* -------------------------------------------------------------------------- */
/*                                 Styles                                      */
/* -------------------------------------------------------------------------- */

// NOTE: replace – or extend – with your own JSS if you have an existing
// `./style` export you want to build upon.
const useStyles = makeStyles(() => ({
  appList: {
    marginBottom: '1em',
  },
  counterpartyContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5em',
    width: '100%',
  },
  gridItem: {
    flex: '0 0 auto',
  },
  revokeButton: {
    textTransform: 'none',
  },
  buttonProgress: {
    marginLeft: '8px',
    position: 'relative',
  },
}));

/* -------------------------------------------------------------------------- */
/*                                Utilities                                    */
/* -------------------------------------------------------------------------- */

/**
 * Groups permissions by **application domain** (originator). Only one permission
 * is kept per counter‑party to avoid duplicates.
 */
function groupPermissionsByApp(tokens: PermissionToken[]): AppPermissionGroup[] {
  const map = new Map<string, PermissionToken[]>();

  tokens.forEach((token) => {
    const key = token.originator;

    const list = map.get(key) ?? [];
    // Only add if this counterparty hasn't already been seen for the app
    if (!list.some((p) => p.counterparty === token.counterparty)) {
      list.push(token);
      map.set(key, list);
    }
  });

  return Array.from(map.entries()).map(([originator, permissions]) => ({
    originator,
    permissions,
  }));
}

/**
 * Groups permissions by **protocol & security level**. Only one permission is
 * kept per counter‑party to avoid duplicates.
 */
function groupPermissionsByProtocol(tokens: PermissionToken[]): ProtocolPermissionGroup[] {
  // Composite key ensures uniqueness for protocol + security level combo
  const map = new Map<string, ProtocolPermissionGroup>();

  tokens.forEach((token) => {
    const key = JSON.stringify({ protocol: token.protocol, securityLevel: token.securityLevel });

    let entry = map.get(key);
    if (!entry) {
      entry = {
        protocolName: token.protocol,
        securityLevel: token.securityLevel ?? 0,
        permissions: [],
      };
      map.set(key, entry);
    }

    // Deduplicate by counterparty
    if (!entry.permissions.some((p) => p.counterparty === token.counterparty)) {
      entry.permissions.push(token);
    }
  });

  return Array.from(map.values());
}

/* -------------------------------------------------------------------------- */
/*                            Simple In-Memory Cache                           */
/* -------------------------------------------------------------------------- */
// Keyed by a JSON-stringified query descriptor
const PERM_CACHE = new Map<string, PermissionGroup[]>();

/* -------------------------------------------------------------------------- */
/*                              Main Component                                 */
/* -------------------------------------------------------------------------- */

/**
 * Lists protocol‑permission relationships (either: which apps can access a
 * protocol, **or** which protocols an app has access to). Fully typed with strict
 * deduplication and predictable rendering.
 */
const ProtocolPermissionList: React.FC<ProtocolPermissionListProps> = ({
  app,
  limit,
  protocol,
  securityLevel,
  counterparty,
  itemsDisplayed = 'protocols',
  clickable = false,
  canRevoke = false,
  displayCount = true,
  listHeaderTitle,
  showEmptyList = false,
  onEmptyList = () => {
    /* noop */
  },
}) => {
  /* ---------------------------- Memo Key ---------------------------- */
  const queryKey = useMemo(
    () =>
      JSON.stringify({ app, protocol, securityLevel, counterparty, itemsDisplayed, limit }),
    [app, protocol, securityLevel, counterparty, itemsDisplayed, limit]
  );

  /* ---------------------------- Runtime state ---------------------------- */
  const [perms, setPerms] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [toRevoke, setToRevoke] = useState<PermissionToken | PermissionGroup | null>(null);

  /* ----------------------------- Context ------------------------------ */
  const { managers } = useContext(WalletContext);

  /* -----------------------------  Hooks  ------------------------------ */
  const classes = useStyles();
  const history = useHistory();

  /* ---------------------------  Helpers  ----------------------------- */
  const refreshPerms = useCallback(async () => {
    if (!managers?.permissionsManager) return;

    // Return cached results if present
    if (PERM_CACHE.has(queryKey)) {
      setPerms(PERM_CACHE.get(queryKey)!);
      return;
    }

    try {
      setLoading(true);
      // Fetch permission tokens from wallet SDK
      const raw = await managers.permissionsManager.listProtocolPermissions({
        originator: app,
        // privileged: false, // TODO: add support at the component level
        protocolName: protocol,
        protocolSecurityLevel: securityLevel,
        counterparty
      });

      // Group & optionally limit results
      const grouped: PermissionGroup[] =
        itemsDisplayed === 'apps'
          ? groupPermissionsByApp(raw)
          : groupPermissionsByProtocol(raw);

      const finalGroups = limit ? grouped.slice(0, limit) : grouped;
      setPerms(finalGroups);
      // Cache the result
      PERM_CACHE.set(queryKey, finalGroups);
      if (grouped.length === 0) onEmptyList();
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false);
    }
  }, [app, protocol, securityLevel, counterparty, limit, itemsDisplayed]);

  const openRevokeDialog = (item: PermissionToken | PermissionGroup) => {
    setToRevoke(item);
    setDialogOpen(true);
  };

  const handleConfirmRevoke = async () => {
    if (!managers?.permissionsManager || !toRevoke) return;

    try {
      setDialogLoading(true);

      if ('permissions' in toRevoke) {
        console.log('revoking group', toRevoke)
        // Revoke permissions sequentially to avoid overwhelming the service
        const results = [];
        for (const perm of toRevoke.permissions) {
          try {
            console.log('revoking individual permission in group:', perm.txid)
            await managers.permissionsManager.revokePermission(perm);
            console.log('successfully revoked:', perm.txid)
            results.push({ success: true, permission: perm });
          } catch (error) {
            console.error('failed to revoke permission:', perm.txid, error);
            results.push({ success: false, permission: perm, error });
            // Continue with other permissions even if one fails
          }
        }

        const failed = results.filter(r => !r.success);
        if (failed.length > 0) {
          console.warn(`${failed.length} out of ${results.length} permissions failed to revoke`);
        }
      } else {
        console.log('revoking single permission', toRevoke)
        await managers.permissionsManager.revokePermission(toRevoke);
      }

    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      toast.error(`Permission may not have been revoked: ${errorMessage}`);
    } finally {
      setDialogLoading(false);
      setDialogOpen(false);
      setToRevoke(null);
      // Invalidate cached permissions for this query so we fetch fresh data
      PERM_CACHE.delete(queryKey);
      refreshPerms();
    }
  };

  /* ---------------------------- Lifecycle ---------------------------- */
  useEffect(() => {
    refreshPerms();
  }, [refreshPerms]);

  /* ---------------------------- Early exit ---------------------------- */
  if (perms.length === 0 && !showEmptyList) return null;

  /* ---------------------------  Render  ------------------------------ */
  return (
    <>
      {/* ---------------- Revoke confirmation dialog ---------------- */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle color="textPrimary">Revoke Permission?</DialogTitle>
        <DialogContent>
          <DialogContentText color="textSecondary">
            You can re-authorize this permission the next time you use the app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="primary" disabled={dialogLoading} onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            color="primary"
            disabled={dialogLoading}
            onClick={handleConfirmRevoke}
            startIcon={dialogLoading ? <CircularProgress size={16} /> : null}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------- Permission list ------------------------- */}
      <List>
        {listHeaderTitle && <ListSubheader>{listHeaderTitle}</ListSubheader>}

        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" py={4}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="textSecondary" sx={{ ml: 2 }}>
              Loading permissions...
            </Typography>
          </Box>
        ) : (
          perms.map((group, i) => (
            <React.Fragment key={i}>
              {/* --------------------------------------------------------- */}
              {/*                       APP‑CENTRIC                        */}
              {/* --------------------------------------------------------- */}
              {itemsDisplayed === 'apps' && isAppGroup(group) && (
                <div className={classes.appList}>
                  {/* Group header (App domain) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '1em', alignItems: 'center' }}>
                    <AppChip
                      backgroundColor="default"
                      label={group.originator}
                      showDomain
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        history.push(`/dashboard/app/${encodeURIComponent(group.originator)}`, {
                          state: { domain: group.originator },
                        });
                      }}
                    />

                    {canRevoke && (
                      <Button
                        onClick={() => openRevokeDialog(group)}
                        color="secondary"
                        className={classes.revokeButton}
                      >
                        {group.permissions.length > 1 ? 'Revoke All' : 'Revoke'}
                      </Button>
                    )}
                  </div>

                  {/* Counter‑parties within the app group */}
                  <ListItem>
                    <div className={classes.counterpartyContainer}>
                      {group.permissions
                        .filter((x) => x.counterparty)
                        .map((permission) => (
                          <div className={classes.gridItem} key={`${permission.counterparty}-${permission.txid}`}>
                            <CounterpartyChip
                              counterparty={permission.counterparty!}
                              size={1.1}
                              expires={formatDistance(new Date(permission.expiry * 1000), new Date(), {
                                addSuffix: true,
                              })}
                              onCloseClick={() => openRevokeDialog(permission)}
                              clickable
                              canRevoke={canRevoke}
                            />
                          </div>
                        ))}
                    </div>
                  </ListItem>
                </div>
              )}

              {/* --------------------------------------------------------- */}
              {/*                     PROTOCOL‑CENTRIC                      */}
              {/* --------------------------------------------------------- */}
              {itemsDisplayed === 'protocols' && isProtocolGroup(group) && (
                <div className={classes.appList}>
                  {/* Group header (Protocol) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '1em', alignItems: 'center' }}>
                    <ProtoChip
                      backgroundColor="default"
                      protocolID={group.protocolName}
                      securityLevel={group.securityLevel}
                      originator={group.permissions[0].originator}
                      clickable={clickable}
                      canRevoke={false}
                    />

                    {canRevoke && (
                      <Button
                        onClick={() => openRevokeDialog(group)}
                        color="secondary"
                        className={classes.revokeButton}
                      >
                        {group.permissions.length > 1 ? 'Revoke All' : 'Revoke'}
                      </Button>
                    )}
                  </div>

                  {/* Counterparties (or apps if `counterparty` filter is provided) */}
                  <ListItem>
                    <div className={classes.counterpartyContainer}>
                      {group.permissions.map((permission) => (
                        <div className={classes.gridItem} key={`${permission.counterparty}-${permission.txid}`}>
                          {counterparty ? (
                            <AppChip
                              backgroundColor="default"
                              label={permission.originator}
                              showDomain
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                history.push(`/dashboard/app/${encodeURIComponent(permission.originator)}`, {
                                  state: { domain: permission.originator },
                                });
                              }}
                              onCloseClick={() => openRevokeDialog(permission)}
                            />
                          ) : (
                            <CounterpartyChip
                              counterparty={permission.counterparty!}
                              size={1.1}
                              expires={formatDistance(new Date(permission.expiry * 1000), new Date(), {
                                addSuffix: true,
                              })}
                              onCloseClick={() => openRevokeDialog(permission)}
                              clickable
                              canRevoke={canRevoke}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </ListItem>
                  <Divider />
                </div>
              )}
            </React.Fragment>
          ))
        )}
      </List>

      {/* ------------------------- Footer – total count ------------------------- */}
      {displayCount && (
        <center>
          <Typography color="textSecondary">
            <i>Total Protocol Grants: {perms.length}</i>
          </Typography>
        </center>
      )}
    </>
  );
};

export default ProtocolPermissionList;

/* -------------------------------------------------------------------------- */
/*                          Type‑Guard Helper Fns                              */
/* -------------------------------------------------------------------------- */
function isAppGroup(group: PermissionGroup): group is AppPermissionGroup {
  return (group as AppPermissionGroup).originator !== undefined;
}

function isProtocolGroup(group: PermissionGroup): group is ProtocolPermissionGroup {
  return (group as ProtocolPermissionGroup).protocolName !== undefined;
}
