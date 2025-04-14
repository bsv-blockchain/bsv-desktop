import { useState, useContext, useRef } from 'react'
import { useBreakpoint } from '../../utils/useBreakpoints.js'
import { Switch, Route, Redirect } from 'react-router-dom'
import style from '../../navigation/style.js'
import { makeStyles } from '@mui/styles'
import {
  Typography,
  IconButton,
  Toolbar
} from '@mui/material'
import PageLoading from '../../components/PageLoading.js'
import Menu from '../../navigation/Menu.js'
import { Menu as MenuIcon } from '@mui/icons-material'
import MyIdentity from './MyIdentity/index.js'
import Trust from './Trust/index.js'
import Apps from './Apps/index.jsx'
import App from './App/Index.jsx'
import Settings from './Settings/index.js'
import Security from './Security/index.js'
import { UserContext } from '../../UserContext.js'

const useStyles = makeStyles(style as any, {
  name: 'Dashboard'
})

/**
 * Renders the Apps page and menu by default
 */
export default function Dashboard() {
  const { pageLoaded } = useContext(UserContext)
  const breakpoints = useBreakpoint()
  const classes = useStyles({ breakpoints })
  const menuRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(true)
  const [myIdentityKey, setMyIdentityKey] = useState('self')


  const getMargin = () => {
    if (menuOpen && !(breakpoints as any).sm) {
      return '320px'
    }
    return '0px'
  }

  if (!pageLoaded) {
    return <PageLoading />
  }

  return (
    <div className={classes.content_wrap} style={{ marginLeft: getMargin(), transition: 'margin 0.3s ease' }}>
      <div style={{
        marginLeft: 0,
        width: menuOpen ? `calc(100vw - ${getMargin()})` : '100vw',
        transition: 'width 0.3s ease, margin 0.3s ease'
      }}>
        {(breakpoints as any).sm &&
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
          <Redirect from='/dashboard/counterparty/self' to={`/dashboard/counterparty/${myIdentityKey}`} />
          <Redirect from='/dashboard/counterparty/anyone' to='/dashboard/counterparty/0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' />
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
            path='/dashboard/app'
            component={App}
          />
          <Route
            component={() => {
              return (
                <div className={classes.full_width} style={{ padding: '1em' }}>
                  <br />
                  <br />
                  <Typography align='center' color='textPrimary'>Use the menu to select a page</Typography>
                </div>
              )
            }}
          />
        </Switch>
      </div>
    </div>
  )
}
