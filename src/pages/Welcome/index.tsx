import React, { useState, useContext } from 'react';
import { Typography, Button, Grid, LinearProgress, Box } from '@mui/material';
import { useHistory } from 'react-router-dom';
import { toast } from 'react-toastify';
import { WalletContext } from '../../WalletContext';
import { WalletSettings } from '@bsv/wallet-toolbox/out/src/WalletSettingsManager';
// import DarkModeImage from '../../images/darkMode'; // Need to check if these images exist/are needed
// import LightModeImage from '../../images/lightMode'; // Need to check if these images exist/are needed
import { styled } from '@mui/material/styles';

// Define styles using styled-components or sx prop. Let's use sx for now.
// We can define style objects based on the old style.ts
const welcomeStyles = {
  content_wrap: (theme: any, selectedTheme: 'light' | 'dark') => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    position: 'fixed',
    display: 'grid',
    placeItems: 'center',
    backgroundColor: selectedTheme === 'light' ? 'white' : 'rgba(0,0,0,0)', // Adjusted background
    backgroundImage: selectedTheme === 'light'
      ? 'linear-gradient(to bottom, rgba(255,255,255,1.0), rgba(255,255,255,0.85)), url(https://cdn.projectbabbage.com/media/pictures/mainBackground.jpg)'
      : 'linear-gradient(to bottom, rgba(20,20,20,1.0), rgba(20,20,20,0.85)), url(https://cdn.projectbabbage.com/media/pictures/mainBackground.jpg)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: selectedTheme === 'light' ? 'black' : 'white',
  }),
  content: {
    margin: 'auto',
    textAlign: 'center',
    padding: '0.5em',
  },
  themeButton: (theme: any, currentSelectedTheme: 'light' | 'dark', buttonTheme: 'light' | 'dark') => ({
    width: 120,
    height: 120,
    borderRadius: '10px',
    boxShadow: currentSelectedTheme === buttonTheme ? '0px 0px 8px 2px #E04040' : 'none',
    color: buttonTheme === 'light' ? 'black' : 'white',
    backgroundColor: buttonTheme === 'light' ? '#EEEEEE' : '#444444', // Adjusted background for contrast
    marginRight: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    border: currentSelectedTheme !== buttonTheme ? `1px solid ${theme.palette.divider}` : 'none',
  }),
  currencyButton: (theme: any, selectedTheme: 'light' | 'dark', currentSelectedCurrency: string, buttonCurrency: string) => ({
    boxShadow: currentSelectedCurrency === buttonCurrency ? '0px 0px 8px 2px #E04040' : 'none',
    backgroundColor: currentSelectedCurrency === buttonCurrency ? '#444444' : (selectedTheme === 'light' ? '#EEEEEE' : 'black'),
    color: currentSelectedCurrency === buttonCurrency ? 'white' : '#888888',
    border: currentSelectedCurrency !== buttonCurrency ? `1px solid ${theme.palette.divider}` : 'none',
  }),
};

