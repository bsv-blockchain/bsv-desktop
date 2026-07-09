import './fetchProxy';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { UserInterface } from '../src/lib/index';
import { onWalletReady } from './onWalletReady';
import { electronFunctions } from './electronFunctions';
import packageJson from '../package.json';
import { btmsPermissionModule } from './lib/permissionModules/btms';
import VaultGate from './lib/components/VaultGate';

// Create the root and render
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);

  // VaultGate handles cold-start unlock / enroll, then hydrates secrets
  // before the wallet tree initializes.
  root.render(
    <React.StrictMode>
      <VaultGate>
        <UserInterface
          onWalletReady={onWalletReady}
          nativeHandlers={electronFunctions}
          appVersion={packageJson.version}
          appName="BSV Desktop"
          permissionModules={[btmsPermissionModule]}
        />
      </VaultGate>
    </React.StrictMode>
  );
}
