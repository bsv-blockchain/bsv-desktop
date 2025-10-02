import './fetchProxy';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { UserInterface } from '../src/lib/index';
import { onWalletReady } from './onWalletReady';
import { electronFunctions } from './electronFunctions';
import packageJson from '../package.json';

// Create the root and render
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <UserInterface
        onWalletReady={onWalletReady}
        nativeHandlers={electronFunctions}
        appVersion={packageJson.version}
        appName="BSV Desktop"
      />
    </React.StrictMode>
  );
}
