import {
  WalletInterface,
  CreateActionArgs,
  SignActionArgs,
  AbortActionArgs,
  ListActionsArgs,
  InternalizeActionArgs,
  ListOutputsArgs,
  RelinquishOutputArgs,
  GetPublicKeyArgs,
  RevealCounterpartyKeyLinkageArgs,
  RevealSpecificKeyLinkageArgs,
  WalletEncryptArgs,
  WalletDecryptArgs,
  CreateHmacArgs,
  VerifyHmacArgs,
  CreateSignatureArgs,
  VerifySignatureArgs,
  AcquireCertificateArgs,
  ListCertificatesArgs,
  ProveCertificateArgs,
  RelinquishCertificateArgs,
  DiscoverByIdentityKeyArgs,
  DiscoverByAttributesArgs,
  GetHeaderArgs,
  WERR_REVIEW_ACTIONS,
  type AtomicBEEF,
  type OutpointString,
  type ReviewActionResult,
  type SendWithResult,
  type TXIDHexString
} from '@bsv/sdk';
import { parseWalletPayload, stringifyWalletPayload } from './walletByteJson';
import {
  beginHttpBridgeSession,
  endHttpBridgeSession,
  isHttpBridgePaused,
} from './lib/services/httpBridgeSession';

interface HttpRequestEvent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  request_id: number;
}

interface HttpResponseEvent {
  request_id: number;
  status: number;
  body: string;
}

/**
 * Duck-type check for WERR_REVIEW_ACTIONS-shaped errors. We don't use
 * `error?.constructor.name === 'WERR_REVIEW_ACTIONS'` because Vite's
 * default production build (esbuild minification) renames class names
 * — `constructor.name` then returns mangled identifiers like `'a'`,
 * the check fails, and the error falls through to the generic
 * `{message: ...}` wrapper which strips `code`, `tx`, `txid`,
 * `reviewActionResults`, and `noSendChange`. The calling app then
 * can't recover the signed transaction or surface review reasons,
 * making `acceptDelayedBroadcast: false` flows un-debuggable.
 *
 * `instanceof WERR_REVIEW_ACTIONS` doesn't work either because the
 * error is thrown by `@bsv/wallet-toolbox`'s WERR_REVIEW_ACTIONS class
 * (a different class identity from `@bsv/sdk`'s class imported here).
 *
 * The duck-type check matches on the stable WERR identifier plus the
 * structured result arrays needed by the SDK WERR_REVIEW_ACTIONS
 * constructor.
 */
interface WerrReviewActionsLike {
  reviewActionResults: ReviewActionResult[];
  sendWithResults: SendWithResult[];
  txid?: TXIDHexString;
  tx?: AtomicBEEF;
  noSendChange?: OutpointString[];
}

function isWerrReviewActions(error: unknown): error is WerrReviewActionsLike {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as {
    name?: unknown;
    code?: unknown;
    reviewActionResults?: unknown;
    sendWithResults?: unknown;
    txid?: unknown;
    tx?: unknown;
    noSendChange?: unknown;
  };

  return (
    (e.name === 'WERR_REVIEW_ACTIONS' || e.code === 5) &&
    Array.isArray(e.reviewActionResults) &&
    Array.isArray(e.sendWithResults) &&
    (e.txid === undefined || typeof e.txid === 'string') &&
    (e.tx === undefined || Array.isArray(e.tx) || e.tx instanceof Uint8Array) &&
    (e.noSendChange === undefined || Array.isArray(e.noSendChange))
  );
}

function toSdkWerrReviewActions(error: WerrReviewActionsLike): WERR_REVIEW_ACTIONS {
  return new WERR_REVIEW_ACTIONS(
    error.reviewActionResults,
    error.sendWithResults,
    error.txid,
    error.tx,
    error.noSendChange,
  );
}

/**
 * The error body the BRC-100 HTTP bridge returns with status 400 (contract
 * §8.2, D22): `{ message, name?, code?, retryable?, transport? }`.
 *
 * - A non-`Error` throw gives `{ message: String(error) }`.
 * - `name` is read as an own or inherited property, never from
 *   `constructor.name`: Vite/esbuild minification mangles class names (see
 *   `isWerrReviewActions`). The BRC-207 module classes set `name` explicitly,
 *   and receivers match on it or on the `'[ClassName] '` message prefix.
 * - `code` is copied only when it is a string, `retryable` / `transport` only
 *   when they are booleans (`ColorProviderError`). Nothing else is copied: no
 *   stack, no `cause`.
 * - `isError` is never set: the sdk client treats a body with `isError` as a
 *   typed wallet-error envelope and rejects one whose `code` is not an integer.
 *
 * Pure and stateless, so a retried or concurrent failing call gets the same
 * body. A throwing property getter drops that field instead of failing the
 * response.
 */
