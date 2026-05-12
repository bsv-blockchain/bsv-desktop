/**
 * PermissionQueueManager — plain TypeScript class owning all permission queue logic.
 *
 * Extracted from WalletContext to eliminate:
 *  - Stale closures in group-gating effect (ESLint-disabled exhaustive-deps)
 *  - wasOriginallyFocused race condition (async isFocused inside setState)
 *  - permissionsManagerRef sync lag (separate useEffect to copy state into a ref)
 *
 * React integration: subscribe to 'snapshot' events and map to UI state.
 * Focus management: subscribe to 'focusNeeded' / 'focusReleasable' events.
 */

import {
  WalletPermissionsManager,
  PermissionRequest,
} from '@bsv/wallet-toolbox-client'
import { WalletInterface } from '@bsv/sdk'
import { EventEmittable } from './EventEmittable'
import { DEFAULT_PERMISSIONS_CONFIG, PermissionsConfig } from '../WalletContext'
import { ADMIN_ORIGINATOR } from '../config'
import {
  GroupPermissionRequest,
  CounterpartyPermissionRequest,
  GroupedPermissions,
} from '../types/GroupedPermissions'
import type { PermissionPromptHandler } from '../permissionModules/types'

// ---- Internal types (mirrors WalletContext private types) ----

type GroupPhase = 'idle' | 'pending'

type GroupDecision = {
  allow: {
    protocols?: Set<string> | 'all'
    baskets?: Set<string>
    certificates?: Array<{ type: string; fields?: Set<string> }>
    spendingUpTo?: number
  }
}

type PermissionType = 'identity' | 'protocol' | 'renewal' | 'basket'

export type BasketAccessRequest = {
  requestID: string
  basket?: string
  originator: string
  reason?: string
  renewal?: boolean
}

export type CertificateAccessRequest = {
  requestID: string
  certificate?: {
    certType?: string
    fields?: Record<string, any>
    verifier?: string
  }
  originator: string
  reason?: string
  renewal?: boolean
}

export type ProtocolAccessRequest = {
  requestID: string
  protocolSecurityLevel: number
  protocolID: string
  counterparty?: string
  originator?: string
  description?: string
  renewal?: boolean
  type?: PermissionType
}

export type SpendingRequest = {
  requestID: string
  originator: string
  description?: string
  transactionAmount: number
  totalPastSpending: number
  amountPreviouslyAuthorized: number
  authorizationAmount: number
  renewal?: boolean
  lineItems: any[]
}

type DeferredBuffers = {
  basket: BasketAccessRequest[]
  certificate: CertificateAccessRequest[]
  protocol: ProtocolAccessRequest[]
  spending: SpendingRequest[]
  counterparty: CounterpartyPermissionRequest[]
}

export type QueueSnapshot = {
  basketRequests: BasketAccessRequest[]
  certificateRequests: CertificateAccessRequest[]
  protocolRequests: ProtocolAccessRequest[]
  spendingRequests: SpendingRequest[]
  groupPermissionRequests: GroupPermissionRequest[]
  counterpartyPermissionRequests: CounterpartyPermissionRequest[]
  groupPhase: GroupPhase
  permissionsConfig: PermissionsConfig
  enabledPermissionModules: string[]
}

type PermissionQueueEvents = {
  /** Emitted whenever any queue or config changes. React subscribes to re-render. */
  snapshot: QueueSnapshot
  /** Emitted when first request arrives in an empty queue. React must handle isFocused + onFocusRequested. */
  focusNeeded: void
  /**
   * Emitted when all queues drain to empty.
   * Payload: wasOriginallyFocused — if true, React should NOT relinquish focus.
   */
  focusReleasable: boolean
}

const GROUP_GRACE_MS = 20_000
const GROUP_COOLDOWN_MS = 5 * 60 * 1000
const PACT_COOLDOWN_MS = 5 * 60 * 1000

export class PermissionQueueManager extends EventEmittable<PermissionQueueEvents> {
  // ---- Queue state (previously useState) ----
  private _basketRequests: BasketAccessRequest[] = []
  private _certificateRequests: CertificateAccessRequest[] = []
  private _protocolRequests: ProtocolAccessRequest[] = []
  private _spendingRequests: SpendingRequest[] = []
  private _groupRequests: GroupPermissionRequest[] = []
  private _counterpartyRequests: CounterpartyPermissionRequest[] = []

