import React from 'react'
import { createRoot } from 'react-dom/client'
import { WalletContextProvider } from './WalletContext'
import { UserContextProvider } from './UserContext'
import { HashRouter as Router, Route, Switch } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { BreakpointProvider } from './utils/useBreakpoints'
import { ExchangeRateContextProvider } from './components/AmountDisplay/ExchangeRateContextProvider'
import { AppThemeProvider } from './components/Theme'

import Greeter from './pages/Greeter'
import Dashboard from './pages/Dashboard'
import LostPhone from './pages/Recovery/LostPhone'
import LostPassword from './pages/Recovery/LostPassword'
import Recovery from './pages/Recovery'
import BasketAccessHandler from './components/BasketAccessHandler'
import CertificateAccessHandler from './components/CertificateAccessHandler'
import ProtocolPermissionHandler from './components/ProtocolPermissionHandler'
import PasswordHandler from './components/PasswordHandler'
import RecoveryKeyHandler from './components/RecoveryKeyHandler'
import SpendingAuthorizationHandler from './components/SpendingAuthorizationHandler'
import AuthRedirector from './navigation/AuthRedirector'
import ThemedToastContainer from './components/ThemedToastContainer'

// Define queries for responsive design
const queries = {
    xs: '(max-width: 500px)',
    sm: '(max-width: 720px)',
    md: '(max-width: 1024px)',
    or: '(orientation: portrait)'
}

// 2. Create the root and render:
const rootElement = document.getElementById('root')
if (rootElement) {
  const root = createRoot(rootElement)

  root.render(
    <React.StrictMode>
      <UserContextProvider>
        <WalletContextProvider>
          <ExchangeRateContextProvider>
            <Router>
              <AuthRedirector />
              <BreakpointProvider queries={queries}>
                <AppThemeProvider>
                  <PasswordHandler />
                  <RecoveryKeyHandler />
                  <BasketAccessHandler />
                  <CertificateAccessHandler />
                  <ProtocolPermissionHandler />
                  <SpendingAuthorizationHandler />
                  <ThemedToastContainer />
                  <Switch>
                    <Route exact path='/' component={Greeter} />
                    <Route path='/dashboard' component={Dashboard} />
                    <Route exact path='/recovery/lost-phone' component={LostPhone} />
                    <Route exact path='/recovery/lost-password' component={LostPassword} />
                    <Route exact path='/recovery' component={Recovery} />
                  </Switch>
                </AppThemeProvider>
              </BreakpointProvider>
          </Router>
          </ExchangeRateContextProvider>
      </WalletContextProvider>
      </UserContextProvider>
    </React.StrictMode>
  )
}
