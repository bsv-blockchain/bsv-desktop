/**
 * PeerPayManager — owns PeerPay client lifecycle and anointment state.
 *
 * Extracted from WalletContext to eliminate duplicate PeerPayClient creation:
 *  - Was created in Effect 11 (wallet manager init) AND Effect 13 (active profile set)
 *  - createClient() now has an idempotency guard: if (this._client) return
 *
 * React integration: subscribe to 'clientChanged' and 'anointmentChanged' events.
 */

import { PeerPayClient, AdvertisementToken } from '@bsv/message-box-client'
import { EventEmittable } from './EventEmittable'

export type PeerPaySnapshot = {
  peerPayClient: PeerPayClient | null
  isHostAnointed: boolean
  anointedHosts: AdvertisementToken[]
  anointmentLoading: boolean
}

type PeerPayEvents = {
  /** Emitted when client or anointment state changes. React subscribes to re-render. */
  changed: PeerPaySnapshot
}

export class PeerPayManager extends EventEmittable<PeerPayEvents> {
  private _client: PeerPayClient | null = null
  private _isHostAnointed = false
  private _anointedHosts: AdvertisementToken[] = []
  private _anointmentLoading = false

  getSnapshot(): PeerPaySnapshot {
    return {
      peerPayClient: this._client,
      isHostAnointed: this._isHostAnointed,
      anointedHosts: this._anointedHosts,
      anointmentLoading: this._anointmentLoading,
    }
  }

  /**
   * Creates PeerPayClient for the given messageBoxUrl.
   * Idempotent: if a client for the same host already exists, returns immediately.
   * Replaces duplicate creation in Effect 11 and Effect 13 of WalletContext.
   */
  async createClient(
    walletForPeerPay: any,
    messageBoxUrl: string,
    adminOriginator: string
  ): Promise<void> {
    if (!walletForPeerPay || !messageBoxUrl) return

    // Idempotency guard — eliminates the duplicate creation race
    if (this._client) return

    try {
      console.log('[PeerPayManager] Creating PeerPayClient...')
      const client = new PeerPayClient({
        walletClient: walletForPeerPay,
        messageBoxHost: messageBoxUrl,
        enableLogging: true,
        originator: adminOriginator,
      })

      // DON'T call init() — would auto-anoint and trigger spending authorization.
      // User must explicitly anoint the host via the UI.
      this._client = client
      this._emitChanged()

      // Check anointment status (read-only, no transaction)
      await this._checkAnointmentStatus(messageBoxUrl)
    } catch (error: any) {
      console.error('[PeerPayManager] Failed to create PeerPayClient:', error)
    }
  }

  /**
   * Creates a new client for a different URL, replacing any existing client.
   * Used when the user changes the message box URL in settings.
   */
  async replaceClient(
    walletForPeerPay: any,
    messageBoxUrl: string,
    adminOriginator: string
  ): Promise<void> {
    this._client = null // Clear guard so createClient proceeds
    await this.createClient(walletForPeerPay, messageBoxUrl, adminOriginator)
  }

  /** Explicitly anoint the current host (requires user authorization via spending permission). */
  async anointCurrentHost(messageBoxUrl: string): Promise<void> {
    if (!this._client || !messageBoxUrl) {
      throw new Error('Message Box URL not configured')
    }

    this._anointmentLoading = true
    this._emitChanged()
    try {
      await this._client.init(messageBoxUrl)
      await this._checkAnointmentStatus(messageBoxUrl)
    } finally {
      this._anointmentLoading = false
      this._emitChanged()
    }
  }

  /** Revoke an existing host anointment. */
  async revokeHostAnointment(token: AdvertisementToken, messageBoxUrl: string): Promise<void> {
    if (!this._client) throw new Error('PeerPay client not initialized')

    this._anointmentLoading = true
    this._emitChanged()
    try {
      await this._client.revokeHostAdvertisement(token)
      await this._checkAnointmentStatus(messageBoxUrl)
    } finally {
      this._anointmentLoading = false
      this._emitChanged()
    }
  }

  /** Query current anointment status (read-only). */
  async checkAnointmentStatus(messageBoxUrl: string): Promise<void> {
    if (!this._client || !messageBoxUrl) {
      this._isHostAnointed = false
      this._anointedHosts = []
      this._emitChanged()
      return
    }
    await this._checkAnointmentStatus(messageBoxUrl)
  }

  /** Revoke all existing anointments then clear the client. */
  async destroyClient(messageBoxUrl: string): Promise<void> {
    if (this._client && this._anointedHosts.length > 0) {
      for (const token of this._anointedHosts) {
        try {
          await this._client.revokeHostAdvertisement(token)
        } catch (revokeError) {
          console.warn('[PeerPayManager] Failed to revoke anointment:', revokeError)
        }
      }
    }
    this._client = null
    this._isHostAnointed = false
    this._anointedHosts = []
    this._emitChanged()
  }

  /** Reset all state without revoking (used on logout). */
  reset() {
    this._client = null
    this._isHostAnointed = false
    this._anointedHosts = []
    this._anointmentLoading = false
    this._emitChanged()
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async _checkAnointmentStatus(messageBoxUrl: string): Promise<void> {
    if (!this._client) return
    try {
      const identityKey = await this._client.getIdentityKey()
      const ads = await this._client.queryAdvertisements(identityKey, messageBoxUrl)
      this._isHostAnointed = ads.length > 0 && ads.some(ad => ad.host === messageBoxUrl)
      this._anointedHosts = ads
    } catch (checkError) {
      console.warn('[PeerPayManager] Could not check anointment status:', checkError)
      this._isHostAnointed = false
      this._anointedHosts = []
    }
    this._emitChanged()
  }

  private _emitChanged() {
    this.emit('changed', this.getSnapshot())
  }
}