  // ---- Group phase state machine (previously useState + refs) ----
  private _groupPhase: GroupPhase = 'idle'
  private _deferred: DeferredBuffers = { basket: [], certificate: [], protocol: [], spending: [], counterparty: [] }
  private _groupDecision: GroupDecision | null = null
  private _groupTimer: number | null = null

  // ---- Cooldown tracking (previously useRefs) ----
  private _groupRequestCooldownKeyById = new Map<string, string>()
  private _groupCooldownUntil: Record<string, number> = {}
  private _pactCooldownUntil: Record<string, number> = {}

  // ---- Focus tracking (previously wasOriginallyFocused useState) ----
  private _wasOriginallyFocused = false

  // ---- Guard against spurious focus-release on mount ----
  private _hadCounterpartyRequest = false

  // ---- Group focus request deduplication ----
  private _pendingGroupFocusRequestId: string | null = null
  private _groupDidRequestFocus = false

  // ---- Live permissions manager (replaces permissionsManagerRef + sync useEffect) ----
  private _permissionsManager: any = null

  // ---- Configuration ----
  permissionsConfig: PermissionsConfig = DEFAULT_PERMISSIONS_CONFIG
  adminOriginator: string = ADMIN_ORIGINATOR
  enabledPermissionModules: string[] = []

  // ---- Permission module support ----
  private _getPermissionModuleById: ((id: string) => any) | null = null
  private _promptHandlers: Map<string, PermissionPromptHandler> = new Map()

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  setPermissionsManager(pm: any) {
    this._permissionsManager = pm
  }

  /**
   * Replace the current permissions config. Updates three things:
   *   1. The queue's `permissionsConfig` (snapshot/UI source).
   *   2. The live `WalletPermissionsManager.config` so subsequent BRC-100
   *      requests honor the new flags without rebuilding the wallet —
   *      `WalletPermissionsManager` reads `this.config.seek*` on every call.
   *      `permissionModules` are preserved from the existing config.
   *   3. Emits a snapshot so `useSyncExternalStore` consumers re-render.
   *
   * Persistence to `localStorage` is the caller's responsibility (the React
   * adapter writes `permissionsConfig` to localStorage so the value survives
   * reloads). The queue stays storage-agnostic.
   */
  setPermissionsConfig(config: PermissionsConfig) {
    this.permissionsConfig = config
    if (this._permissionsManager) {
      const existingModules = this._permissionsManager.config?.permissionModules
      this._permissionsManager.config = {
        ...config,
        permissionModules: existingModules,
      }
    }
    this._emitSnapshot()
  }

  setPermissionsModuleHelpers(
    getById: (id: string) => any,
    promptHandlers: Map<string, PermissionPromptHandler>
  ) {
    this._getPermissionModuleById = getById
    this._promptHandlers = promptHandlers
  }

  /** Called by React adapter after handling focusNeeded event. */
  setWasOriginallyFocused(focused: boolean) {
    this._wasOriginallyFocused = focused
  }

  getSnapshot(): QueueSnapshot {
    return {
      basketRequests: this._basketRequests,
      certificateRequests: this._certificateRequests,
      protocolRequests: this._protocolRequests,
      spendingRequests: this._spendingRequests,
      groupPermissionRequests: this._groupRequests,
      counterpartyPermissionRequests: this._counterpartyRequests,
      groupPhase: this._groupPhase,
      permissionsConfig: this.permissionsConfig,
      enabledPermissionModules: this.enabledPermissionModules,
    }
  }

  // ------------------------------------------------------------------
  // Cooldown helpers
  // ------------------------------------------------------------------

