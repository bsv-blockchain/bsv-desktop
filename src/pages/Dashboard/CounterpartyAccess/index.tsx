import React, { useContext, useEffect, useState } from 'react';
import {
  Typography,
  Box,
  Tabs,
  Tab,
  Grid,
  IconButton,
  CircularProgress,
  Link as MuiLink
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
import { UserContext } from '../../../UserContext';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';

// Placeholder type for Counterparty Identity - adjust based on actual SDK response
interface CounterpartyIdentity {
  name: string;
  avatarURL?: string;
  // Add other relevant properties from identity resolution
}

// Placeholder type for Trust Endorsement - adjust based on actual SDK response
interface TrustEndorsement {
  certifier: string; // Public key of the certifier
  // Add other relevant properties from discovery/Signia equivalent
}

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
  trustEndorsements: TrustEndorsement[];
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
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}> {/* Use flexbox for chips */} 
          {trustEndorsements.length > 0 ? (
            trustEndorsements.map((endorsement, index) => (
              <CounterpartyChip
                counterparty={endorsement.certifier}
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
        {/* --- ProtocolPermissionList Placeholder --- */}
        <Box sx={{ mt: 1, p: 2, border: '1px dashed grey', borderRadius: 1, textAlign: 'center' }}>
          <Typography color="textSecondary">ProtocolPermissionList component needs to be created/refactored.</Typography>
          {/* <ProtocolPermissionList counterparty={counterparty} itemsDisplayed='protocols' showEmptyList canRevoke /> */}
        </Box>
        {/* --- End Placeholder --- */}
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
  const { managers, settings } = useContext(WalletContext);

  const [identity, setIdentity] = useState<CounterpartyIdentity | null>(null);
  const [trustEndorsements, setTrustEndorsements] = useState<TrustEndorsement[]>([]);
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({ id: false });
  const [loadingIdentity, setLoadingIdentity] = useState<boolean>(true);
  const [loadingTrust, setLoadingTrust] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
      // TODO: Replace discoverByIdentityKey with WalletContext/SDK equivalent
      // This likely involves managers.lookupManager or similar.
      if (!managers.walletManager) return; // Or relevant manager

      setLoadingIdentity(true);
      setError(null);
      try {
        console.warn('Counterparty identity fetching logic needs implementation using WalletContext/SDK.');
        // Placeholder logic:
        const placeholderIdentity: CounterpartyIdentity = {
          name: `Counterparty ${counterparty.substring(0, 6)}...`,
          avatarURL: DEFAULT_APP_ICON, // Use a default avatar
        };
        setIdentity(placeholderIdentity);

      } catch (err: any) {
        console.error('Failed to fetch counterparty identity:', err);
        setError(prev => prev ? `${prev}; Failed to load identity: ${err.message}` : `Failed to load identity: ${err.message}`);
        toast.error(`Failed to load identity: ${err.message}`);
        setIdentity({ name: 'Unknown Counterparty', avatarURL: DEFAULT_APP_ICON }); // Set default on error
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
      if (!managers.walletManager) return; // Or relevant manager

      setLoadingTrust(true);
      // Don't reset global error here, identity might have failed
      try {
        console.warn('Trust endorsement fetching logic needs implementation using WalletContext/SDK.');
        // Placeholder logic:
        const placeholderTrust: TrustEndorsement[] = []; // Assume empty for now
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
          onClick={() => {}} // Added dummy prop
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

