import {
  Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, Button, Typography, LinearProgress,
  Grid, Box, CircularProgress
} from '@mui/material';
import { FC, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import AmountDisplay from './AmountDisplay';
import { WalletContext } from '../WalletContext';
import { PermissionToken, Services } from '@bsv/wallet-toolbox-client';
import { determineUpgradeAmount } from '../utils/determineUpgradeAmount';
import { useBsvExchangeRate } from '../hooks/useBsvExchangeRate';

type Props = {
  app: string;
  limit?: number;
  onEmptyList?: () => void;
};

/** Local in-memory cache keyed by `app` */
const SPENDING_CACHE = new Map<string, { auth: PermissionToken | null; spent: number }>();

export const SpendingAuthorizationList: FC<Props> = ({
  app,
  limit = 5,
  onEmptyList = () => { },
}) => {
  const { managers, spendingRequests } = useContext(WalletContext);

  // --------------------------------------------------------------------------
  //   STATE
  // --------------------------------------------------------------------------
  const [authorization, setAuthorization] = useState<PermissionToken | null>(null);
  const [currentSpending, setCurrentSpending] = useState(0);
  const [authorizedAmount, setAuthorizedAmount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<{ revoke?: boolean; increase?: boolean; list?: boolean }>({ list: true });

  // --------------------------------------------------------------------------
  //   CONSTANTS & HOOKS
  // --------------------------------------------------------------------------
  const usdPerBsv = useBsvExchangeRate();
  const cacheKey = app;
  const services = useMemo(() => new Services('main'), []);
  const prevRqRef = useRef<number>(spendingRequests.length);   // <-- bug-fix

  // --------------------------------------------------------------------------
  //   HELPERS
  // --------------------------------------------------------------------------
  const refreshAuthorizations = useCallback(async () => {
    // return cached data if available
    if (SPENDING_CACHE.has(cacheKey)) {
      const { auth, spent } = SPENDING_CACHE.get(cacheKey)!;
      setAuthorization(auth);
      setCurrentSpending(spent);
      setAuthorizedAmount(auth?.authorizedAmount ?? 0);
      setBusy(b => ({ ...b, list: false }));
      return;
    }

    try {
      const auths = await managers.permissionsManager.listSpendingAuthorizations({ originator: app });
      if (!auths?.length) {
        setAuthorization(null);
        setCurrentSpending(0);
        setAuthorizedAmount(0);
        SPENDING_CACHE.delete(cacheKey);
        onEmptyList();
      } else {
        const auth = auths[0];
        const spent = await managers.permissionsManager.querySpentSince(auth);
        setAuthorization(auth);
        setCurrentSpending(spent);
        setAuthorizedAmount(auth.authorizedAmount);
        SPENDING_CACHE.set(cacheKey, { auth, spent });
      }
    } catch {
      onEmptyList();
    } finally {
      setBusy(b => ({ ...b, list: false }));
    }
  }, [app, cacheKey, managers.permissionsManager, onEmptyList]);

  // --------------------------------------------------------------------------
  //   MUTATIONS
  // --------------------------------------------------------------------------
  const createSpendingAuthorization = async (usdLimit: number) => {
    try {
      await managers.permissionsManager.ensureSpendingAuthorization({
        originator: app,
        satoshis: Math.round((usdLimit * 1e8) / usdPerBsv),
        reason: 'Create a spending limit',
        seekPermission: true,
      });
      // Give the backend a brief moment to commit the new authorization
      await new Promise(res => setTimeout(res, 800));
      SPENDING_CACHE.delete(cacheKey);
      await refreshAuthorizations();
    } catch (e: unknown) {
      toast.error(`Failed to create spending authorization: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  const updateSpendingAuthorization = async (auth: PermissionToken) => {
    setBusy(b => ({ ...b, increase: true }));
    try {
      await managers.permissionsManager.ensureSpendingAuthorization({
        originator: app,
        satoshis: determineUpgradeAmount(auth.authorizedAmount, usdPerBsv),
        reason: 'Increase spending limit',
        seekPermission: true,
      });
      // Give the backend a brief moment to commit the new authorization
      await new Promise(res => setTimeout(res, 800));
      SPENDING_CACHE.delete(cacheKey);
      await refreshAuthorizations();
    } catch (e: unknown) {
      toast.error(`Failed to increase spending authorization: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(b => ({ ...b, increase: false }));
    }
  };

  const handleConfirmRevoke = async () => {
    if (!authorization) return;
    setBusy(b => ({ ...b, revoke: true }));
    try {
      await managers.permissionsManager.revokePermission(authorization);
      setDialogOpen(false);
      SPENDING_CACHE.delete(cacheKey);
      await refreshAuthorizations();
    } catch (e: unknown) {
      toast.error(`Failed to revoke spending authorization: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(b => ({ ...b, revoke: false }));
    }
  };

  // --------------------------------------------------------------------------
  //   EFFECTS
  // --------------------------------------------------------------------------
  useEffect(() => { refreshAuthorizations(); }, [refreshAuthorizations]);

  /**
   * Refresh **once** when the queue transitions from non-empty → empty.
   */
  useEffect(() => {
    if (prevRqRef.current > 0 && spendingRequests.length === 0) {
      // Small delay to let backend commit changes
      setTimeout(() => {
        SPENDING_CACHE.delete(cacheKey);
        refreshAuthorizations();
      }, 500);
    }
    prevRqRef.current = spendingRequests.length;
  }, [spendingRequests, cacheKey, refreshAuthorizations]);

  // --------------------------------------------------------------------------
  //   RENDER
  // --------------------------------------------------------------------------
  if (busy.list) {
    return (
      <Box textAlign="center" pt={6}>
        <CircularProgress size={40} />
        <Typography variant="body1" sx={{ mt: 2 }}>Loading spending authorizations…</Typography>
      </Box>
    );
  }

  return (
    <>
      {/* revoke-confirmation dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>Revoke authorization?</DialogTitle>
        <DialogContent>
          <DialogContentText>You can re-authorise spending the next time you use this app.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={busy.revoke}>Cancel</Button>
          <Button onClick={handleConfirmRevoke} disabled={busy.revoke}>
            {busy.revoke ? (<><CircularProgress size={16} sx={{ mr: 1 }} />Revoking…</>) : 'Revoke'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* authorised state ---------------------------------------------------- */}
      {authorization ? (
        <Grid container direction="column" spacing={3} sx={{ p: 2 }}>
          <Grid item container justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h2" gutterBottom>Monthly spending limits</Typography>
              <Typography variant="body1">This app is allowed to spend up to:</Typography>
              <Typography variant="h1" sx={{ pt: 1 }}>
                <AmountDisplay showFiatAsInteger>{authorizedAmount}</AmountDisplay>/mo.
              </Typography>
            </Box>
            <Button onClick={() => setDialogOpen(true)}>Revoke</Button>
          </Grid>

          <Box>
            <Typography variant="h5" paragraph>
              <b>
                Current spending (since {format(new Date(new Date().setDate(1)), 'MMMM do')}):
              </b>{' '}
              <AmountDisplay>{currentSpending}</AmountDisplay>
            </Typography>
            {!!authorizedAmount && (
              <LinearProgress
                variant="determinate"
                value={Math.min(100, (currentSpending / authorizedAmount) * 100)}
              />
            )}
          </Box>

          <Grid item xs={12} sm={6} md={4} alignSelf="center">
            <Button
              fullWidth
              onClick={() => updateSpendingAuthorization(authorization)}
              disabled={busy.increase}
            >
              {busy.increase ? (<><CircularProgress size={16} sx={{ mr: 1 }} />Increasing…</>) : 'Increase limits'}
            </Button>
          </Grid>
        </Grid>
      ) : (
        /* unauthorised state -------------------------------------------------- */
        <Box textAlign="center" pt={6}>
          <Typography variant="body1">This app must ask for permission before spending.</Typography>
          <Typography variant="h3" gutterBottom sx={{ pt: 2 }}>Choose your spending limit</Typography>
          <Box>
            {[5, 10, 20].map(usd =>
              <Button
                key={usd}
                variant="contained"
                sx={{ m: 1, textTransform: 'none' }}
                onClick={() => createSpendingAuthorization(usd)}
              >
                ${usd}/mo.
              </Button>
            )}
          </Box>
        </Box>
      )}
    </>
  );
};

export default SpendingAuthorizationList;
