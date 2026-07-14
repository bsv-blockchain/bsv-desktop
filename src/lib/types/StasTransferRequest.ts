/**
 * Permission request shape for the `/stas/transfer` HTTP route on the
 * wallet's Apps API (port 3321).
 *
 * Each external `POST /stas/transfer` call enqueues one of these. The
 * `StasTransferPermissionHandler` modal pops up in the wallet UI showing
 * the request, the user clicks Approve or Deny, and the route handler
 * resolves with the boolean. Only on `true` does
 * `StasTransferService.transfer` actually run.
 */
export interface StasTransferRequest {
  /** Internal id used to match approve/deny back to a pending request. */
  requestId: string;
  /** Origin of the caller (e.g. `http://localhost:8090`). */
  originator: string;
  /** Source UTXO outpoint, `<txid>.<vout>`. */
  outpoint: string;
  /** Token symbol if known (classic STAS extracted it from OP_RETURN). */
  symbol: string | null;
  /** Token id (CreateContract txid for classic STAS). */
  tokenId: string | null;
  /** Satoshis on the UTXO. */
  satoshis: number;
  /** Where the STAS is being sent. */
  recipient: string;
  /** BRC-42 key id that owns the source (e.g. `recv 7`). */
  brc42KeyId: string | null;
  /** Resolver invoked by the modal when the user clicks Approve / Deny. */
  resolve: (approved: boolean) => void;
}
