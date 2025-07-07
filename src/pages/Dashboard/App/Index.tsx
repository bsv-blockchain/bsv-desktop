/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { IconButton, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { useLocation } from 'react-router-dom';
import { WalletContext } from '../../../WalletContext';
import { WalletAction } from '@bsv/sdk';

import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import PageHeader from '../../../components/PageHeader';
import RecentActions from '../../../components/RecentActions';
import fetchAndCacheAppData from '../../../utils/fetchAndCacheAppData';
import AccessAtAGlance from '../../../components/AccessAtAGlance';

// Extended interface for transformed wallet actions
interface TransformedWalletAction extends WalletAction {
  amount: number;
  fees?: number;
}

// Optimized transform function
function transformActions(actions: WalletAction[]): TransformedWalletAction[] {
  return actions.map((action) => {
    const inputs = action.inputs ?? [];
    const outputs = action.outputs ?? [];

    // Calculate total input and output amounts
    const totalInputAmount = inputs.reduce((sum, input) => sum + Number(input.sourceSatoshis), 0);
    const totalOutputAmount = outputs.reduce((sum, output) => sum + Number(output.satoshis), 0);

    // Calculate fees
    const fees = totalInputAmount - totalOutputAmount;

    // Always show the total output amount as the main amount
    const amount = action.satoshis;

    return {
      ...action,
      amount,
      inputs,
      outputs,
      fees: fees > 0 ? fees : undefined,
    };
  });
}

interface LocationState {
  domain?: string;
  appName?: string;
  iconImageUrl?: string;
}

interface AppsProps {
  history?: any; // or ReactRouter history type
}

const Apps: React.FC<AppsProps> = ({ history }) => {
  const location = useLocation<LocationState>();
  const appDomain = location.state?.domain ?? 'unknown-domain.com';
  const passedAppName = location.state?.appName;
  const passedIconUrl = location.state?.iconImageUrl;

  const [appName, setAppName] = useState<string>(passedAppName || appDomain);
  const [appIcon, setAppIcon] = useState<string>(passedIconUrl || DEFAULT_APP_ICON);
  // Retain displayLimit for UI, though pagination now loads fixed sets of 10.
  const [displayLimit, setDisplayLimit] = useState<number>(5);
  const [loading, setLoading] = useState<boolean>(false);
  const [refresh, setRefresh] = useState<boolean>(false);
  const [allActionsShown, setAllActionsShown] = useState<boolean>(true);

  const [copied, setCopied] = useState<{ id: boolean; registryOperator?: boolean }>({
    id: false,
  });

  // Store fetched actions here.
  const [appActions, setAppActions] = useState<TransformedWalletAction[]>([]);
  // New state for pagination – page 0 returns the most recent 10 actions.
  const [page, setPage] = useState<number>(0);
  // Add state for progressive loading
  const [totalActions, setTotalActions] = useState<number>(0);
  const [actionsLoaded, setActionsLoaded] = useState<boolean>(false);

  // Grab managers and adminOriginator from Wallet Context
  const { managers, adminOriginator } = useContext(WalletContext);

  // Copy handler for UI
  const handleCopy = (data: string, type: 'id' | 'registryOperator') => {
    navigator.clipboard.writeText(data);
    setCopied((prev) => ({ ...prev, [type]: true }));
    setTimeout(() => setCopied((prev) => ({ ...prev, [type]: false })), 2000);
  };

  // Memoized cache key to avoid recalculation
  const cacheKey = useMemo(() => `transactions_${appDomain}`, [appDomain]);

  // Load cached data immediately (non-blocking)
  useEffect(() => {
    const cachedData = window.localStorage.getItem(cacheKey);
    if (cachedData) {
      try {
        const cachedParsed = JSON.parse(cachedData) as {
          totalTransactions: number;
          transactions: WalletAction[];
        };
        const transformedCached = transformActions(cachedParsed.transactions);
        setAppActions(transformedCached);
        setTotalActions(cachedParsed.totalTransactions);
        setActionsLoaded(true);
      } catch (e) {
        console.error('Error parsing cached data:', e);
      }
    }
  }, [cacheKey]);

  // Async function to load actions progressively
  const loadActions = useCallback(async () => {
    if (!managers?.permissionsManager || !adminOriginator) return;

    try {
      setLoading(true);

      // Only fetch app data if not already provided from previous page
      if (!passedAppName || !passedIconUrl) {
        fetchAndCacheAppData(appDomain, setAppIcon, setAppName, DEFAULT_APP_ICON);
      }

      // Step 1: Get total count (lightweight request)
      const { totalActions: fetchedTotal } = await managers.permissionsManager.listActions(
        {
          labels: [`admin originator ${appDomain}`],
          labelQueryMode: 'any',
          includeLabels: false,
          limit: 1,
        },
        adminOriginator
      );

      setTotalActions(fetchedTotal);

      // Step 2: Fetch actual actions in background
      const limit = 10;
      const offset = Math.max(fetchedTotal - (page + 1) * limit, 0);

      // Use setTimeout to yield control back to the main thread
      setTimeout(async () => {
        try {
          const actionsResponse = await managers.permissionsManager.listActions(
            {
              labels: [`admin originator ${appDomain}`],
              labelQueryMode: 'any',
              includeLabels: true,
              includeInputs: true,
              includeOutputs: true,
              limit,
              offset,
            },
            adminOriginator
          );

          // Transform actions in chunks to avoid blocking
          const chunkSize = 5;
          const actions = actionsResponse.actions;
          let transformedActions: TransformedWalletAction[] = [];

          for (let i = 0; i < actions.length; i += chunkSize) {
            const chunk = actions.slice(i, i + chunkSize);
            const transformedChunk = transformActions(chunk);
            transformedActions = [...transformedActions, ...transformedChunk];
            
            // Yield control after each chunk
            if (i + chunkSize < actions.length) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }

          // Reverse for most recent first
          const pageActions = transformedActions.reverse();

          // Update state
          if (page === 0) {
            setAppActions(pageActions);
          } else {
            setAppActions((prev) => [...prev, ...pageActions]);
          }

          setAllActionsShown(offset === 0);
          setActionsLoaded(true);

          // Cache only the most recent page
          if (page === 0) {
            window.localStorage.setItem(
              cacheKey,
              JSON.stringify({
                totalTransactions: fetchedTotal,
                transactions: pageActions,
              })
            );
          }
        } catch (e) {
          console.error('Error fetching actions:', e);
        } finally {
          setLoading(false);
        }
      }, 0);
    } catch (e) {
      console.error('Error getting total actions:', e);
      setLoading(false);
    } finally {
      setRefresh(false);
    }
  }, [refresh, appDomain, managers?.permissionsManager, adminOriginator, page, cacheKey, passedAppName, passedIconUrl]);

  // Load actions when dependencies change
  useEffect(() => {
    loadActions();
  }, [loadActions]);

  const recentActionParams = {
    loading,
    appActions,
    displayLimit,
    setDisplayLimit,
    setRefresh,
    allActionsShown,
  };

  const url = (appDomain.startsWith('http') ? appDomain : `https://${appDomain}`)

  return (
    <Grid
      container
      spacing={3}
      direction="column"
      sx={{
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden'
      }}
    >
      {/* Page Header */}
      <Grid item xs={12}>
        <PageHeader
          history={history}
          title={appName}
          subheading={
            <div>
              <Typography variant="caption" color="textSecondary">
                {url}
                <IconButton
                  size="small"
                  onClick={() => handleCopy(url, 'id')}
                  disabled={copied.id}
                >
                  {copied.id ? <CheckIcon /> : <ContentCopyIcon fontSize="small" />}
                </IconButton>
              </Typography>
            </div>
          }
          icon={appIcon}
          buttonTitle="Launch"
          buttonIcon={<OpenInNewIcon />}
          onClick={() => {
            window.open(url, '_blank', 'noopener,noreferrer')
          }}
        />
      </Grid>

      {/* Main Content: RecentActions + AccessAtAGlance */}
      <Grid
        item
        xs={12}
      >
        <Grid
          container
          spacing={3}
          sx={{
            width: '100%',
            maxWidth: '100%',
            overflow: 'hidden',
            justifyItems: 'start'
          }}
        >
          {/* RecentActions Section */}
          <Grid item lg={6} md={6} xs={12}>
            <RecentActions
              appActions={appActions}
              displayLimit={displayLimit}
              setDisplayLimit={setDisplayLimit}
              loading={loading}
              setRefresh={setRefresh}
            />
          </Grid>
          {/* AccessAtAGlance Section */}
          <Grid item lg={6} md={6} xs={12}>
            <AccessAtAGlance
              originator={appDomain}
              loading={loading}
              setRefresh={setRefresh}
              history={history}
            />
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  );
};

export default Apps;
