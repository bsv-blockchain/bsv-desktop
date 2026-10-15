import type { WalletSettings } from '@bsv/wallet-toolbox-client'

/**
 * Appearance and display currency are device preferences, stored in
 * localStorage like the language choice. Changing them never creates a
 * transaction, so they work in an empty wallet and before sign-in.
 */
export interface DisplayPreferences {
  /** 'light' | 'dark' | 'system' */
  theme: string
  /** 'BSV' | 'SATS' | 'USD' | 'EUR' | 'GBP', or undefined for the default */
  currency?: string
}

// 'userTheme' is also read by the device unlock screen (VaultGate).
const THEME_KEY = 'userTheme'
const CURRENCY_KEY = 'bsv-desktop-currency'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch { /* the preference still applies for this session */ }
}

export function loadDisplayPreferences(): DisplayPreferences {
  return {
    theme: read(THEME_KEY) || 'system',
    currency: read(CURRENCY_KEY) || undefined,
  }
}

export function saveDisplayPreferences(prefs: DisplayPreferences): DisplayPreferences {
  write(THEME_KEY, prefs.theme)
  write(CURRENCY_KEY, prefs.currency)
  return prefs
}

/**
 * Carries choices made on chain by earlier versions over to this device, once:
 * anything already chosen on this device wins.
 */
export function seedDisplayPreferences(prefs: DisplayPreferences, onChain: WalletSettings): DisplayPreferences {
  const seeded = { ...prefs }
  if (read(THEME_KEY) === null && onChain?.theme?.mode) seeded.theme = onChain.theme.mode
  if (read(CURRENCY_KEY) === null && onChain?.currency) seeded.currency = onChain.currency
  return saveDisplayPreferences(seeded)
}

/** The settings the UI reads: on-chain trust settings plus this device's display choices. */
export function withDisplayPreferences(settings: WalletSettings, prefs: DisplayPreferences): WalletSettings {
  return { ...settings, theme: { mode: prefs.theme }, currency: prefs.currency }
}
