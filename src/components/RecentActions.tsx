import { FC } from 'react';
import { Typography, Button, LinearProgress, Box } from '@mui/material';
import Action from './Action';
import { WalletAction } from '@bsv/sdk';
import PageLoading from './PageLoading';
import AppLogo from './AppLogo';

// Import the TransformedWalletAction interface
interface TransformedWalletAction extends WalletAction {
  amount: number;
  fees?: number;
}

interface RecentActionsProps {
  loading: boolean;
  appActions: TransformedWalletAction[];
  displayLimit: number;
  setDisplayLimit: (limit: number) => void;
  setRefresh: (refresh: boolean) => void;
  allActionsShown?: boolean;
}

const RecentActions: FC<RecentActionsProps> = ({
  loading,
  appActions,
  displayLimit,
  setDisplayLimit,
  setRefresh,
  allActionsShown = false,
}) => {
  return (
    <div style={{ paddingTop: '1em' }}>
      <Typography
        variant="h3"
        color="textPrimary"
        gutterBottom
        style={{ paddingBottom: '0.2em' }}
      >
        Recent Actions
      </Typography>
      {appActions ?
        appActions.map((action, index) => {
          const actionToDisplay = {
            txid: action.txid,
            description: action.description,
            amount: action.amount.toString(),
            inputs: action.inputs,
            outputs: action.outputs,
            fees: action.fees?.toString()
          };
          return <Action key={index} {...actionToDisplay} />
        }) : !loading && (
          <Typography
              color="textSecondary"
              align="center"
              style={{ paddingTop: '6em' }}
            >
              You haven't made any actions yet.
            </Typography>
        )}
      {loading && <Box p={3} display="flex" justifyContent="center" alignItems="center"><AppLogo rotate size={100} /></Box>}
      {appActions && appActions.length !== 0 && (
        <center style={{ paddingTop: '1em' }}>
          {allActionsShown ? (
            <></>
          ) : (
            <Button
              onClick={() => {
                // Note: Consider taking into account max number of transactions available
                setDisplayLimit(displayLimit + 10);
                setRefresh(true);
              }}
            >
              View More Actions
            </Button>
          )}
        </center>
      )}
    </div>
  );
};

export default RecentActions;