export interface BridgeErrorBody {
  message: string;
  name?: string;
  code?: string;
  retryable?: boolean;
  transport?: boolean;
}

function readErrorField(error: Error, key: string): unknown {
  try {
    return (error as unknown as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return 'Unknown error';
  }
}

export function bridgeErrorBody(error: unknown): BridgeErrorBody {
  if (!(error instanceof Error)) return { message: safeString(error) };
  const rawMessage = readErrorField(error, 'message');
  const body: BridgeErrorBody = { message: typeof rawMessage === 'string' ? rawMessage : safeString(rawMessage ?? '') };
  const name = readErrorField(error, 'name');
  if (typeof name === 'string' && name !== '') body.name = name;
  const code = readErrorField(error, 'code');
  if (typeof code === 'string') body.code = code;
  const retryable = readErrorField(error, 'retryable');
  if (typeof retryable === 'boolean') body.retryable = retryable;
  const transport = readErrorField(error, 'transport');
  if (typeof transport === 'boolean') body.transport = transport;
  return body;
}

// Parse the origin header and turn it into a fqdn (e.g. projectbabbage.com:8080)
// Handles both origin and legacy originator headers
function parseOrigin(headers: Record<string, string>): string | null {
  const rawOrigin = headers['origin'];
  const rawOriginator = headers['originator'];

  // 1) Browser case
  if (rawOrigin) {
    try {
      return new URL(rawOrigin).host;
    } catch {
      return null;
    }
  }

  // 2) Node-injected fallback
  if (rawOriginator) {
    try {
      // Add scheme only if missing
      const candidate = rawOriginator.includes('://')
        ? rawOriginator
        : `http://${rawOriginator}`;
      return new URL(candidate).host;
    } catch {
      return null;
    }
  }

  return null;
}

// Module-level wallet ref — survives React effect cleanup/re-runs
let _currentWallet: WalletInterface | null = null;
let _listenerRegistered = false;
let _cancelListenerRegistered = false;

/** Test-only: read current wallet ref */
export function _test_getCurrentWallet(): WalletInterface | null { return _currentWallet; }
/** Test-only: read listener state */
export function _test_isListenerRegistered(): boolean { return _listenerRegistered; }
/** Test-only: reset module state */
export function _test_reset(): void {
  _currentWallet = null;
  _listenerRegistered = false;
  _cancelListenerRegistered = false;
}

/**
 * Update the wallet instance used by the HTTP listener.
 * First call also registers the IPC listener (once, never removed).
 */
/** Drop the previous network's wallet before its storage session is closed. */
export function clearWalletForHttpRoute(expectedWallet?: WalletInterface): void {
  if (!expectedWallet || _currentWallet === expectedWallet) _currentWallet = undefined
}

export const onWalletReady = async (
  wallet: WalletInterface
): Promise<(() => void) | undefined> => {
  _currentWallet = wallet;
  console.log('[onWalletReady] wallet ref updated, listenerRegistered:', _listenerRegistered);

  if (_listenerRegistered) return undefined;
  _listenerRegistered = true;

  console.log('[onWalletReady] registering IPC listener (once)');

  // When the HTTP client disconnects mid-call, drop matching permission modals.
  if (!_cancelListenerRegistered && typeof window.electronAPI.onHttpRequestCancelled === 'function') {
    _cancelListenerRegistered = true;
    window.electronAPI.onHttpRequestCancelled(async (event: { request_id: number; reason?: string }) => {
      try {
        const { getWalletService } = await import('./lib/hooks/useWalletService');
        await getWalletService().permissionQueue.cancelHttpBridgeRequest(event.request_id);
      } catch (err) {
        console.warn('[onWalletReady] failed to cancel permissions for abandoned HTTP request:', err);
      }
    });
  }

  // Register ONCE — never removed. Wallet ref swapped via _currentWallet.
  window.electronAPI.onHttpRequest(async (req: HttpRequestEvent) => {
    let response: HttpResponseEvent;
    let sessionStarted = false;

    const wallet = _currentWallet;
    if (!wallet || isHttpBridgePaused()) {
      response = {
        request_id: req.request_id,
        status: 503,
        body: stringifyWalletPayload({ message: isHttpBridgePaused() ? 'Wallet network is changing. Retry shortly.' : 'Wallet not ready' })
      };
      window.electronAPI.sendHttpResponse(response);
      return;
    }

    try {
      const origin = parseOrigin(req.headers);

      if (!origin) {
        response = {
          request_id: req.request_id,
          status: 400,
          body: stringifyWalletPayload({ message: 'Origin header is required' })
        };
        window.electronAPI.sendHttpResponse(response);
        return;
      }

      beginHttpBridgeSession(req.request_id, origin);
      sessionStarted = true;

      switch (req.path) {
        // 1. createAction
        case '/createAction': {
          try {
            const args = parseWalletPayload(req.body) as CreateActionArgs;
            const result = await wallet.createAction(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            if (isWerrReviewActions(error)) {
              const e = toSdkWerrReviewActions(error);
              console.error('createAction WERR_REVIEW_ACTIONS:', e);
              response = {
                request_id: req.request_id,
                status: 400,
                body: stringifyWalletPayload(e)
              };
            } else {
              console.error('createAction error:', error);
              response = {
                request_id: req.request_id,
                status: 400,
                body: stringifyWalletPayload(bridgeErrorBody(error))
              };
            }
          }
          break;
        }

        // 2. signAction
        case '/signAction': {
          try {
            const args = parseWalletPayload(req.body) as SignActionArgs;
            const result = await wallet.signAction(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            if (isWerrReviewActions(error)) {
              const e = toSdkWerrReviewActions(error);
              console.error('signAction WERR_REVIEW_ACTIONS:', e);
              response = {
                request_id: req.request_id,
                status: 400,
                body: stringifyWalletPayload(e)
              };
            } else {
              console.error('signAction error:', error);
              response = {
                request_id: req.request_id,
                status: 400,
                body: stringifyWalletPayload(bridgeErrorBody(error))
              };
            }
          }
          break;
        }

        // 3. abortAction
        case '/abortAction': {
          try {
            const args = parseWalletPayload(req.body) as AbortActionArgs;
            const result = await wallet.abortAction(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('abortAction error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 4. listActions
        case '/listActions': {
          try {
            const args = parseWalletPayload(req.body) as ListActionsArgs;
            const result = await wallet.listActions(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('listActions error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 5. internalizeAction
        case '/internalizeAction': {
          try {
            const args = parseWalletPayload(req.body) as InternalizeActionArgs;
            const result = await wallet.internalizeAction(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            if (isWerrReviewActions(error)) {
              const e = toSdkWerrReviewActions(error);
              console.error('internalizeAction WERR_REVIEW_ACTIONS:', e);
              response = {
                request_id: req.request_id,
                status: 400,
                body: stringifyWalletPayload(e)
              };
            } else {
              console.error('internalizeAction error:', error);
              response = {
                request_id: req.request_id,
                status: 400,
                body: stringifyWalletPayload(bridgeErrorBody(error)),
              };
            }
          }
          break;
        }

        // 6. listOutputs
        case '/listOutputs': {
          try {
            const args = parseWalletPayload(req.body) as ListOutputsArgs;
            const result = await wallet.listOutputs(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('listOutputs error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 7. relinquishOutput
        case '/relinquishOutput': {
          try {
            const args = parseWalletPayload(req.body) as RelinquishOutputArgs;
            const result = await wallet.relinquishOutput(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('relinquishOutput error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 8. getPublicKey
        case '/getPublicKey': {
          try {
            const args = parseWalletPayload(req.body) as GetPublicKeyArgs;
            const result = await wallet.getPublicKey(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('getPublicKey error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 9. revealCounterpartyKeyLinkage
        case '/revealCounterpartyKeyLinkage': {
          try {
            const args = parseWalletPayload(req.body) as RevealCounterpartyKeyLinkageArgs;
            const result = await wallet.revealCounterpartyKeyLinkage(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('revealCounterpartyKeyLinkage error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 10. revealSpecificKeyLinkage
        case '/revealSpecificKeyLinkage': {
          try {
            const args = parseWalletPayload(req.body) as RevealSpecificKeyLinkageArgs;
            const result = await wallet.revealSpecificKeyLinkage(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('revealSpecificKeyLinkage error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 11. encrypt
        case '/encrypt': {
          try {
            const args = parseWalletPayload(req.body) as WalletEncryptArgs;
            const result = await wallet.encrypt(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('encrypt error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 12. decrypt
        case '/decrypt': {
          try {
            const args = parseWalletPayload(req.body) as WalletDecryptArgs;
            const result = await wallet.decrypt(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('decrypt error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 13. createHmac
        case '/createHmac': {
          try {
            const args = parseWalletPayload(req.body) as CreateHmacArgs;
            const result = await wallet.createHmac(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('createHmac error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 14. verifyHmac
        case '/verifyHmac': {
          try {
            const args = parseWalletPayload(req.body) as VerifyHmacArgs;
            const result = await wallet.verifyHmac(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('verifyHmac error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 15. createSignature
        case '/createSignature': {
          try {
            const args = parseWalletPayload(req.body) as CreateSignatureArgs;
            const result = await wallet.createSignature(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('createSignature error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 16. verifySignature
        case '/verifySignature': {
          try {
            const args = parseWalletPayload(req.body) as VerifySignatureArgs;
            const result = await wallet.verifySignature(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('verifySignature error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 17. acquireCertificate
        case '/acquireCertificate': {
          try {
            const args = parseWalletPayload(req.body) as AcquireCertificateArgs;
            const result = await wallet.acquireCertificate(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('acquireCertificate error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 18. listCertificates
        case '/listCertificates': {
          try {
            const args = parseWalletPayload(req.body) as ListCertificatesArgs;
            const result = await wallet.listCertificates(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('listCertificates error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 19. proveCertificate
        case '/proveCertificate': {
          try {
            const args = parseWalletPayload(req.body) as ProveCertificateArgs;
            const result = await wallet.proveCertificate(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('proveCertificate error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 20. relinquishCertificate
        case '/relinquishCertificate': {
          try {
            const args = parseWalletPayload(req.body) as RelinquishCertificateArgs;
            const result = await wallet.relinquishCertificate(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('relinquishCertificate error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 21. discoverByIdentityKey
        case '/discoverByIdentityKey': {
          try {
            const args = parseWalletPayload(req.body) as DiscoverByIdentityKeyArgs;
            const result = await wallet.discoverByIdentityKey(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('discoverByIdentityKey error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 22. discoverByAttributes
        case '/discoverByAttributes': {
          try {
            const args = parseWalletPayload(req.body) as DiscoverByAttributesArgs;
            const result = await wallet.discoverByAttributes(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('discoverByAttributes error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 23. isAuthenticated
        case '/isAuthenticated': {
          try {
            const result = await wallet.isAuthenticated({}, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('isAuthenticated error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 24. waitForAuthentication
        case '/waitForAuthentication': {
          try {
            const result = await wallet.waitForAuthentication({}, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('waitForAuthentication error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 25. getHeight
        case '/getHeight': {
          try {
            const result = await wallet.getHeight({}, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('getHeight error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 26. getHeaderForHeight
        case '/getHeaderForHeight': {
          try {
            const args = parseWalletPayload(req.body) as GetHeaderArgs;
            const result = await wallet.getHeaderForHeight(args, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('getHeaderForHeight error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 27. getNetwork
        case '/getNetwork': {
          try {
            const result = await wallet.getNetwork({}, origin);
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload(result),
            };
          } catch (error) {
            console.error('getNetwork error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        // 28. getVersion
        case '/getVersion': {
          try {
            const result = await wallet.getVersion({}, origin);
            // Toolbox appends BRC-205 capabilities ("base; key=value;"), but every published SDK
            // WalletClient rejects a version longer than 30 characters while probing for a wallet
            // (WalletResultValidation getVersion), so apps never connect. Answer the base only.
            const version = String(result.version).split(';')[0].trim();
            response = {
              request_id: req.request_id,
              status: 200,
              body: stringifyWalletPayload({ ...result, version }),
            };
          } catch (error) {
            console.error('getVersion error:', error);
            response = {
              request_id: req.request_id,
              status: 400,
              body: stringifyWalletPayload(bridgeErrorBody(error)),
            };
          }
          break;
        }

        default: {
          response = {
            request_id: req.request_id,
            status: 404,
            body: stringifyWalletPayload({ error: 'Unknown wallet path: ' + req.path }),
          };
          break;
        }
      }

      // Send response back to main process
      window.electronAPI.sendHttpResponse(response);
    } catch (e) {
      console.error("Error handling http-request event:", e);
      response = {
        request_id: req.request_id,
        status: 500,
        body: stringifyWalletPayload({ error: String(e) })
      };
      window.electronAPI.sendHttpResponse(response);
    } finally {
      if (sessionStarted) {
        endHttpBridgeSession(req.request_id);
      }
    }
  });

  // No cleanup — listener is permanent
  return undefined;
};
