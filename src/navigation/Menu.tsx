import {
  Apps as BrowseIcon,
  Settings as SettingsIcon,
  Badge as IdentityIcon,
  ExitToApp as LogoutIcon,
  Security as SecurityIcon
} from '@mui/icons-material'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Drawer,
  Box,
  Divider,
} from '@mui/material'
import Profile from '../components/Profile.jsx'
import { useContext, useEffect } from 'react';
import { useHistory } from 'react-router';
import { WalletContext } from '../WalletContext';
import { UserContext } from '../UserContext';
import { useBreakpoint } from '../utils/useBreakpoints.js';


// Custom styling for menu items
const menuItemStyle = (isSelected) => ({
  borderRadius: '8px',
  margin: '4px 8px',
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: 'rgba(25, 118, 210, 0.1)',
  },
  ...(isSelected && {
    backgroundColor: 'rgba(25, 118, 210, 0.12)',
    '&:hover': {
      backgroundColor: 'rgba(25, 118, 210, 0.2)',
    },
  }),
});

export default function Menu({ menuOpen, setMenuOpen, menuRef }) {
  const history = useHistory()
  const breakpoints = useBreakpoint()
  const { logout } = useContext(WalletContext)
  const { appName, appVersion } = useContext(UserContext)
    
  // History.push wrapper
  const navigation = {
    push: (path) => {
      if ((breakpoints as any).sm) {
        setMenuOpen(false)
      }
      history.push(path)
    }
  }

  // First useEffect to handle breakpoint changes
  useEffect(() => {
    if (!(breakpoints as any).sm) {
      setMenuOpen(true)
    } else {
      setMenuOpen(false)
    }
  }, [breakpoints])

  // Second useEffect to handle outside clicks
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }

    // Cleanup
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  return (
    <Drawer
        anchor='left'
        open={menuOpen}
        variant='persistent'
        onClose={() => setMenuOpen(false)}
        sx={{
          width: 320,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: 320,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'divider',
            boxShadow: 3,
            background: 'background.paper',
            overflowX: 'hidden',
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            p: 2
          }}
        >
          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
            <Profile />
          </Box>

          <Divider sx={{ mb: 2 }} />

          <List component="nav" sx={{ mb: 2 }}>
            <ListItemButton
              onClick={() => navigation.push('/dashboard/apps')}
              selected={history.location.pathname === '/dashboard/apps'}
              sx={menuItemStyle(history.location.pathname === '/dashboard/apps')}
            >
              <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/apps' ? 'primary.main' : 'inherit' }}>
                <BrowseIcon />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    fontWeight={history.location.pathname === '/dashboard/apps' ? 600 : 400}
                  >
                    Apps
                  </Typography>
                }
              />
            </ListItemButton>

            <ListItemButton
              onClick={() => navigation.push('/dashboard/identity')}
              selected={history.location.pathname === '/dashboard/identity'}
              sx={menuItemStyle(history.location.pathname === '/dashboard/identity')}
            >
              <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/identity' ? 'primary.main' : 'inherit' }}>
                <IdentityIcon />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    fontWeight={history.location.pathname === '/dashboard/identity' ? 600 : 400}
                  >
                    Identity
                  </Typography>
                }
              />
            </ListItemButton>

            <ListItemButton
              onClick={() => navigation.push('/dashboard/trust')}
              selected={history.location.pathname === '/dashboard/trust'}
              sx={menuItemStyle(history.location.pathname === '/dashboard/trust')}
            >
              <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/trust' ? 'primary.main' : 'inherit' }}>
                <VerifiedUserIcon />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    fontWeight={history.location.pathname === '/dashboard/trust' ? 600 : 400}
                  >
                    Trust
                  </Typography>
                }
              />
            </ListItemButton>

            <ListItemButton
              onClick={() => navigation.push('/dashboard/security')}
              selected={history.location.pathname === '/dashboard/security'}
              sx={menuItemStyle(history.location.pathname === '/dashboard/security')}
            >
              <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/security' ? 'primary.main' : 'inherit' }}>
                <SecurityIcon />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    fontWeight={history.location.pathname === '/dashboard/security' ? 600 : 400}
                  >
                    Security
                  </Typography>
                }
              />
            </ListItemButton>

            <ListItemButton
              onClick={() => navigation.push('/dashboard/settings')}
              selected={history.location.pathname === '/dashboard/settings'}
              sx={menuItemStyle(history.location.pathname === '/dashboard/settings')}
            >
              <ListItemIcon sx={{ minWidth: 40, color: history.location.pathname === '/dashboard/settings' ? 'primary.main' : 'inherit' }}>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    fontWeight={history.location.pathname === '/dashboard/settings' ? 600 : 400}
                  >
                    Settings
                  </Typography>
                }
              />
            </ListItemButton>
          </List>

          <Box sx={{ mt: 'auto', mb: 2 }}>
            <ListItemButton
              onClick={() => {
                logout();
                history.push('/');
              }}
              sx={menuItemStyle(false)}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <LogoutIcon />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body1">
                    Logout
                  </Typography>
                }
              />
            </ListItemButton>

            <Typography
              variant='caption'
              color='textSecondary'
              align='center'
              sx={{
                display: 'block',
                mt: 2,
                textAlign: 'center',
                width: '100%',
                opacity: 0.5,
              }}
            >
              {appName} v{appVersion}
              <br />
              <i>Made with love for the BSV Blockchain</i>
            </Typography>
          </Box>
        </Box>
      </Drawer>
  )
}