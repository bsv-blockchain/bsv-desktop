import {
  DEFAULT_SETTINGS as LIB_DEFAULT_SETTINGS,
  type WalletSettings,
} from '@bsv/wallet-toolbox-client/out/src/WalletSettingsManager'

// Default configuration constants
export const DEFAULT_CHAIN = 'main'
export const ADMIN_ORIGINATOR = 'admin.com'
export const DEFAULT_USE_WAB = false
export const MESSAGEBOX_HOST = 'https://messagebox.babbage.systems'

/** App-level defaults: library defaults + additional pre-approved trust certifiers */
export const DEFAULT_SETTINGS: WalletSettings = {
  ...LIB_DEFAULT_SETTINGS,
  trustSettings: {
    ...LIB_DEFAULT_SETTINGS.trustSettings,
    trustedCertifiers: [
      ...LIB_DEFAULT_SETTINGS.trustSettings.trustedCertifiers,
      {
        name: 'Who I Am',
        description: 'Certifies email, phone, and X account ownership',
        iconUrl: 'https://whoiam.bsvblockchain.tech/whoiam.png',
        identityKey: '02e7eeb3986273db6843b790a1595ed0ff1b2ae8f43ae2e7f1a0c9db4dd3fb9441',
        trust: 5,
      },
    ],
  },
}