  private _normalizeOriginator(o: string) {
    return o.replace(/^https?:\/\//, '')
  }

  private _getGroupCooldownKey(originator: string, permissions?: GroupedPermissions): string {
    const norm = this._normalizeOriginator(originator)
    const protocolPermissions = permissions?.protocolPermissions ?? []
    const hasOnlyProtocols =
      !!protocolPermissions.length &&
      !(permissions?.basketAccess?.length) &&
      !(permissions?.certificateAccess?.length) &&
      !permissions?.spendingAuthorization

    if (!hasOnlyProtocols) return norm

    const allLevel2 = protocolPermissions.every(p => (p.protocolID?.[0] ?? 0) === 2)
    if (!allLevel2) return norm

    const cps = new Set(protocolPermissions.map(p => p.counterparty ?? 'self'))
    if (cps.size !== 1) return norm

    const counterparty = protocolPermissions[0]?.counterparty ?? 'self'
    return `${norm}|${counterparty}`
  }

  private _isGroupCooldownActive(key: string): boolean {
    return Date.now() < (this._groupCooldownUntil[key] ?? 0)
  }

  private _startGroupCooldown(key: string) {
    this._groupCooldownUntil[key] = Date.now() + GROUP_COOLDOWN_MS
  }

  private _isPactCooldownActive(key: string): boolean {
    return Date.now() < (this._pactCooldownUntil[key] ?? 0)
  }

  startPactCooldownForCounterparty(originator: string, counterparty: string) {
    const key = `${this._normalizeOriginator(originator)}|${counterparty}`
    this._pactCooldownUntil[key] = Date.now() + PACT_COOLDOWN_MS
  }

  // ------------------------------------------------------------------
  // Group phase state machine (replaces Effect 5 in WalletContext)
  // ------------------------------------------------------------------

  /** Enter group-pending mode: stash live queues to deferred, clear them, start grace timer. */
  private _enterGroupPending() {
    if (this._groupPhase === 'pending') return

    this._groupPhase = 'pending'

    // Move live requests to deferred buffers
    this._deferred = {
      basket: [...this._deferred.basket, ...this._basketRequests],
      certificate: [...this._deferred.certificate, ...this._certificateRequests],
      protocol: [...this._deferred.protocol, ...this._protocolRequests],
      spending: [...this._deferred.spending, ...this._spendingRequests],
      counterparty: [...this._deferred.counterparty, ...this._counterpartyRequests],
    }

    // Clear live queues (modals will be closed by React via snapshot)
    this._basketRequests = []
    this._certificateRequests = []
    this._protocolRequests = []
    this._spendingRequests = []
    this._counterpartyRequests = []

    // Start grace timer
    if (this._groupTimer !== null) window.clearTimeout(this._groupTimer)
    this._groupTimer = window.setTimeout(() => {
      this._releaseDeferredAfterGroup(null)
    }, GROUP_GRACE_MS)

    this._emitSnapshot()
  }

  private _isCoveredByDecision(d: GroupDecision | null, req: any): boolean {
    if (!d) return false
    if ('basket' in req) {
      return !!d.allow.baskets && !!req.basket && d.allow.baskets.has(req.basket)
    }
    if ('certificateType' in req || 'type' in req) {
      const type = (req.certificateType ?? req.type) as string | undefined
      const fields = new Set<string>(req.fieldsArray ?? req.fields ?? [])
      if (!type) return false
      const rule = d.allow.certificates?.find(c => c.type === type)
      if (!rule) return false
      if (!rule.fields || rule.fields.size === 0) return true
      for (const f of fields) if (!rule.fields.has(f)) return false
      return true
    }
    if ('protocolID' in req) {
      if (d.allow.protocols === 'all') return true
      if (!(d.allow.protocols instanceof Set)) return false
      const key = req.protocolSecurityLevel === 2
        ? `${req.protocolID}|${req.counterparty ?? 'self'}`
        : req.protocolID
      return d.allow.protocols.has(key)
    }
    if ('authorizationAmount' in req) {
      return d.allow.spendingUpTo != null && req.authorizationAmount <= (d.allow.spendingUpTo as number)
    }
    return false
  }

  private _decisionFromGranted(granted: any): GroupDecision {
    const protocols = (() => {
      const arr = granted?.protocolPermissions ?? granted?.protocols ?? []
      const names = new Set<string>()
      for (const p of arr) {
        const id = p?.protocolID
        if (Array.isArray(id) && id.length > 1 && typeof id[1] === 'string') {
          const sec = id[0]
          const name = id[1]
          const counterparty = p?.counterparty ?? 'self'
          const key = sec === 2 ? `${name}|${counterparty}` : name
          names.add(key)
        } else if (typeof id === 'string') names.add(id)
        else if (typeof p?.name === 'string') names.add(p.name)
      }
      return names
    })()
    const baskets = (() => {
      const arr = granted?.basketAccess ?? granted?.baskets ?? []
      const set = new Set<string>()
      for (const b of arr) {
        if (typeof b === 'string') set.add(b)
        else if (typeof b?.basket === 'string') set.add(b.basket)
      }
      return set
    })()
    const certificates = (() => {
      const arr = granted?.certificateAccess ?? granted?.certificates ?? []
      const out: Array<{ type: string; fields?: Set<string> }> = []
      for (const c of arr) {
        const type = c?.type ?? c?.certificateType
        if (typeof type === 'string') {
          const fields = new Set<string>((c?.fields ?? []).filter((x: any) => typeof x === 'string'))
          out.push({ type, fields: fields.size ? fields : undefined })
        }
      }
      return out
    })()
    const spendingUpTo = (() => {
      const s = granted?.spendingAuthorization ?? granted?.spending ?? null
      if (!s) return undefined
      if (typeof s === 'number') return s
      if (typeof s?.satoshis === 'number') return s.satoshis
      return undefined
    })()
    return { allow: { protocols, baskets, certificates, spendingUpTo } }
  }

  private async _releaseDeferredAfterGroup(decision: GroupDecision | null) {
    if (this._groupTimer !== null) {
      window.clearTimeout(this._groupTimer)
      this._groupTimer = null
    }
    this._groupDecision = decision

    const requeue: DeferredBuffers = { basket: [], certificate: [], protocol: [], spending: [], counterparty: [] }

    const maybeHandle = (list: any[], key: keyof DeferredBuffers) => {
      for (const r of list) {
        if (!this._isCoveredByDecision(decision, r)) {
          (requeue as any)[key].push(r)
        }
      }
    }

    maybeHandle(this._deferred.basket, 'basket')
    maybeHandle(this._deferred.certificate, 'certificate')
    maybeHandle(this._deferred.protocol, 'protocol')
    maybeHandle(this._deferred.spending, 'spending')
    maybeHandle(this._deferred.counterparty, 'counterparty')

    this._deferred = { basket: [], certificate: [], protocol: [], spending: [], counterparty: [] }
    this._groupPhase = 'idle'

    // Re-queue uncovered items
    if (requeue.basket.length) this._basketRequests = requeue.basket
    if (requeue.certificate.length) this._certificateRequests = requeue.certificate
    if (requeue.protocol.length) this._protocolRequests = requeue.protocol
    if (requeue.spending.length) this._spendingRequests = requeue.spending
    if (requeue.counterparty.length) {
      this._counterpartyRequests = requeue.counterparty
      this._hadCounterpartyRequest = true
    }

    this._emitSnapshot()
  }

  // ------------------------------------------------------------------
  // Advance queue functions (previously inline functions in WalletContext)
  // ------------------------------------------------------------------

  advanceBasketQueue() {
    this._basketRequests = this._basketRequests.slice(1)
    if (this._basketRequests.length === 0) {
      this.emit('focusReleasable', this._wasOriginallyFocused)
    }
    this._emitSnapshot()
  }

  advanceCertificateQueue() {
    this._certificateRequests = this._certificateRequests.slice(1)
    if (this._certificateRequests.length === 0) {
      this.emit('focusReleasable', this._wasOriginallyFocused)
    }
    this._emitSnapshot()
  }

  advanceProtocolQueue() {
    this._protocolRequests = this._protocolRequests.slice(1)
    if (this._protocolRequests.length === 0) {
      this.emit('focusReleasable', this._wasOriginallyFocused)
    }
    this._emitSnapshot()
  }

  advanceSpendingQueue() {
    this._spendingRequests = this._spendingRequests.slice(1)
    if (this._spendingRequests.length === 0) {
      this.emit('focusReleasable', this._wasOriginallyFocused)
    }
    this._emitSnapshot()
  }

  advanceGroupQueue() {
    this._groupRequests = this._groupRequests.slice(1)
    if (this._groupRequests.length === 0) {
      this.emit('focusReleasable', this._wasOriginallyFocused)
    }
    this._emitSnapshot()
  }

  advanceCounterpartyPermissionQueue() {
    this._counterpartyRequests = this._counterpartyRequests.slice(1)
    if (this._counterpartyRequests.length === 0 && this._hadCounterpartyRequest) {
      this.emit('focusReleasable', this._wasOriginallyFocused)
    }
    this._emitSnapshot()
  }

  // ------------------------------------------------------------------
  // Auto-dismiss during cooldown (replaces Effect 15 in WalletContext)
  // ------------------------------------------------------------------

  /** Call this whenever groupPermissionRequests changes to check for cooldown dismissal. */
  checkGroupCooldownDismissal() {
    const current = this._groupRequests[0]
    if (!current) return
    const cooldownKey = this._getGroupCooldownKey(current.originator, current.permissions)
    if (!this._isGroupCooldownActive(cooldownKey)) return

    ;(async () => {
      try {
        await (this._permissionsManager as any)?.dismissGroupedPermission?.(current.requestID)
      } catch (error) {
        console.debug('Failed to dismiss grouped permission during cooldown:', error)
      } finally {
        this._groupRequestCooldownKeyById.delete(current.requestID)
        this.advanceGroupQueue()
      }
    })()
  }

  // ------------------------------------------------------------------
  // Permission callbacks (bound to WalletPermissionsManager)
  // ------------------------------------------------------------------

  /** Basket access callback — bound by createPermissionsManager. */
  readonly basketAccessCallback = (incomingRequest: PermissionRequest & {
    requestID: string
    basket?: string
    originator: string
    reason?: string
    renewal?: boolean
  }) => {
    if (this._groupPhase === 'pending') {
      if (incomingRequest?.requestID) {
        this._deferred.basket.push({
          requestID: incomingRequest.requestID,
          basket: incomingRequest.basket,
          originator: incomingRequest.originator,
          reason: incomingRequest.reason,
          renewal: incomingRequest.renewal,
        })
      }
      return
    }

    if (!incomingRequest?.requestID) return

    const wasEmpty = this._basketRequests.length === 0
    this._basketRequests = [
      ...this._basketRequests,
      {
        requestID: incomingRequest.requestID,
        basket: incomingRequest.basket,
        originator: incomingRequest.originator,
        reason: incomingRequest.reason,
        renewal: incomingRequest.renewal,
      },
    ]

    if (wasEmpty) this.emit('focusNeeded')
    this._emitSnapshot()
  }

  /** Certificate access callback — bound by createPermissionsManager. */
  readonly certificateAccessCallback = (incomingRequest: PermissionRequest & {
    requestID: string
    certificate?: { certType?: string; fields?: Record<string, any>; verifier?: string }
    originator: string
    reason?: string
    renewal?: boolean
  }) => {
    if (this._groupPhase === 'pending') {
      const certificate = incomingRequest.certificate as any
      this._deferred.certificate.push({
        requestID: incomingRequest.requestID,
        originator: incomingRequest.originator,
        verifierPublicKey: certificate?.verifier || '',
        certificateType: certificate?.certType || '',
        fieldsArray: Object.keys(certificate?.fields || {}),
        description: incomingRequest.reason,
        renewal: incomingRequest.renewal,
      } as any)
      return
    }

    if (!incomingRequest?.requestID) return

    const certificate = incomingRequest.certificate as any
    const wasEmpty = this._certificateRequests.length === 0
    this._certificateRequests = [
      ...this._certificateRequests,
      {
        requestID: incomingRequest.requestID,
        originator: incomingRequest.originator,
        verifierPublicKey: certificate?.verifier || '',
        certificateType: certificate?.certType || '',
        fieldsArray: Object.keys(certificate?.fields || {}),
        description: incomingRequest.reason,
        renewal: incomingRequest.renewal,
      } as any,
    ]

    if (wasEmpty) this.emit('focusNeeded')
    this._emitSnapshot()
  }

  /** Protocol permission callback — bound by createPermissionsManager. */
  readonly protocolPermissionCallback = (args: PermissionRequest & { requestID: string }): Promise<void> => {
    const { requestID, counterparty, originator, reason, renewal, protocolID } = args

    if (!requestID || !protocolID) return Promise.resolve()

    const [protocolSecurityLevel, protocolNameString] = protocolID as any

    let permissionType: PermissionType = 'protocol'
    if (protocolNameString === 'identity resolution') {
      permissionType = 'identity'
    } else if (renewal) {
      permissionType = 'renewal'
    } else if (protocolNameString.includes('basket')) {
      permissionType = 'basket'
    }

    const newItem: ProtocolAccessRequest = {
      requestID,
      protocolSecurityLevel,
      protocolID: protocolNameString,
      counterparty,
      originator,
      description: reason,
      renewal,
      type: permissionType,
    }

    if (this._groupPhase === 'pending') {
      this._deferred.protocol.push(newItem)
      return Promise.resolve()
    }

    return new Promise<void>(resolve => {
      const wasEmpty = this._protocolRequests.length === 0
      this._protocolRequests = [...this._protocolRequests, newItem]
      if (wasEmpty) this.emit('focusNeeded')
      this._emitSnapshot()
      resolve()
    })
  }

  /** Spending authorization callback — bound by createPermissionsManager. */
  readonly spendingAuthorizationCallback = async (args: PermissionRequest & { requestID: string }): Promise<void> => {
    const { requestID, originator, reason, renewal, spending } = args

    if (!requestID || !spending) return

    let { satoshis, lineItems } = spending as any
    if (!lineItems) lineItems = []

    const newItem: SpendingRequest = {
      requestID,
      originator,
      description: reason,
      transactionAmount: 0,
      totalPastSpending: 0,
      amountPreviouslyAuthorized: 0,
      authorizationAmount: satoshis,
      renewal,
      lineItems,
    }

    if (this._groupPhase === 'pending') {
      this._deferred.spending.push(newItem)
      return
    }

    return new Promise<void>(resolve => {
      const wasEmpty = this._spendingRequests.length === 0
      this._spendingRequests = [...this._spendingRequests, newItem]
      if (wasEmpty) this.emit('focusNeeded')
      this._emitSnapshot()
      resolve()
    })
  }

  /** Group permission callback — bound by createPermissionsManager. */
  readonly groupPermissionCallback = async (args: {
    requestID: string
    permissions: GroupedPermissions
    originator: string
    reason?: string
  }): Promise<void> => {
    const { requestID, originator, permissions } = args

    if (!requestID || !permissions) return

    // Peer-group requests become counterparty permission requests
    if (requestID.startsWith('group-peer:')) {
      const parts = requestID.split(':')
      const counterparty = parts[parts.length - 1] || 'self'
      const newItem: CounterpartyPermissionRequest = {
        requestID,
        originator,
        counterparty,
        permissions: {
          protocols: (permissions?.protocolPermissions || []).map(p => ({
            protocolID: p.protocolID,
            description: p.description,
          })),
        },
      }

      const cooldownKey = `${this._normalizeOriginator(originator)}|${counterparty}`
      if (this._isPactCooldownActive(cooldownKey)) {
        try {
          await (this._permissionsManager as any)?.dismissGroupedPermission?.(requestID)
        } catch (error) {
          console.debug('Failed to dismiss peer-grouped permission during cooldown:', error)
        }
        return
      }

      if (this._groupPhase === 'pending') {
        this._deferred.counterparty.push(newItem)
        return
      }

      return new Promise<void>(resolve => {
        const wasEmpty = this._counterpartyRequests.length === 0
        this._counterpartyRequests = [...this._counterpartyRequests, newItem]
        this._hadCounterpartyRequest = true
        if (wasEmpty) this.emit('focusNeeded')
        this._emitSnapshot()
        resolve()
      })
    }

    // Standard group permission request
    const newItem: GroupPermissionRequest = { requestID, originator, permissions }
    const cooldownKey = this._getGroupCooldownKey(originator, permissions)
    this._groupRequestCooldownKeyById.set(requestID, cooldownKey)

    if (this._isGroupCooldownActive(cooldownKey)) {
      try {
        await (this._permissionsManager as any)?.dismissGroupedPermission?.(requestID)
      } catch (error) {
        console.debug('Failed to dismiss grouped permission during cooldown:', error)
      }
      this._groupRequestCooldownKeyById.delete(requestID)
      return
    }

    return new Promise<void>(resolve => {
      const wasEmpty = this._groupRequests.length === 0
      this._groupRequests = [...this._groupRequests, newItem]

      if (wasEmpty) {
        this._pendingGroupFocusRequestId = requestID
        this._groupDidRequestFocus = false
        this.emit('focusNeeded')
      }

      // Enter pending mode now that group queue is non-empty
      this._enterGroupPending()
      this._emitSnapshot()
      resolve()
    })
  }

  /** Counterparty permission callback — bound by createPermissionsManager. */
  readonly counterpartyPermissionCallback = async (args: CounterpartyPermissionRequest): Promise<void> => {
    if (!args?.requestID || !args?.permissions) return

    const newItem: CounterpartyPermissionRequest = {
      requestID: args.requestID,
      originator: args.originator,
      counterparty: args.counterparty,
      counterpartyLabel: args.counterpartyLabel,
      permissions: args.permissions,
    }

    const cooldownKey = `${this._normalizeOriginator(args.originator)}|${args.counterparty}`
    if (this._isPactCooldownActive(cooldownKey)) {
      try {
        await (this._permissionsManager as any)?.grantCounterpartyPermission?.({
          requestID: args.requestID,
          granted: { protocols: [] },
          expiry: 0,
        })
      } catch (error) {
        console.debug('Failed to auto-dismiss counterparty permission during cooldown:', error)
      }
      return
    }

    if (this._groupPhase === 'pending') {
      this._deferred.counterparty.push(newItem)
      return
    }

    return new Promise<void>(resolve => {
      const wasEmpty = this._counterpartyRequests.length === 0
      this._counterpartyRequests = [...this._counterpartyRequests, newItem]
      this._hadCounterpartyRequest = true
      if (wasEmpty) this.emit('focusNeeded')
      this._emitSnapshot()
      resolve()
    })
  }

  // ------------------------------------------------------------------
  // Permissions manager factory
  // ------------------------------------------------------------------

  /**
   * Creates a WalletPermissionsManager with all callbacks bound to this queue.
   * Also monkey-patches grant/deny/dismiss to auto-release the group gate.
   */
  createPermissionsManager(wallet: WalletInterface): WalletPermissionsManager {
    const permissionModulesMap: Record<string, any> = {}
    for (const moduleId of this.enabledPermissionModules) {
      const descriptor = this._getPermissionModuleById?.(moduleId)
      if (!descriptor) continue
      permissionModulesMap[moduleId] = descriptor.createModule({
        wallet,
        promptHandler: this._promptHandlers.get(moduleId),
      })
    }

    const configWithModules = {
      ...this.permissionsConfig,
      permissionModules: permissionModulesMap,
    }

    const pm = new WalletPermissionsManager(wallet, this.adminOriginator, configWithModules as any)

    pm.bindCallback('onProtocolPermissionRequested', this.protocolPermissionCallback)
    pm.bindCallback('onBasketAccessRequested', this.basketAccessCallback)
    pm.bindCallback('onSpendingAuthorizationRequested', this.spendingAuthorizationCallback)
    pm.bindCallback('onCertificateAccessRequested', this.certificateAccessCallback)
    pm.bindCallback('onGroupedPermissionRequested', this.groupPermissionCallback)
    try {
      ;(pm as any).bindCallback('onCounterpartyPermissionRequested', this.counterpartyPermissionCallback)
    } catch (e) {
      console.warn('[PermissionQueueManager] onCounterpartyPermissionRequested not supported:', e)
    }

    // Monkey-patch grant/deny/dismiss to auto-release the group gate
    const originalGrant = (pm as any).grantGroupedPermission?.bind(pm)
    const originalDeny = (pm as any).denyGroupedPermission?.bind(pm)
    const originalDismiss = (pm as any).dismissGroupedPermission?.bind(pm)

    if (originalGrant) {
      ;(pm as any).grantGroupedPermission = async (requestID: string, granted: any) => {
        const res = await originalGrant(requestID, granted)
        try { await this._releaseDeferredAfterGroup(this._decisionFromGranted(granted)) } catch { }
        const key = this._groupRequestCooldownKeyById.get(requestID)
        if (key) {
          this._startGroupCooldown(key)
          this._groupRequestCooldownKeyById.delete(requestID)
        }
        return res
      }
    }
    if (originalDeny) {
      ;(pm as any).denyGroupedPermission = async (requestID: string) => {
        const res = await originalDeny(requestID)
        try { await this._releaseDeferredAfterGroup(null) } catch { }
        const key = this._groupRequestCooldownKeyById.get(requestID)
        if (key) {
          this._startGroupCooldown(key)
          this._groupRequestCooldownKeyById.delete(requestID)
        }
        return res
      }
    }
    if (originalDismiss) {
      ;(pm as any).dismissGroupedPermission = async (requestID: string) => {
        const res = await originalDismiss(requestID)
        try { await this._releaseDeferredAfterGroup(null) } catch { }
        const key = this._groupRequestCooldownKeyById.get(requestID)
        if (key) {
          this._startGroupCooldown(key)
          this._groupRequestCooldownKeyById.delete(requestID)
        }
        return res
      }
    }

    this._permissionsManager = pm
    ;(window as any).permissionsManager = pm
    return pm
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private _emitSnapshot() {
    this.emit('snapshot', this.getSnapshot())
  }
}
