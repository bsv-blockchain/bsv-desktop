import React, { useState, useEffect, useContext } from 'react';
import { Typography, IconButton, Grid, Tab, Tabs, Box, CircularProgress, Button } from '@mui/material';
import { useHistory, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LaunchIcon from '@mui/icons-material/Launch';
import { DEFAULT_APP_ICON } from '../../../constants/popularApps';
import PageHeader from '../../../components/PageHeader'; // Assuming this component exists and is TSX
// import ProtocolPermissionList from '../../../components/ProtocolPermissionList'; // Needs migration/creation
// import SpendingAuthorizationList from '../../../components/SpendingAuthorizationList'; // Needs migration/creation
// import BasketAccessList from '../../../components/BasketAccessList'; // Needs migration/creation
// import CertificateAccessList from '../../../components/CertificateAccessList'; // Needs migration/creation
import { WalletContext } from '../../../WalletContext';
import BasketAccessList from '../../../components/BasketAccessList';
import SpendingAuthorizationList from '../../../components/SpendingAuthorizationList';

// Placeholder type for App Data - adjust based on actual SDK response
interface AppData {
  name: string;
  iconURL?: string;
  domain: string;
  // Add other relevant properties
}

/**
 * Displays and manages access permissions for a specific app.
 */
const AppAccess: React.FC = () => {
  const { originator: encodedOriginator } = useParams<{ originator: string }>();
  const originator = decodeURIComponent(encodedOriginator);
  const history = useHistory();
  const { managers } = useContext(WalletContext);

  // State for tab management
  const [tabValue, setTabValue] = useState<string>(
    // @ts-ignore - history might have custom property
    history.appAccessTab ? history.appAccessTab : '0'
  );

  // State for app data
  const [appData, setAppData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({ id: false });

  // Copies the data and timeouts the checkmark icon
  const handleCopy = (data: string, type: string) => {
    navigator.clipboard.writeText(data);
    setCopied(prev => ({ ...prev, [type]: true }));
    setTimeout(() => {
      setCopied(prev => ({ ...prev, [type]: false }));
    }, 2000);
  };

  // Handle tab change
  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
    // @ts-ignore - history might have custom property
    history.appAccessTab = newValue;
  };

  // Launch app in new tab
  const handleLaunchApp = () => {
    if (!appData) return;
    const url = appData.domain.startsWith('http') ? appData.domain : `https://${appData.domain}`;
    window.open(url, '_blank');
  };

  useEffect(() => {
    const fetchAppData = async () => {
      // TODO: Replace fetchAndCacheAppData with WalletContext/SDK equivalent
      // This might involve managers.appManager or lookupManager.
      if (!managers.permissionsManager) return; // Or relevant manager

      setLoading(true);
      setError(null);
      try {
        console.warn('App data fetching logic needs implementation using WalletContext/SDK.');
        // Placeholder logic:
        const domain = originator;
        const url = domain.startsWith('http') ? domain : `https://${domain}`;

        const placeholderAppData: AppData = {
          name: domain.includes('.') ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1) : domain,
          iconURL: DEFAULT_APP_ICON,
          domain: domain
        };
        setAppData(placeholderAppData);

      } catch (err: any) {
        console.error('Failed to fetch app data:', err);
        setError(`Failed to load app data: ${err.message}`);
        toast.error(`Failed to load app data: ${err.message}`);
        // Set default data on error
        setAppData({
          name: 'Unknown App',
          iconURL: DEFAULT_APP_ICON,
          domain: originator
        });
      } finally {
        setLoading(false);
      }
    };

    fetchAppData();

    // Cleanup
    return () => {
      // @ts-ignore - history might have custom property
      history.appAccessTab = undefined;
    };
  }, [originator, managers.permissionsManager, history]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Typography color="error" sx={{ p: 2 }}>{error}</Typography>;
  }

  if (!appData) {
    return <Typography sx={{ p: 2 }}>App data not found for: {originator}</Typography>;
  }

  const url = appData.domain.startsWith('http') ? appData.domain : `https://${appData.domain}`;

  return (
    <Box>
      <Grid container spacing={3} direction='column' sx={{ p: 2 }}>
        <Grid item>
          <PageHeader
            history={history}
            title={appData.name}
            subheading={
              <Box>
                <Typography variant='caption' color='textSecondary' sx={{ display: 'flex', alignItems: 'center' }}>
                  {url}
                  <IconButton size='small' onClick={() => handleCopy(url, 'id')} disabled={copied.id} sx={{ ml: 0.5 }}>
                    {copied.id ? <CheckIcon fontSize='small' /> : <ContentCopyIcon fontSize='small' />}
                  </IconButton>
                </Typography>
              </Box>
            }
            icon={appData.iconURL || DEFAULT_APP_ICON}
            buttonTitle='Launch'
            buttonIcon={<LaunchIcon />}
            onClick={handleLaunchApp}
          />
        </Grid>
        <Grid item>
          <Typography variant='body1' gutterBottom>
            You have the power to decide what each app can do, whether it's using certain tools (protocols), accessing specific bits of your data (baskets), verifying your identity (certificates), or spending amounts.
          </Typography>
        </Grid>
      </Grid>

      <Tabs
        value={tabValue}
        onChange={handleTabChange}
        indicatorColor='primary'
        textColor='primary'
        variant='fullWidth'
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label='Protocols' value='0' />
        <Tab label='Spending' value='1' />
        <Tab label='Baskets' value='2' />
        <Tab label='Certificates' value='3' />
      </Tabs>

      {tabValue === '0' && (
        <Box sx={{ p: 2 }}>
          {/* --- ProtocolPermissionList Placeholder --- */}
          <Box sx={{ mt: 1, p: 2, border: '1px dashed grey', borderRadius: 1, textAlign: 'center' }}>
            <Typography color="textSecondary">ProtocolPermissionList component needs to be created/refactored.</Typography>
            {/* <ProtocolPermissionList
              app={url}
              canRevoke
              showEmptyList
            /> */}
          </Box>
          {/* --- End Placeholder --- */}
        </Box>
      )}

      {tabValue === '1' && (
        <Box sx={{ p: 2 }}>
          {/* --- SpendingAuthorizationList Placeholder --- */}
          {/* <Box sx={{ mt: 1, p: 2, border: '1px dashed grey', borderRadius: 1, textAlign: 'center' }}> */}
          <SpendingAuthorizationList
            app={appData.domain}
          />
          {/* </Box> */}
          {/* --- End Placeholder --- */}
        </Box>
      )}

      {tabValue === '2' && (
        <Box sx={{ p: 4 }}>
          <BasketAccessList
            app={appData.domain}
            itemsDisplayed='baskets'
            showEmptyList
            canRevoke
          />
        </Box>
      )
      }

      {
        tabValue === '3' && (
          <Box sx={{ p: 2 }}>
            {/* --- CertificateAccessList Placeholder --- */}
            <Box sx={{ mt: 1, p: 2, border: '1px dashed grey', borderRadius: 1, textAlign: 'center' }}>
              <Typography color="textSecondary">CertificateAccessList component needs to be created/refactored.</Typography>
              {/* <CertificateAccessList
              app={appData.domain}
              canRevoke
              showEmptyList
            /> */}
            </Box>
            {/* --- End Placeholder --- */}
          </Box>
        )
      }
    </Box >
  );
};

export default AppAccess;
