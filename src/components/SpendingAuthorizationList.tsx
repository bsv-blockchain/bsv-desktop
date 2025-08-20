import {
  Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, Button, Typography, LinearProgress,
  Grid, Box, CircularProgress,
  TextField, InputAdornment
} from '@mui/material';
import { FC, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import AmountDisplay from './AmountDisplay';
import { WalletContext } from '../WalletContext';
import { PermissionToken, Services } from '@bsv/wallet-toolbox-client';
import { determineUpgradeAmount } from '../utils/determineUpgradeAmount';
// NOTE: rely on the same exchange-rate provider used by AmountDisplay
import { ExchangeRateContext } from './AmountDisplay/ExchangeRateContextProvider';
import AppLogo from './AppLogo';

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
  const { managers, spendingRequests, settings } = useContext(WalletContext);
  const rates = useContext<any>(ExchangeRateContext); // { satoshisPerUSD, eurPerUSD, gbpPerUSD, ... }

  // --------------------------------------------------------------------------
  //   STATE
  // --------------------------------------------------------------------------
  const [authorization, setAuthorization] = useState<PermissionToken | null>(null);
  const [currentSpending, setCurrentSpending] = useState(0);
  const [authorizedAmount, setAuthorizedAmount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<{ revoke?: boolean; list?: boolean; create?: boolean; waitingForAuth?: boolean; renewLimit?: boolean }>({ list: true });
  const [isEditingLimit, setIsEditingLimit] = useState(false);
  const [tempLimit, setTempLimit] = useState<string>('');
  const [originalLimit, setOriginalLimit] = useState<string>('');

  // --------------------------------------------------------------------------
  //   CURRENCY / UNITS (mirror AmountDisplay semantics)
  // --------------------------------------------------------------------------
  const rawCurrency: string = String(
    (settings as any)?.currency ??
    (settings as any)?.fiatCurrency ??
    (settings as any)?.displayCurrency ??
    ''
  ).toUpperCase();

  type Unit =
    | { kind: 'sats' }
    | { kind: 'bsv' }
    | { kind: 'fiat'; code: 'USD' | 'EUR' | 'GBP' };

  const unit: Unit = (() => {
    if (/SAT/i.test(rawCurrency)) return { kind: 'sats' };
    if (rawCurrency === 'BSV' || /BITCOIN/i.test(rawCurrency)) return { kind: 'bsv' };
    if (rawCurrency === 'USD' || rawCurrency === 'EUR' || rawCurrency === 'GBP') {
      return { kind: 'fiat', code: rawCurrency };
    }
    // anything else -> sats (matches AmountDisplay behavior)
    return { kind: 'sats' };
  })();

  const inputPlaceholder =
    unit.kind === 'sats' ? 'Enter limit in sats'
    : unit.kind === 'bsv' ? 'Enter limit in BSV'
    : `Enter limit in ${unit.code}`;

  const inputStep =
    unit.kind === 'sats' ? 1
    : unit.kind === 'bsv' ? 0.00000001
    : 0.01;

  const adornmentLabel =
    unit.kind === 'sats' ? 'sats'
    : unit.kind === 'bsv' ? 'BSV'
    : unit.code === 'USD' ? '$'
    : unit.code === 'EUR' ? '€'
    : unit.code === 'GBP' ? '£'
    : unit.code;

  // --------------------------------------------------------------------------
  //   CONVERSIONS (use same rate model as AmountDisplay)
  // --------------------------------------------------------------------------
  const { satoshisPerUSD, eurPerUSD, gbpPerUSD } = rates || {};

  const fiatRatesReady =
    unit.kind !== 'fiat' ? true
    : unit.code === 'USD' ? !!satoshisPerUSD
    : unit.code === 'EUR' ? (!!satoshisPerUSD && !!eurPerUSD)
    : unit.code === 'GBP' ? (!!satoshisPerUSD && !!gbpPerUSD)
    : false;

  // sats -> input units
  const satsToInput = useCallback((sats: number) => {
    if (unit.kind === 'sats') return sats;
    if (unit.kind === 'bsv') return sats / 1e8;

    // fiat
    if (!satoshisPerUSD) return NaN;
    const usd = sats / satoshisPerUSD; // USD = sats / (sats per USD)
    if (unit.code === 'USD') return usd;
    if (unit.code === 'EUR') {
      if (!eurPerUSD) return NaN;
      return usd * eurPerUSD; // EUR = USD * (EUR per USD)
    }
    if (unit.code === 'GBP') {
      if (!gbpPerUSD) return NaN;
      return usd * gbpPerUSD; // GBP = USD * (GBP per USD)
    }
    return NaN;
  }, [unit, satoshisPerUSD, eurPerUSD, gbpPerUSD]);

  // input units -> sats
  const inputToSats = useCallback((amount: number) => {
    if (unit.kind === 'sats') return Math.round(amount);
    if (unit.kind === 'bsv') return Math.round(amount * 1e8);

    // fiat
    if (!satoshisPerUSD) return NaN;
    let usd = amount;
    if (unit.code === 'EUR') {
      if (!eurPerUSD) return NaN;
      usd = amount / eurPerUSD; // USD = EUR / (EUR per USD)
    } else if (unit.code === 'GBP') {
      if (!gbpPerUSD) return NaN;
      usd = amount / gbpPerUSD; // USD = GBP / (GBP per USD)
    }
    return Math.round(usd * satoshisPerUSD); // sats = USD * (sats per USD)
  }, [unit, satoshisPerUSD, eurPerUSD, gbpPerUSD]);

  // --------------------------------------------------------------------------
  //   MISC
  // --------------------------------------------------------------------------
  const cacheKey = app;
  const services = useMemo(() => new Services('main'), []); // keep if other code relies on this instantiation
  const prevRqRef = useRef<number>(spendingRequests.length);

  // --------------------------------------------------------------------------
  //   HELPERS
  // --------------------------------------------------------------------------
  const refreshAuthorizations = useCallback(async () => {
    // Skip cache when waiting for authorization to ensure we fetch fresh data
    if (!busy.waitingForAuth && !busy.renewLimit && SPENDING_CACHE.has(cacheKey)) {
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
        if (!busy.waitingForAuth && !busy.renewLimit) {
          setAuthorization(null);
          setCurrentSpending(0);
          setAuthorizedAmount(0);
          SPENDING_CACHE.delete(cacheKey);
          onEmptyList();
        }
      } else {
        const auth = auths[0];
        const spent = await managers.permissionsManager.querySpentSince(auth);
        setAuthorization(auth);
        setCurrentSpending(spent);
        setAuthorizedAmount(auth.authorizedAmount);
        SPENDING_CACHE.set(cacheKey, { auth, spent });
      }
    } catch {
      if (!busy.waitingForAuth && !busy.renewLimit) {
        onEmptyList();
      }
    } finally {
      setBusy(b => ({ ...b, list: false }));
    }
  }, [app, cacheKey, managers.permissionsManager, onEmptyList, busy.waitingForAuth, busy.renewLimit]);

  // --------------------------------------------------------------------------
  //   MUTATIONS
  // --------------------------------------------------------------------------
  const createSpendingAuthorization = async (limitValue: number) => {
    setBusy(b => ({ ...b, create: true }));
    try {
      const sats = inputToSats(limitValue);
      if (Number.isNaN(sats)) {
        throw new Error('Exchange rate unavailable for the selected currency.');
      }
      await managers.permissionsManager.ensureSpendingAuthorization({
        originator: app,
        satoshis: sats,
        reason: 'Create a spending limit',
        seekPermission: true,
      });
      setBusy(b => ({ ...b, create: false, waitingForAuth: true }));
      await new Promise(res => setTimeout(res, 6000));
      SPENDING_CACHE.delete(cacheKey);
      await refreshAuthorizations();
      setIsEditingLimit(false);
    } catch (e: unknown) {
      toast.error(`Failed to create spending authorization: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(b => ({ ...b, create: false, waitingForAuth: false }));
    }
  };

  const revokeAndSetNewLimit = async (limitValue: number) => {
    if (!authorization) return;
    setBusy(b => ({ ...b, renewLimit: true }));
    try {
      await managers.permissionsManager.revokePermission(authorization);
      SPENDING_CACHE.delete(cacheKey);
      await refreshAuthorizations();
      await new Promise(res => setTimeout(res, 2000));
      await createSpendingAuthorization(limitValue);
    } catch (e: unknown) {
      toast.error(`Failed to update spending authorization: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(b => ({ ...b, renewLimit: false }));
      setIsEditingLimit(false);
    }
  };

  const updateSpendingAuthorization = async (auth: PermissionToken) => {
    setBusy(b => ({ ...b, renewLimit: true }));
    const newLimit = parseFloat(tempLimit);

    // Compare using SAME unit as the input field
    const currentLimitInInputUnits = satsToInput(authorizedAmount);

    if (newLimit < currentLimitInInputUnits) {
      await revokeAndSetNewLimit(newLimit);
      return;
    }
    try {
      const sats = inputToSats(newLimit);
      if (Number.isNaN(sats)) {
        throw new Error('Exchange rate unavailable for the selected currency.');
      }
      await managers.permissionsManager.ensureSpendingAuthorization({
        originator: app,
        satoshis: sats,
        reason: 'Increase spending limit',
        seekPermission: true,
      });
      await new Promise(res => setTimeout(res, 2300));
      SPENDING_CACHE.delete(cacheKey);
      await refreshAuthorizations();
      setIsEditingLimit(false);
    } catch (e: unknown) {
      toast.error(`Failed to increase spending authorization: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(b => ({ ...b, renewLimit: false }));
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

  // Refresh once when the queue transitions from non-empty → empty.
  useEffect(() => {
    if (prevRqRef.current > 0 && spendingRequests.length === 0) {
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
        <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={50} /></Box>
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
      {(authorization || busy.renewLimit) ? (
        <Box>
          {busy.renewLimit ? (
            <Box textAlign="center" pt={6}>
              <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={50} /></Box>
              <Typography variant="body1" sx={{ mt: 2 }}>Updating spending authorization…</Typography>
            </Box>
          ) : (
            <>
              <Typography variant="h2" gutterBottom>
                Monthly spending limit:{' '}
                <AmountDisplay showFiatAsInteger>
                  {authorization.authorizedAmount}
                </AmountDisplay>
              </Typography>

              {/* Current monthly spending limit section */}
              <Box mb={3}>
                <Box display="flex" alignItems="center" gap={2}>
                  <TextField
                  value={isEditingLimit ? tempLimit : ''}
                  onChange={(e) => {
                    if (!isEditingLimit) {
                      setIsEditingLimit(true);
                      setOriginalLimit('');           // baseline for cancel check
                    }
                    setTempLimit(e.target.value);     // don't prefill with current limit
                  }}
                  onFocus={() => {
                    if (!isEditingLimit) {
                      setIsEditingLimit(true);
                      setTempLimit('');               // leave empty on focus
                      setOriginalLimit('');           // so blur-without-change cancels cleanly
                    }
                  }}
                  onBlur={() => { 
                    if (isEditingLimit && tempLimit === originalLimit) {
                      // user didn’t type anything — cancel edit & reset
                      setIsEditingLimit(false);
                      setTempLimit('');
                      setOriginalLimit('');
                    }
                  }}
                  placeholder={
                    isEditingLimit
                      ? ''
                      : `Enter new limit in ${unit.kind === 'sats' ? 'sats' : unit.kind === 'bsv' ? 'BSV' : unit.code}`
                  }
                  size="small"
                  type={isEditingLimit ? 'number' : 'text'}
                  inputProps={isEditingLimit ? { min: 0, step: inputStep } : undefined}
                  InputProps={
                    isEditingLimit
                      ? { startAdornment: <InputAdornment position="start">
                          {unit.kind === 'sats' ? 'sats' : unit.kind === 'bsv' ? 'BSV' : (unit.code === 'USD' ? '$' : unit.code === 'EUR' ? '€' : '£')}
                        </InputAdornment> }
                      : undefined
                  }
                  sx={{
                    width: 220,
                    '& input': { cursor: isEditingLimit ? 'text' : 'pointer' },
                    '& input[type=number]': { MozAppearance: 'textfield' },
                    '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
                    '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 }
                  }}
                />
                  {isEditingLimit && tempLimit !== originalLimit && (
                    <Button
                      onClick={() => { updateSpendingAuthorization(authorization!) }}
                      disabled={busy.renewLimit || !tempLimit || (unit.kind === 'fiat' && !fiatRatesReady)}
                      size="small"
                      variant="contained"
                      sx={{
                        boxShadow: 3,
                        '&:hover': { boxShadow: 6 },
                        '&:active': { boxShadow: 1 }
                      }}
                    >
                      {busy.renewLimit ? (<><CircularProgress size={16} sx={{ mr: 1 }} />Updating…</>) : 'Submit'}
                    </Button>
                  )}
                </Box>
              </Box>

              {/* Current spending progress section */}
              <Box>
                <Typography variant="body1" gutterBottom>Current spending</Typography>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(((currentSpending * -1) / authorization.authorizedAmount) * 100, 100)}
                  sx={{ height: 8, borderRadius: 4, mb: 1 }}
                />
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    <AmountDisplay showFiatAsInteger>{currentSpending * -1}</AmountDisplay> spent
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    <AmountDisplay showFiatAsInteger>{authorization.authorizedAmount}</AmountDisplay> limit
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
            </>
          )}
        </Box>
      ) : (
        /* unauthorised state -------------------------------------------------- */
        <Box textAlign="center" pt={6}>
          {busy.waitingForAuth ? (
            <>
              <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={50} /></Box>
              <Typography variant="body1" sx={{ mt: 2 }}>Setting up spending authorization…</Typography>
            </>
          ) : (
            <>
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
                  placeholder={inputPlaceholder}
                  size="small"
                  type="number"
                  inputProps={{ min: 0, step: inputStep }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">{adornmentLabel}</InputAdornment>
                  }}
                  sx={{
                    width: 220,
                    '& input[type=number]': { MozAppearance: 'textfield' },
                    '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
                    '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 }
                  }}
                />
                {tempLimit && (
                  <Button
                    onClick={() => createSpendingAuthorization(parseFloat(tempLimit))}
                    disabled={busy.create || busy.waitingForAuth || !tempLimit || (unit.kind === 'fiat' && !fiatRatesReady)}
                    size="small"
                  >
                    {busy.create ? (<><CircularProgress size={16} sx={{ mr: 1 }} />Creating…</>) : 'Submit'}
                  </Button>
                )}
              </Box>
            </>
          )}
        </Box>
      )}
    </>
  );
};

export default SpendingAuthorizationList;
