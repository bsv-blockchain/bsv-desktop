import { useState, useContext, useEffect } from 'react'
import {
  Typography, 
  LinearProgress, 
  Box,
  Paper,
  Button,
  useTheme
} from '@mui/material'
import Grid from '@mui/material/Grid2' 
import { makeStyles } from '@mui/styles'
import { toast } from 'react-toastify'
import { WalletContext } from '../../../WalletContext'
import { Theme } from '@mui/material/styles'
import DarkModeImage from "../../../images/darkMode.jsx"
import LightModeImage from "../../../images/lightMode.jsx"
import ComputerIcon from '@mui/icons-material/Computer'
import { UserContext } from '../../../UserContext'
import PageLoading from '../../../components/PageLoading.js'

const useStyles = makeStyles((theme: Theme) => ({
  root: {
    padding: theme.spacing(3),
    maxWidth: '800px',
    margin: '0 auto'
  },
  section: {
    marginBottom: theme.spacing(4)
  },
  themeButton: {
    width: '120px',
    height: '120px',
    borderRadius: theme.shape.borderRadius,
    border: `2px solid ${theme.palette.divider}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease-in-out',
    '&.selected': {
      borderColor: theme.palette.mode === 'dark' ? '#FFFFFF' : theme.palette.primary.main,
      borderWidth: '2px',
      boxShadow: theme.palette.mode === 'dark' ? 'none' : theme.shadows[3]
    }
  },
  currencyButton: {
    width: '100px',
    height: '80px',
    margin: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease-in-out',
    '&.selected': {
      borderColor: theme.palette.mode === 'dark' ? '#FFFFFF' : theme.palette.primary.main,
      borderWidth: '2px',
      backgroundColor: theme.palette.action.selected
    }
  }
}))

const Settings = () => {
  const classes = useStyles()
  const { settings, updateSettings } = useContext(WalletContext)
  const { pageLoaded } = useContext(UserContext)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const theme = useTheme()
  const isDarkMode = theme.palette.mode === 'dark'

  const currencies = {
    BSV: '0.033',
    SATS: '3,333,333',
    USD: '$10',
    EUR: '€9.15',
    GBP: '£7.86'
  }

  const themes = ['light', 'dark', 'system']
  const [selectedTheme, setSelectedTheme] = useState(settings?.theme?.mode || 'system')
  const [selectedCurrency, setSelectedCurrency] = useState(settings?.currency || 'BSV')

  useEffect(() => {
    if (settings?.theme?.mode) {
      setSelectedTheme(settings.theme.mode);
    }
    if (settings?.currency) {
      setSelectedCurrency(settings.currency);
    }
  }, [settings]);

  const handleThemeChange = async (themeOption: string) => {
    if (selectedTheme === themeOption) return;
    
    try {
      setSettingsLoading(true);

      updateSettings({
        ...settings,
        theme: { 
          mode: themeOption 
        }
      });

      setSelectedTheme(themeOption);
      
      toast.success('Theme updated!', {
        position: 'top-center'
      });
    } catch (e) {
      toast.error(e.message);
      setSelectedTheme(settings?.theme?.mode || 'system');
    } finally {
      setSettingsLoading(false);
    }
  }

  const handleCurrencyChange = async (currency) => {
    if (selectedCurrency === currency) return;
    
    try {
      setSettingsLoading(true);
      setSelectedCurrency(currency);
      
      updateSettings({
        ...settings,
        currency,
      });
      
      toast.success('Currency updated!', {
        position: 'top-center'
      });
    } catch (e) {
      toast.error(e.message);
      setSelectedCurrency(settings?.currency || 'BSV');
    } finally {
      setSettingsLoading(false);
    }
  }

  const renderThemeIcon = (themeType) => {
    switch(themeType) {
      case 'light':
        return <LightModeImage />;
      case 'dark':
        return <DarkModeImage />;
      case 'system':
        return <ComputerIcon sx={{ fontSize: 40 }} />;
      default:
        return null;
    }
  };

  const getThemeButtonStyles = (themeType) => {
    switch(themeType) {
      case 'light':
        return {
          color: 'text.primary',
          backgroundColor: 'background.paper',
        };
      case 'dark':
        return {
          color: 'common.white',
          backgroundColor: 'grey.800',
        };
      case 'system':
        return {
          color: theme.palette.mode === 'dark' ? 'common.white' : 'text.primary',
          backgroundColor: theme.palette.mode === 'dark' ? 'grey.800' : 'background.paper',
          backgroundImage: theme.palette.mode === 'dark' 
            ? 'linear-gradient(135deg, #474747 0%, #111111 100%)' 
            : 'linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%)',
        };
      default:
        return {};
    }
  };

  const getSelectedButtonStyle = (isSelected) => {
    if (!isSelected) return {};
    
    return isDarkMode ? {
      borderColor: 'common.white',
      borderWidth: '2px',
      outline: '1px solid rgba(255, 255, 255, 0.5)',
      boxShadow: 'none',
    } : {
      borderColor: 'primary.main',
      borderWidth: '2px',
      boxShadow: 3,
    };
  };

  if (!pageLoaded) {
    return <PageLoading />
  }

  return (
    <div className={classes.root}>
      <Typography variant="h1" color="textPrimary" sx={{ mb: 2 }}>
        User Settings
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
        Adjust your preferences to customize your experience.
      </Typography>

      {settingsLoading && (
        <Box sx={{ width: '100%', mb: 2 }}>
          <LinearProgress />
        </Box>
      )}

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Default Currency
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          How would you like to see your account balance?
        </Typography>

        <Grid container spacing={2} justifyContent="center">
          {Object.keys(currencies).map(currency => (
            <Grid key={currency}>
              <Button
                variant="outlined"
                disabled={settingsLoading}
                className={`${classes.currencyButton} ${selectedCurrency === currency ? 'selected' : ''}`}
                onClick={() => handleCurrencyChange(currency)}
                sx={{
                  ...(selectedCurrency === currency && getSelectedButtonStyle(true)),
                  bgcolor: selectedCurrency === currency ? 'action.selected' : 'transparent',
                }}
              >
                <Typography variant="body1" fontWeight="bold">
                  {currency}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {currencies[currency]}
                </Typography>
              </Button>
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Paper elevation={0} className={classes.section} sx={{ p: 3, bgcolor: 'background.paper' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Choose Your Theme
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
          Select a theme that's comfortable for your eyes.
        </Typography>

        <Grid container spacing={3} justifyContent="center">
          {themes.map(themeOption => (
            <Grid key={themeOption}>
              <Button
                onClick={() => handleThemeChange(themeOption)}
                disabled={settingsLoading}
                className={`${classes.themeButton} ${selectedTheme === themeOption ? 'selected' : ''}`}
                sx={{
                  ...getThemeButtonStyles(themeOption),
                  ...(selectedTheme === themeOption && getSelectedButtonStyle(true)),
                }}
              >
                {renderThemeIcon(themeOption)}
                <Typography variant="body2" sx={{ mt: 1, fontWeight: selectedTheme === themeOption ? 'bold' : 'normal' }}>
                  {themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}
                </Typography>
              </Button>
            </Grid>
          ))}
        </Grid>
      </Paper>
    </div>
  )
}

export default Settings
