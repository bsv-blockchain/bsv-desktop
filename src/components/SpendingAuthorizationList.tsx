import {
  Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, Button, Typography, LinearProgress,
  Grid, Box, CircularProgress,
  TextField
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
  const [busy, setBusy] = useState<{ revoke?: boolean; increase?: boolean; list?: boolean; create?: boolean }>({ list: true });
  const [isEditingLimit, setIsEditingLimit] = useState(false);
  const [tempLimit, setTempLimit] = useState<string>('');
  const [originalLimit, setOriginalLimit] = useState<string>(''); // Add this state
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
    setBusy(b => ({ ...b, create: true }));
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
      setIsEditingLimit(false);
    } catch (e: unknown) {
      toast.error(`Failed to create spending authorization: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(b => ({ ...b, create: false }));
    }
  };
  const updateSpendingAuthorization = async (auth: PermissionToken) => {
    setBusy(b => ({ ...b, increase: true }));
    if(tempLimit < originalLimit + 1)
    {
      setBusy(b => ({ ...b, increase: false }));
      throw("new limit must be higher than old limit by at least $1");
    }
    const newLimit = parseFloat(tempLimit);
    try {
      await managers.permissionsManager.ensureSpendingAuthorization({
        originator: app,
        satoshis: Math.round((newLimit * 1e8) / usdPerBsv),
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
        <Box>
          <Typography variant="h2" gutterBottom>Monthly spending limit</Typography>
          
          {/* Current monthly spending limit section */}
         <Box mb={3}>
            <Box display="flex" alignItems="center" gap={2}>
             <TextField
                value={isEditingLimit ? tempLimit : `${Math.round((authorizedAmount * usdPerBsv) / 1e8)}`}
                onChange={(e) => {
                  if (!isEditingLimit) {
                    const currentLimitStr = String(Math.round((authorizedAmount * usdPerBsv) / 1e8));
                    setIsEditingLimit(true);
                    setTempLimit(e.target.value);
                    setOriginalLimit(currentLimitStr);
                  } else {
                    setTempLimit(e.target.value);
                  }
                }}
                onFocus={() => {
                  if (!isEditingLimit) {
                    const currentLimitStr = String(Math.round((authorizedAmount * usdPerBsv) / 1e8));
                    setIsEditingLimit(true);
                    setTempLimit(currentLimitStr);
                    setOriginalLimit(currentLimitStr);
                  }
                }}
                placeholder="Enter limit in USD"
                size="small"
                type={isEditingLimit ? "number" : "text"}
                inputProps={isEditingLimit ? { min: 0, step: 0.01 } : { readOnly: true }}
                 InputProps={{
                  startAdornment: '$'
                }}
                sx={{ 
                  width: 150,
                  '& input': { cursor: isEditingLimit ? 'text' : 'pointer' },
                  '& input[type=number]': {
                    MozAppearance: 'textfield'
                  },
                  '& input[type=number]::-webkit-outer-spin-button': {
                    WebkitAppearance: 'none',
                    margin: 0
                  },
                  '& input[type=number]::-webkit-inner-spin-button': {
                    WebkitAppearance: 'none',
                    margin: 0
                  }
                }}
              />
                            {isEditingLimit && tempLimit !== originalLimit && (
                <>
                  <Button
                    onClick={() =>updateSpendingAuthorization(authorization)}
                    disabled={
                      busy.increase || 
                      !tempLimit || 
                      isNaN(parseFloat(tempLimit)) || 
                      parseFloat(tempLimit) <= parseFloat(originalLimit)
                    }
                    size="small"
                  >
                    {busy.increase ? (<><CircularProgress size={16} sx={{ mr: 1 }} />Updating…</>) : 'Submit'}
                  </Button>
                  {tempLimit && parseFloat(tempLimit) <= parseFloat(originalLimit) && (
                    <Typography variant="caption" color="error" sx={{ ml: 1 }}>
                      New limit must be higher than current limit
                    </Typography>
                  )}
                </>
              )}
            </Box>
          </Box>
          {/* Current spending progress section */}
          <Box>
            <Typography variant="body1" gutterBottom>Current spending</Typography>
            <LinearProgress
              variant="determinate"
              value={Math.min(((currentSpending * -1)/ authorizedAmount) * 100, 100)}
              sx={{ height: 8, borderRadius: 4, mb: 1 }}
            />
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" color="text.secondary">
                <AmountDisplay showFiatAsInteger>{currentSpending * -1}</AmountDisplay> spent
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <AmountDisplay showFiatAsInteger>{authorizedAmount}</AmountDisplay> limit
              </Typography>
            </Box>
          </Box>
          <Box mt={3} textAlign="center">
            <Button
              variant="outlined"
              color="error"
              onClick={() => setDialogOpen(true)}
              size="small"
            >
              Revoke
            </Button>
          </Box>
        </Box>
      ) : (
               /* unauthorised state -------------------------------------------------- */
      <Box textAlign="center" pt={6}>
          <Typography variant="body1">This app must ask for permission before spending.</Typography>
          <Typography variant="body1" gutterBottom sx={{ pt: 2 }}>Allow this app to spend a certain amount?</Typography>
          <Box display="flex" alignItems="center" gap={2} justifyContent="center">
             <TextField
                value={isEditingLimit ? tempLimit : ''}
                onChange={(e) => {
                  if (!isEditingLimit) {
                    setIsEditingLimit(true);
                    setTempLimit(e.target.value);
                    setOriginalLimit('');
                  } else {
                    setTempLimit(e.target.value);
                  }
                }}
                onFocus={() => {
                  if (!isEditingLimit) {
                    setIsEditingLimit(true);
                    setTempLimit('');
                    setOriginalLimit('');
                  }
                }}
                placeholder="Enter limit in USD"
                size="small"
                type="number"
                inputProps={{ min: 0, step: 0.01 }}
                InputProps={{
                  startAdornment: '$'
                }}
                sx={{ 
                  width: 150,
                  '& input[type=number]': {
                    MozAppearance: 'textfield'
                  },
                  '& input[type=number]::-webkit-outer-spin-button': {
                    WebkitAppearance: 'none',
                    margin: 0
                  },
                  '& input[type=number]::-webkit-inner-spin-button': {
                    WebkitAppearance: 'none',
                    margin: 0
                  }
                }}
              />
              {tempLimit && (
                <Button
                  onClick={() => createSpendingAuthorization(parseFloat(tempLimit))}
                  disabled={busy.create || !tempLimit}
                  size="small"
                >
                  {busy.create ? (<><CircularProgress size={16} sx={{ mr: 1 }} />Creating…</>) : 'Submit'}
                </Button>
              )}
            </Box>
        </Box>
      )}
    </>
  );
};

export default SpendingAuthorizationList;
