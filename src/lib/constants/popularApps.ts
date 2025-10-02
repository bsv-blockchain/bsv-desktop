import deterministicImage from '../utils/deterministicImage'

// Default placeholder for unknown app - uses deterministic jdenticon
export const generateDefaultIcon = (id: string): string => {
  return deterministicImage(id || 'default-app')
}

// Fallback static icon for cases where an ID isn't available
export const DEFAULT_APP_ICON = 'https://bsvblockchain.org/favicon.ico'

export default [
  {
    appName: 'BotCrafter',
    appIconImageUrl: 'https://botcrafter.io/favicon.ico',
    domain: 'botcrafter.io'
  },
  {
    appName: 'TODO',
    appIconImageUrl: 'https://todo.babbage.systems/favicon.ico',
    domain: 'todo.babbage.systems'
  },
  {
    appName: 'BitGenius',
    appIconImageUrl: 'https://bitgenius.net/favicon.ico',
    domain: 'bitgenius.net'
  },
  {
    appName: 'PeerPay',
    appIconImageUrl: 'https://peerpay.babbage.systems/favicon.ico',
    domain: 'peerpay.babbage.systems'
  }
]