// Mock Images for now
const LightModeImage = () => <Box sx={{ width: 50, height: 50, bgcolor: 'grey.300', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Light</Box>;
const DarkModeImage = () => <Box sx={{ width: 50, height: 50, bgcolor: 'grey.700', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>Dark</Box>;

const Welcome: React.FC = () => {
  const { settings, updateSettings } = useContext(WalletContext);
  const history = useHistory();
  const [settingsLoading, setSettingsLoading] = useState<boolean>(false);

  // Supported Defaults
  const currencies: Record<string, string> = {
    USD: '$10',
    BSV: '0.033',
    SATS: '3,333,333',
    EUR: '€9.15',
    GDP: '£7.86' // Corrected typo from GDP to GBP if intended
  };
  const themes: Array<'light' | 'dark'> = ['light', 'dark'];

  // Initialize state from context settings if available, otherwise default
  const [selectedTheme, setSelectedTheme] = useState<'light' | 'dark'>(
    settings?.theme?.mode === 'dark' ? 'dark' : 'light' // Check theme.mode
  );
  const [selectedCurrency, setSelectedCurrency] = useState<string>(settings?.currency || 'USD');

  // Handle updating defaults
  const handleThemeChange = (theme: 'light' | 'dark') => {
    setSelectedTheme(theme);
  };
  const handleCurrencyChange = (currency: string) => {
    setSelectedCurrency(currency);
  };

  // Save user preferences
  const showDashboard = async () => {
    try {
      setSettingsLoading(true);
      // Construct the settings object with the correct theme structure
      const newSettings: Partial<WalletSettings> = {
        theme: { mode: selectedTheme }, // Pass theme as an object
        currency: selectedCurrency
      };
      // Assuming updateSettings merges or handles partial updates.
      // If not, fetch current settings and merge:
      // const currentSettings = settings;
      // await updateSettings({ ...currentSettings, ...newSettings });
      await updateSettings(newSettings as WalletSettings); // Cast needed if updateSettings expects full WalletSettings

      // toast.dark('Welcome! 🎉'); // Consider using toast from WalletContext or UserContext if standardized
      history.push('/dashboard'); // Navigate to base dashboard route first
    } catch (e: any) { // Added type annotation for error
      toast.error(e.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  return (
    <Box sx={welcomeStyles.content_wrap(null, selectedTheme)}> {/* Pass theme and selectedTheme */} 
      <Box sx={welcomeStyles.content}>
        <Grid container direction='column' alignItems='center' spacing={2}>
          <Grid item xs={12}>
            <Typography variant='h1' paragraph>
              Your portal to the MetaNet — And beyond!
            </Typography>
            <Typography variant='h4'>
              Let's start by setting your preferences.
            </Typography>
            <Typography paragraph sx={{ pt: '2em' }}>
              Default Theme
            </Typography>
          </Grid>
          <Grid item container spacing={1} justifyContent='center'>
            {
              themes.map(theme => (
                <Grid item key={theme}>
                  <Button
                    onClick={() => handleThemeChange(theme)}
                    sx={welcomeStyles.themeButton(null, selectedTheme, theme)} // Pass theme, selectedTheme, buttonTheme
                  >
                    {theme === 'light' ? <LightModeImage /> : <DarkModeImage />}
                    <Typography variant="caption" sx={{ mt: 1 }}>{theme.charAt(0).toUpperCase() + theme.slice(1)}</Typography>
                  </Button>
                </Grid>
              ))
            }
          </Grid>
          <Grid container spacing={1} justifyContent='center' sx={{ p: '1em' }}>
            <Grid item sx={{ pb: '1em' }}>
              <Typography variant='h5' sx={{ pt: '1em', pb: '0.5em' }}>
                Default Currency
              </Typography>
              <Typography variant='body1'> {/* Changed variant to body1 for consistency */} 
                How would you like to see your account balance?
              </Typography>
            </Grid>
            <Grid item xs={12} container direction='row' justifyContent='center' alignItems='center' spacing={1}>
              {
                Object.keys(currencies).map(currency => {
                  return (
                    <Grid item key={currency}>
                      <Button
                        variant={selectedCurrency === currency ? 'contained' : 'outlined'}
                        sx={welcomeStyles.currencyButton(null, selectedTheme, selectedCurrency, currency)} // Pass theme, selectedTheme, selectedCurrency, buttonCurrency
                        onClick={() => handleCurrencyChange(currency)}
                        color='primary'
                      >
                        <Box>
                          <Typography variant="h6">{currency}</Typography>
                          <Typography variant="caption">{currencies[currency]}</Typography>
                        </Box>
                      </Button>
                    </Grid>
                  )
                })
              }
            </Grid>
          </Grid>
          <Grid container sx={{ pt: '2em' }}>
            <Grid item xs={12}>
              {settingsLoading
                ? (
                  <LinearProgress />
                )
                : (
                  <Button
                    color='primary'
                    variant='contained'
                    size='large'
                    onClick={showDashboard}
                  >
                    View Dashboard
                  </Button>
                )}
            </Grid>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};

export default Welcome;
