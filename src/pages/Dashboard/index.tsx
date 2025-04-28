import { useState, useContext, useRef } from 'react';
import { useBreakpoint } from '../../utils/useBreakpoints';
import { Switch, Route, Redirect } from 'react-router-dom';
import style from '../../navigation/style';
import { makeStyles } from '@mui/styles';
import {
  Typography,
  IconButton,
  Toolbar
} from '@mui/material';
import PageLoading from '../../components/PageLoading';
import Menu from '../../navigation/Menu';
import { Menu as MenuIcon } from '@mui/icons-material';
import MyIdentity from './MyIdentity'; // Assuming index.tsx or similar
import Trust from './Trust'; // Assuming index.tsx or similar
import Apps from './Apps';
import App from './App/Index'; // Assuming index.tsx or similar
import Settings from './Settings'; // Assuming index.tsx or similar
import Security from './Security'; // Assuming index.tsx or similar
import { UserContext } from '../../UserContext';

// Import the components for the new routes
// Note: These might still be .jsx files and need refactoring later
import AppAccess from './AppAccess'; // Assuming index.jsx or similar
import BasketAccess from './BasketAccess'; // Assuming index.jsx or similar
import ProtocolAccess from './ProtocolAccess'; // Assuming index.jsx or similar
import CounterpartyAccess from './CounterpartyAccess'; // Assuming index.jsx or similar
import CertificateAccess from './CertificateAccess'; // Assuming index.jsx or similar

// @ts-expect-error - Type issues with makeStyles
const useStyles = makeStyles(style, {
  name: 'Dashboard'
});

/**
 * Renders the Dashboard layout with routing for sub-pages.
 */
export default function Dashboard() {
  const { pageLoaded } = useContext(UserContext);
  const breakpoints = useBreakpoint();
  const classes = useStyles({ breakpoints });
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(true);
  // TODO: Fetch actual identity key instead of hardcoding 'self'
  const [myIdentityKey] = useState('self');

  const getMargin = () => {
    if (menuOpen && !breakpoints.sm) {
      // Adjust margin based on Menu width if needed
      return '320px'; // Example width, match Menu component
    }
    return '0px';
  };

  if (!pageLoaded) {
    return <PageLoading />;
  }

  return (
    <div className={classes.content_wrap} style={{ marginLeft: getMargin(), transition: 'margin 0.3s ease' }}>
      <div style={{
        marginLeft: 0,
        width: menuOpen ? `calc(100vw - ${getMargin()})` : '100vw',
        transition: 'width 0.3s ease, margin 0.3s ease'
      }}>
        {breakpoints.sm &&
          <div style={{ padding: '0.5em 0 0 0.5em' }} ref={menuRef}>
            <Toolbar>
              <IconButton
                edge='start'
                onClick={() => setMenuOpen(menuOpen => !menuOpen)}
                aria-label='menu'
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                  }
                }}
              >
                <MenuIcon />
              </IconButton>
            </Toolbar>
          </div>}
      </div>
      <Menu menuOpen={menuOpen} setMenuOpen={setMenuOpen} menuRef={menuRef} />
      <div className={classes.page_container}>
        <Switch>
          {/* Existing Redirects */}
          <Redirect from='/dashboard/counterparty/self' to={`/dashboard/counterparty/${myIdentityKey}`} />
          <Redirect from='/dashboard/counterparty/anyone' to='/dashboard/counterparty/0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' />

          {/* Existing Routes */}
          <Route
            path='/dashboard/settings'
            component={Settings}
          />
          <Route
            path='/dashboard/identity'
            component={MyIdentity}
          />
          <Route
            path='/dashboard/trust'
            component={Trust}
          />
          <Route
            path='/dashboard/security'
            component={Security}
          />
          <Route
            path='/dashboard/apps'
            component={Apps}
          />
          <Route
            path='/dashboard/app' // Consider if this needs /:app parameter
            component={App}
          />

          {/* === ADDED MISSING ROUTES === */}
          <Route
            path='/dashboard/manage-app/:originator'
            component={AppAccess}
          />
          <Route
            path='/dashboard/basket/:basketId'
            component={BasketAccess}
          />
          <Route
            path='/dashboard/protocol/:protocolId'
            component={ProtocolAccess}
          />
          <Route
            path='/dashboard/counterparty/:counterparty'
            component={CounterpartyAccess}
          />
          <Route
            path='/dashboard/certificate/:certType'
            component={CertificateAccess}
          />
          {/* === END ADDED MISSING ROUTES === */}

          {/* Default Fallback Route */}
          <Route
            component={() => {
              return (
                <div className={(classes as any).full_width} style={{ padding: '1em' }}>
                  <br />
                  <br />
                  <Typography align='center' color='textPrimary'>Use the menu to select a page</Typography>
                </div>
              );
            }}
          />
        </Switch>
      </div>
    </div>
  );
}

