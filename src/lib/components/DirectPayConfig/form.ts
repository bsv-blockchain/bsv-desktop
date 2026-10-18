import { DirectPaySettingsError, loadDirectPaySettings, saveDirectPaySettings, subscribeDirectPaySettings, type DirectPaySettings } from '../../utils/directPaySettings'

/** The Direct payments card's fields, as the user edits them. */
export interface DirectPayForm {
  receiveEnabled: boolean
  signaling: DirectPaySettings['signaling']
  relayUrl: string
  /** STUN servers, comma-separated. */
  stunUrls: string
  turnUrls: string
  turnUsername: string
  turnCredential: string
}

export function formFromSettings(s: DirectPaySettings): DirectPayForm {
  return {
    receiveEnabled: s.receiveEnabled,
    signaling: s.signaling,
    relayUrl: s.relayUrl,
    stunUrls: s.stunUrls.join(', '),
    turnUrls: s.turn?.urls ?? '',
    turnUsername: s.turn?.username ?? '',
    turnCredential: s.turn?.credential ?? ''
  }
}

/** The form has a TURN server (or part of one), so the card shows the TURN section open. */
export const showsTurn = (f: DirectPayForm) => !!(f.turnUrls || f.turnUsername || f.turnCredential)

/**
 * Every setting, always: saving resets anything left out to its default (Ruling 14).
 * Values are checked and cleaned up by `saveDirectPaySettings`; blank STUN entries and an
 * all-blank TURN server are dropped there.
 */
export function settingsFromForm(f: DirectPayForm): DirectPaySettings {
  return {
    receiveEnabled: f.receiveEnabled,
    signaling: f.signaling,
    relayUrl: f.relayUrl,
    stunUrls: f.stunUrls.split(','),
    turn: { urls: f.turnUrls, username: f.turnUsername, credential: f.turnCredential }
  }
}

/**
 * Stores the form on this device, then applies the stored settings to the open wallet.
 * Throws a message fit for the user, storing and applying nothing, when a value is not
 * acceptable. Returns what was stored, for the form to show.
 */
export async function saveDirectPayForm(form: DirectPayForm, apply: (s: DirectPaySettings) => Promise<void>): Promise<DirectPaySettings> {
  const saved = saveDirectPaySettings(settingsFromForm(form))
  await apply(saved)
  return saved
}

/**
 * Shows the stored settings in the form after every save on this device, the card's own
 * included (it then shows what was stored). Returns the function that stops it.
 */
export function followStoredSettings(setForm: (form: DirectPayForm) => void): () => void {
  return subscribeDirectPaySettings(() => setForm(formFromSettings(loadDirectPaySettings())))
}

/**
 * What to show under the Relay URL field after a failed save: the reason when the relay URL
 * is at fault (missing for relay signaling, or not one the wallet can use), else ''.
 */
export function relayUrlError(error: unknown): string {
  return error instanceof DirectPaySettingsError && error.field === 'relayUrl' ? error.message : ''
}
