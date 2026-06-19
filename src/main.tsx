import './fetchProxy';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { UserInterface } from '../src/lib/index';
import { onWalletReady } from './onWalletReady';
import { electronFunctions } from './electronFunctions';
import packageJson from '../package.json';
import { btmsPermissionModule } from './lib/permissionModules/btms';
import { hydrate as hydrateSecrets } from './lib/services/secrets';

// Create the root and render
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);

  // Load (and migrate) encrypted secrets into the sync cache before the wallet
  // tree mounts, so snapshot/key reads during init see hydrated values.
  hydrateSecrets()
    .catch((err) => console.error('[main] secret hydration failed:', err))
    .finally(() => {
      root.render(
        <React.StrictMode>
          <UserInterface
            onWalletReady={onWalletReady}
            nativeHandlers={electronFunctions}
            appVersion={packageJson.version}
            appName="BSV Desktop"
            permissionModules={[btmsPermissionModule]}
          />
        </React.StrictMode>
      );
    });
}
