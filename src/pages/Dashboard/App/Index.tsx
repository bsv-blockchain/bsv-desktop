/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState, useEffect, useContext } from 'react';
import { IconButton, Typography } from '@mui/material';
import Grid from '@mui/material/Grid2';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { openUrl } from '@tauri-apps/plugin-opener';

import { useLocation } from 'react-router-dom';
import { WalletContext } from '../../../WalletContext';
import { WalletAction } from '@bsv/sdk';

import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import PageHeader from '../../../components/PageHeader';
import RecentActions from '../../../components/RecentActions';
import fetchAndCacheAppData from '../../../utils/fetchAndCacheAppData';
// import AccessAtAGlance from '../../../components/AccessAtAGlance';

// Extended interface for transformed wallet actions
interface TransformedWalletAction extends WalletAction {
  amount: number;
  fees?: number;
}

// Transform function now returns TransformedWalletAction[]
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
}

interface AppsProps {
  history?: any; // or ReactRouter history type
}

const Apps: React.FC<AppsProps> = ({ history }) => {
  const location = useLocation<LocationState>();
  const appDomain = location.state?.domain ?? 'unknown-domain.com';

  const [appName, setAppName] = useState<string>(appDomain);
  const [appIcon, setAppIcon] = useState<string>(DEFAULT_APP_ICON);
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

  // Grab managers and adminOriginator from Wallet Context
  const { managers, adminOriginator } = useContext(WalletContext);

  // Copy handler for UI
  const handleCopy = (data: string, type: 'id' | 'registryOperator') => {
    navigator.clipboard.writeText(data);
    setCopied((prev) => ({ ...prev, [type]: true }));
    setTimeout(() => setCopied((prev) => ({ ...prev, [type]: false })), 2000);
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // Optionally fetch app icon & name from your helper
        fetchAndCacheAppData(appDomain, setAppIcon, setAppName, DEFAULT_APP_ICON);

        // Check for local cache (retain existing logic)
        const cacheKey = `transactions_${appDomain}`;
        const cachedData = window.localStorage.getItem(cacheKey);
        if (cachedData) {
          const cachedParsed = JSON.parse(cachedData) as {
            totalTransactions: number;
            transactions: WalletAction[];
          };
          const transformedCached = transformActions(cachedParsed.transactions);
          setAppActions(transformedCached);
          // (Optionally you could return early if caching is sufficient)
        }

        // Retrieve the total count of actions first
        const { totalActions } = await managers.permissionsManager.listActions(
          {
            labels: [`admin originator ${appDomain}`],
            labelQueryMode: 'any',
            includeLabels: false,
            limit: 1,
          },
          adminOriginator
        );

        // Use a fixed limit of 10 actions per page
        const limit = 10;
        // Calculate offset so that page 0 fetches the last 10 (most recent) actions.
        // For page n, offset = totalCount - (n + 1) * limit (not going below 0).
        const offset = Math.max(totalActions - (page + 1) * limit, 0);

        // Now fetch the actions for the current page.
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

        // Transform the actions
        let pageActions = transformActions(actionsResponse.actions);
        // Reverse if API returns ascending order, so most recent appears first.
        pageActions = pageActions.reverse();

        // Update state: for the first page replace; for later pages append.
        if (page === 0) {
          setAppActions(pageActions);
        } else {
          setAppActions((prev) => [...prev, ...pageActions]);
        }

        // If offset is 0, then we've reached the beginning of the list.
        setAllActionsShown(offset === 0);

        // Only update local cache when on page 0 to store just the 10 most recent transactions
        if (page === 0) {
          window.localStorage.setItem(
            cacheKey,
            JSON.stringify({
              totalTransactions: totalActions,
              transactions: pageActions,
            })
          );
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
        setRefresh(false);
      }
    })();
  }, [refresh, appDomain, displayLimit, managers.permissionsManager, adminOriginator, page]);

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
    <Grid container spacing={3} direction="column">
      {/* Page Header */}
      <Grid sx={{ xs: 12 }}>
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
          onClick={() => {
            openUrl(url)
          }}
        />
      </Grid>

      {/* Main Content: RecentActions + AccessAtAGlance */}
      <Grid container spacing={3} direction="row">
        {/* RecentActions Section */}
        <Grid sx={{ lg: 6, md: 6, xs: 12 }}>
          <RecentActions
            appActions={appActions}
            displayLimit={displayLimit}
            setDisplayLimit={setDisplayLimit}
            loading={loading}
            setRefresh={setRefresh}
          />
        </Grid>
      </Grid>
    </Grid>
  );
};

export default Apps;
