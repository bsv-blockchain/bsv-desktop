import React, { useContext, useEffect, useState } from 'react';
import {
  Typography,
  Box,
  Tabs,
  Tab,
  Grid,
  IconButton,
  CircularProgress,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useHistory, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import PageHeader from '../../../components/PageHeader'; // Assuming this component exists and is TSX
import CounterpartyChip from '../../../components/CounterpartyChip'; // Assuming this component exists and is TSX
// import ProtocolPermissionList from '../../../components/ProtocolPermissionList'; // Needs migration/creation
// import CertificateAccessList from '../../../components/CertificateAccessList'; // Needs migration/creation
import { WalletContext } from '../../../WalletContext';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import ProtocolPermissionList from '../../../components/ProtocolPermissionList';
import { DisplayableIdentity, IdentityClient } from '@bsv/sdk';

// Props for TabPanel component
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = (props) => {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

// Props for SimpleTabs component
interface SimpleTabsProps {
  counterparty: string;
  trustEndorsements: DisplayableIdentity[];
}

const SimpleTabs: React.FC<SimpleTabsProps> = ({ counterparty, trustEndorsements }) => {
  const [value, setValue] = useState(0);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  return (
    <Box>
      <Tabs value={value} onChange={handleChange} aria-label="counterparty info tabs">
        <Tab label="Trust Endorsements" />
        <Tab label="Protocol Access" />
        <Tab label="Certificates Revealed" />
      </Tabs>
      <TabPanel value={value} index={0}>
        <Typography variant="body1" sx={{ mb: 2 }}>
          Trust endorsements given to this counterparty by other people.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {trustEndorsements.length > 0 ? (
            trustEndorsements.map((endorsement, index) => (
              <CounterpartyChip
                counterparty={endorsement.identityKey}
                key={index}
                clickable
              />
            ))
          ) : (
            <Typography color="textSecondary">No trust endorsements found.</Typography>
          )}
        </Box>
      </TabPanel>
      <TabPanel value={value} index={1}>
        <Typography variant="body1" sx={{ mb: 2 }}>
          Apps that can be used within specific protocols to interact with this counterparty.
        </Typography>
        <Box sx={{ p: 4 }}>
          <ProtocolPermissionList counterparty={counterparty} itemsDisplayed='protocols' showEmptyList canRevoke />
        </Box>
      </TabPanel>
      <TabPanel value={value} index={2}>
        <Typography variant="body1" sx={{ mb: 2 }}>
          The certificate fields that you have revealed to this counterparty within specific apps.
        </Typography>
        {/* --- CertificateAccessList Placeholder --- */}
        <Box sx={{ mt: 1, p: 2, border: '1px dashed grey', borderRadius: 1, textAlign: 'center' }}>
          <Typography color="textSecondary">CertificateAccessList component needs to be created/refactored.</Typography>
          {/* <CertificateAccessList counterparty={counterparty} itemsDisplayed='apps' canRevoke /> */}
        </Box>
        {/* --- End Placeholder --- */}
      </TabPanel>
    </Box>
  );
}

/**
 * Displays details about a specific counterparty, including identity, trust, and permissions.
 */
const CounterpartyAccess: React.FC = () => {
  const { counterparty } = useParams<{ counterparty: string }>();
  const history = useHistory();
  const { managers, adminOriginator } = useContext(WalletContext);

  const [identity, setIdentity] = useState<DisplayableIdentity | null>(null);
  const [trustEndorsements, setTrustEndorsements] = useState<DisplayableIdentity[]>([]);
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({ id: false });
  const [loadingIdentity, setLoadingIdentity] = useState<boolean>(true);
  const [loadingTrust, setLoadingTrust] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const identityClient = new IdentityClient(managers.permissionsManager, undefined, adminOriginator)

  const handleCopy = (data: string, type: string) => {
    navigator.clipboard.writeText(data);
    setCopied(prev => ({ ...prev, [type]: true }));
    setTimeout(() => {
      setCopied(prev => ({ ...prev, [type]: false }));
    }, 2000);
  };

  // Fetch Identity
  useEffect(() => {
    const fetchIdentity = async () => {
      if (!managers.permissionsManager) return;

      setLoadingIdentity(true);
      setError(null);
      try {
        const results = await identityClient.resolveByIdentityKey({
          identityKey: counterparty,
        })

        setTrustEndorsements(results)

        const identity = results[0]

        if (!identity) {
          setIdentity({
            name: `Counterparty ${counterparty.substring(0, 6)}...`,
            avatarURL: DEFAULT_APP_ICON, // Use a default avatar
            abbreviatedKey: counterparty,
            identityKey: counterparty,
            badgeIconURL: DEFAULT_APP_ICON,
            badgeLabel: 'Counterparty',
            badgeClickURL: '',
          });
        }

        setIdentity(identity);

      } catch (err: any) {
        console.error('Failed to fetch counterparty identity:', err);
        setError(prev => prev ? `${prev}; Failed to load identity: ${err.message}` : `Failed to load identity: ${err.message}`);
        toast.error(`Failed to load identity: ${err.message}`);
        setIdentity({
          name: 'Unknown Counterparty',
          avatarURL: DEFAULT_APP_ICON,
          abbreviatedKey: counterparty,
          identityKey: counterparty,
          badgeIconURL: DEFAULT_APP_ICON,
          badgeLabel: 'Counterparty',
          badgeClickURL: '',
        }); // Set default on error
      } finally {
        setLoadingIdentity(false);
      }
    };

    fetchIdentity();
  }, [counterparty, managers.walletManager]);

  // Fetch Trust Endorsements
  useEffect(() => {
    const fetchTrust = async () => {
      // TODO: Replace Signia discoverByIdentityKey with WalletContext/SDK equivalent
      // This might involve managers.trustManager or lookupManager.
      identityClient.resolveByIdentityKey({ identityKey: counterparty })
      if (!managers.walletManager) return; // Or relevant manager

      setLoadingTrust(true);
      // Don't reset global error here, identity might have failed
      try {
        console.warn('Trust endorsement fetching logic needs implementation using WalletContext/SDK.');
        // Placeholder logic:
        const placeholderTrust: DisplayableIdentity[] = []; // Assume empty for now
        setTrustEndorsements(placeholderTrust);

      } catch (err: any) {
        console.error('Failed to fetch trust endorsements:', err);
        setError(prev => prev ? `${prev}; Failed to load trust: ${err.message}` : `Failed to load trust: ${err.message}`);
        toast.error(`Failed to load trust endorsements: ${err.message}`);
      } finally {
        setLoadingTrust(false);
      }
    };

    fetchTrust();
  }, [counterparty, managers.walletManager]); // TODO: Re-evaluate dependency on trusted entities

  const isLoading = loadingIdentity || loadingTrust;

  return (
    <Grid container spacing={3} direction="column" sx={{ p: 2 }}>
      <Grid item>
        <PageHeader
          history={history}
          title={isLoading ? 'Loading...' : (identity?.name || 'Unknown Counterparty')}
          subheading={
            <Box>
              <Typography variant="caption" color="textSecondary" sx={{ display: 'flex', alignItems: 'center' }}>
                Public Key: <Typography variant="caption" fontWeight="bold" sx={{ ml: 0.5, wordBreak: 'break-all' }}>{counterparty}</Typography>
                <IconButton size="small" onClick={() => handleCopy(counterparty, 'id')} disabled={copied.id} sx={{ ml: 0.5 }}>
                  {copied.id ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                </IconButton>
              </Typography>
            </Box>
          }
          icon={isLoading ? undefined : (identity?.avatarURL || DEFAULT_APP_ICON)} // Show icon only when loaded
          showButton={false}
          buttonTitle="" // Added dummy prop
          onClick={() => { }} // Added dummy prop
        />
      </Grid>
      <Grid item>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
        ) : error ? (
          <Typography color="error" sx={{ p: 2 }}>{error}</Typography>
        ) : (
          <SimpleTabs counterparty={counterparty} trustEndorsements={trustEndorsements} />
        )}
      </Grid>
    </Grid>
  );
};

export default CounterpartyAccess;

