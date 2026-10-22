# Direct (peer-to-peer) payments over WebRTC — design

Status: draft for review (amended after implementation review — see §12) · Author: Claude (autonomous session for @sirdeggen) · Date: 2026-10-17

Repos touched:

| Repo | Branch / location | What |
| --- | --- | --- |
| `WebRTPay` | branch `v2` | Prototype of the reusable package `@bsv/webrtpay` (rewrite; old code kept in git history) |
| `ts-stack` | branch `feat/webrtpay`, `packages/messaging/webrtpay` | Same package ported — draft PR only, never published from here |
| `bsv-desktop` | branch `feat/webrtc-direct-payments` | Wallet integration (this document lives here, as `docs/webrtc-direct-payments-design.md`) |
| `bsva-infra-flux` | branch `feat/webrtc-turn` | STUN (coturn) manifests — draft PR only; merging deploys to production |

## 1. The one correction that shapes everything

The request assumed STUN servers can coordinate two parties into a WebRTC channel. They cannot.

- STUN (RFC 8489) only tells a client its own public address ("STUN is not a NAT traversal solution by itself"). It carries no messages between parties.
- To open a channel, each side must learn the other's ICE username fragment and password, its DTLS certificate fingerprint and its candidate addresses (RFC 8445 §5.3, §7.2.2: connectivity checks are keyed by the *peer's* password). That is the SDP offer and answer, and it has to travel **both ways** over some channel that already works ("signaling").
- TURN (RFC 8656) relays the *data* when two NATs cannot be punched (typical on mobile carrier networks). It does not carry signaling either.
- Verified locally: a node-datachannel peer that never receives the answer stays in `checking` forever; the answerer gives up after ~15 s (Chromium) / ~31 s (libdatachannel). The experimental WebRTPay hit exactly this ("single-QR trickle is a deadlock", `HTTP_SIGNALING_COMPLETE.md`).

So "no server" is achievable for the **payment data** in every case (end-to-end encrypted; a TURN server may relay the encrypted bytes when no direct path exists), and for **signaling** only when the two people can exchange two codes directly (in the same room, by QR). For remote payments some rendezvous must carry ~1 KB of encrypted offer/answer. This design makes signaling a plug-in so that choice can change without touching the payment path.

## 2. Goals, non-goals, anti-goals

Goals

1. A second transport for BSV Desktop identity payments that delivers the **unchanged** PeerPay data (`PaymentToken`: AtomicBEEF + derivation prefix/suffix + amount + output index) directly to the recipient over an encrypted WebRTC data channel. MessageBox stays and remains the default.
2. The payment never touches, and is never stored on, any server (end-to-end encrypted; a TURN server may relay the encrypted bytes when no direct path exists).
3. A reusable, isomorphic TypeScript package (`@bsv/webrtpay`) that any wallet or app (browser, Electron, Node, React Native via an injected `RTCPeerConnection`) can use, ready to land in ts-stack.
4. Peer identity is cryptographically bound to the channel, so a malicious signaling path cannot read or alter payments.
5. STUN (and later TURN) on BSVA infrastructure so we do not depend on Google's public STUN.

Non-goals (this round)

- Store-and-forward. Direct delivery needs both wallets online at the same moment; offline recipients keep using MessageBox.
- Token (BTMS) transfers, refunds, and payment-request *UI* over the direct path (the request message types are carried and validated by the package; the desktop UI wires payments first).
- Production TURN relay deployment (phase 2, see §8). (The WebSocket *signaling* relay is in scope; see §3.2.)
- Publishing to npm or deploying to clusters (operator steps).

Anti-goals (would make this a failure even if it "works")

- A payment that can be withheld, replayed or redirected by whoever relays signaling.
- Two different payment formats for the same payment (MessageBox and direct must carry the same `PaymentToken`).
- Silently losing a payment: a prepared payment must stay retryable over either transport; a received one must not depend on browser storage surviving logout.
- An open TURN relay (static credentials baked into the app).

## 3. Architecture

```
┌──────────────── @bsv/webrtpay (browser-safe root entry) ───────────────────────┐
│ codecs/      compact SDP codec, invite/answer codes (webrtpay1:…)              │
│ channel/     PeerLink: RTCPeerConnection + one reliable data channel,           │
│              16 KiB chunk framing, backpressure, timeouts                       │
│ session/     identity handshake (signed DTLS fingerprints) → AuthenticatedPeer │
│ payments/    PaymentToken wire codec + validators, ack, request types,          │
│              acceptDirectPayment() (verify output → internalizeAction)          │
│ signaling/   Signaler interface; CodeExchange (QR/paste, serverless);           │
│              MessageBoxSignaler (structural adapter, no dependency);            │
│              RelaySignaler (WebSocket client)                                   │
│ client/      DirectPayClient: listen(), sendPayment(), invites                 │
└────────────────────────────────────────────────────────────────────────────────┘
┌──── @bsv/webrtpay/server (Node only) ────┐
│ relay: stateless WebSocket rendezvous +   │   P1 — optional plug-in, no storage
│ ephemeral TURN credentials (coturn REST)  │
└───────────────────────────────────────────┘
```

### 3.1 Roles and flows

Payer = the party sending BSV. Payee = the party receiving.

**Connect first, then pay (decision, my call).** Today's MessageBox path prepares and broadcasts, then delivers; a failed delivery is harmless because MessageBox stores the token. A direct delivery fails whenever the payee is offline, so the payer must not spend before the channel exists. The direct path therefore **connects and authenticates first**, and only then prepares, persists, broadcasts and sends. If connecting fails, nothing was spent.

**Remote, by identity key (MessageBox or relay signaling)**

1. Payer creates a `PeerLink` (offerer), gathers ICE (non-trickle, ≤5 s), and sends an encrypted `offer` envelope to the payee's identity key through the signaler.
2. Payee's wallet (direct receive enabled, listening while unlocked) answers automatically, subject to its inbound limits (§6), with an encrypted `answer` envelope.
3. Channel opens; both run the identity handshake (§4). The payer pins the expected payee key; the payee learns the payer key from the handshake. Connect + handshake budget: 30 s.
4. Payer prepares the payment exactly as today (`prepareMessageBoxPayment`: noSend tx, persisted to the outbox with `via: 'direct'` before anything else), broadcasts it (`sendWith`) as today, then sends `payment` with the `PaymentToken`.
5. Payee validates it, checks the output pays its derived key, records it (idempotency), internalizes it, and replies `payment.ack` with `accepted` (or `received` if internalize must be retried locally, or `rejected` with a reason).
6. Payer marks the outbox row `delivered`. If the channel drops after broadcast but before the ack, the row stays pending and "Retry delivery" offers both transports with the same transaction: direct (re-dial) or MessageBox (store-and-forward, works while the payee is offline).

**Face to face, no server (code exchange)**

1. Payee creates a direct request: a `webrtpay1:` **offer code** (QR) containing their identity key, network, optional amount, a session id and their compact SDP offer. The offer can wait for minutes while the screen stays open.
2. Payer scans it, reviews the amount, and shows an **answer code** (QR).
3. Payee scans the answer within ~15 s (the answerer's ICE timer). Channel opens and the handshake runs.
4. Payer's wallet then prepares, persists, broadcasts and sends; payee accepts and acks, as above.
5. Recovery: if the channel drops after the broadcast, the payer's row stays pending. When the payer next scans an offer code from the **same payee identity**, the app offers to deliver that saved payment (same transaction) instead of creating a new one. MessageBox retry also works if both have one.

The payee is the offerer in code exchange on purpose: the offer may wait; the answer must be applied promptly, and the payee is the one actively scanning at that moment. Copy/paste over chat is supported by the codec but will usually miss the 15 s window — the UI says so.

### 3.2 Signaling plug-in

```ts
interface Signaler {
  /** Send an opaque, already-encrypted envelope to a peer identity. */
  send (to: PubKeyHex, envelope: SignalEnvelope): Promise<void>
  /** Receive envelopes addressed to us. `from` is the identity asserted by the carrier. */
  listen (handler: (from: PubKeyHex, envelope: SignalEnvelope) => void): Promise<() => Promise<void>>
}
```

Implementations:

| Signaler | Server? | Use |
| --- | --- | --- |
| Code exchange (`createOfferCode` / `answerOfferCode` / `completeWithAnswerCode`) | none | in person, QR |
| `MessageBoxSignaler` | existing MessageBox (live WebSocket, box `webrtpay_signals`) | remote, zero new infra; payment still P2P |
| `RelaySignaler` + `@bsv/webrtpay/server` | tiny stateless relay we host | remote without MessageBox; also vends TURN credentials (P1) |

`MessageBoxSignaler` is typed structurally against the `MessageBoxClient` methods it uses, so the package has no dependency on `@bsv/message-box-client`:

- **send**: `sendMessage({ recipient, messageBox: 'webrtpay_signals', body })` over HTTP. This resolves the *recipient's* host through the overlay (the same anointment lookup payments use today), so it works when payer and payee use different MessageBox servers. `sendLiveMessage` is not used for sending because it emits on the sender's own host socket and silently strands the message when hosts differ.
- **listen**: poll `listMessages({ messageBox: 'webrtpay_signals' })` (payee: every 2.5 s while direct receive is enabled; payer: every 1 s while a dial is in progress), dedupe by `messageId`, `acknowledgeMessage` each one immediately after reading it so nothing lingers on the server. HTTP-delivered messages are not pushed over the live socket, so polling is the mechanism; latency is a few seconds. The relay is the low-latency option.

**Relay (in scope this round, built after code exchange and MessageBox signaling work).** `@bsv/webrtpay/server` is a stateless WebSocket rendezvous: no storage, no logs of payloads.

- Authentication: on connect the server sends `{ t: 'challenge', nonce }`; the client answers `{ t: 'auth', identityKey, signature }` with `wallet.createSignature({ data: utf8("webrtpay-relay/1|" + relayUrl + "|" + nonce), protocolID: [2, 'webrtpay relay'], keyID: nonce, counterparty: 'anyone' })`; the server verifies with a `ProtoWallet('anyone')`. Only then may the socket send or receive, and `from` on every forwarded envelope is the authenticated key.
- Routing: `{ t: 'signal', to, envelope }` → forwarded to every live socket of `to`, or `{ t: 'error', code: 'offline' }`.
- Limits: 16 KiB per envelope, 10 s to authenticate, token-bucket rate limit per socket (20 messages / 10 s), 5 sockets per identity, global socket cap, ping/pong idle timeout.
- TURN credential vending: if configured with a coturn `static-auth-secret`, the server sends authenticated sockets `{ t: 'ice', iceServers }` with REST credentials (`username = "<expiry>:<identityKey>"`, `credential = base64(HMAC-SHA1(secret, username))`, TTL 1 h).

**Decision (my call): BSV Desktop defaults to MessageBox signaling for remote direct payments when a message box is configured, and code exchange in person.** Reasoning: it needs no new infrastructure, both of your test machines already have it, and the payment itself still never touches the server (end-to-end encrypted; a TURN server may relay the encrypted bytes when no direct path exists). The server sees an encrypted ~1 KB offer/answer, which it stores until acknowledged; the signaler acknowledges immediately. The relay is the path to "no MessageBox at all" and ships behind the same interface.

### 3.3 Signal envelopes

Plaintext (JSON), encrypted end-to-end before it reaches any carrier:

```json
{ "v": 1, "kind": "offer|answer|reject", "sid": "<16 random bytes, base64url>",
  "from": "<identity key>", "to": "<identity key>", "ts": 1792240000000,
  "purpose": "payment", "sdp": "<compact SDP code>", "reason": "<reject only>" }
```

Encryption: `wallet.encrypt({ protocolID: [2, 'webrtpay signaling'], keyID: sid, counterparty: to })` (BRC-2). Carried as `{ "v": 1, "sid": "…", "ciphertext": "<base64>" }`. The receiver decrypts with `counterparty = from` (carrier-asserted), then requires `from`/`to` inside the plaintext to match, `|now − ts| ≤ 120 s`, and an unseen `sid` (replay cache). Even if every check here were bypassed, §4 still stops a man in the middle; these checks keep junk out early.

### 3.4 Data channel

- One channel, label `webrtpay/1`, created by the offerer, **ordered and fully reliable** (no `maxRetransmits` / `maxPacketLifeTime` — the experimental code used `maxRetransmits: 3`, which can drop payments).
- Binary frames: `[version u8 = 1][flags u8 (bit0 = final)][message sequence u32 BE][payload]`. Each JSON message is split into ≤16 KiB chunks (RFC 8831 §6.6 safe size; Chromium and libdatachannel advertise 256 KiB max, werift 64 KiB). Reassembly enforces in-order sequence numbers and a total cap (default 32 MiB, configurable). Sending honours `bufferedAmountLowThreshold`.
- Gathering is non-trickle (`iceGatheringState === 'complete'` or 5 s, whichever first) so each side sends exactly one description. Handshake timeout 15 s; whole delivery timeout 45 s by default.

### 3.5 Codes for QR

`webrtpay1:<base64url>` with a binary body: version, kind (offer/answer), session id, identity key (33 bytes), optional network and amount, expiry, then the SDP in a compact form (ufrag, pwd, 32-byte sha-256 fingerprint, setup role, max-message-size, UDP candidates as type + address + port; mDNS `.local` names as 16 raw UUID bytes). The decoder rebuilds a standard SDP from a template. A prototype of this codec connected node-datachannel peers and was accepted by Chromium as both offer and answer; a typical offer is ~130 bytes / ~175 characters (QR version 8 at level L) versus ~750 characters for deflated SDP. If an SDP has anything the compact form cannot represent, the codec falls back to the raw UTF-8 SDP text (flagged), so encoding never fails (amended: deflate would make the codec asynchronous; the UI offers copy/paste for dense codes). Answer codes carry no identity key — the payee learns the payer from the authenticated handshake; offer codes carry the payee's key so the payer can pin it.

## 4. Identity binding (security core)

After the channel opens, each side sends `hello { identityKey, nonce (32 random bytes) }`, then `auth { signature }` where the signature covers

```
"webrtpay/1 channel-binding" ‖ fp(signer) ‖ fp(verifier) ‖ nonce(signer) ‖ nonce(verifier) ‖ key(signer) ‖ key(verifier)
```

with `fp` = the sha-256 DTLS fingerprint from that side's SDP (local for the signer, remote for the verifier; normalised lowercase hex; multiple fingerprints sorted and joined), signed with `wallet.createSignature({ protocolID: [2, 'webrtpay channel'], keyID: nonce(signer), counterparty: key(verifier) })` and checked with `verifySignature` (`counterparty: key(signer)`).

- A man in the middle must terminate DTLS separately with each side, so each side sees a different remote fingerprint; neither signature verifies, and the session is closed before any payment byte is sent.
- The dialer pins the identity it intended to pay; a different key closes the session.
- Messages other than `hello`/`auth`/`ready` before verification are a protocol error. Each side, after verifying the peer, raises its message cap from the pre-auth 64 KiB to the configured maximum and sends `{ t: 'ready' }`; a session is usable only after its own verification and the peer's `ready` (prevents payment frames racing the pre-auth cap).
- DTLS provides confidentiality and integrity after that, so individual messages are not signed again. libdatachannel's `disableFingerprintVerification` is never set.
- `PaymentToken` has no sender field; the payee takes the sender from the authenticated handshake, exactly as MessageBox takes it from its authenticated envelope.

Funds safety does not depend on any of this: a payment is only accepted if output `outputIndex` pays P2PKH of the key derived with `protocolID [2, '3241645161d8']`, `keyID "<prefix> <suffix>"`, `counterparty = sender`, `forSelf: true`. A wrong sender just fails that check.

## 5. Payment messages (unchanged data types)

The package re-declares (structurally identical, no import) `PaymentToken`, `IncomingPayment`, `PaymentRequestNew`, `PaymentRequestCancellation`, `PaymentRequestMessage`, `PaymentRequestResponse`, `IncomingPaymentRequest`. Decision (my call): redeclare rather than depend on `@bsv/message-box-client`, to keep the browser bundle small and avoid a first-party runtime dependency in the tarball. A type-level test asserts they stay assignable to message-box-client's.

Wire messages (JSON inside frames):

| `t` | Body | Notes |
| --- | --- | --- |
| `hello`, `auth` | §4 | |
| `payment` | `{ id, token: { customInstructions: { derivationPrefix, derivationSuffix }, transaction: <base64 AtomicBEEF>, amount, outputIndex } , note? }` | `transaction` is base64 on the wire and `number[]` in the `PaymentToken` handed to the app |
| `payment.ack` | `{ id, status: 'accepted' \| 'received' \| 'rejected', txid?, reason? }` | |
| `request` | `PaymentRequestMessage` | same validation as PeerPayClient (proof is HMAC `[2,'payment request auth']`, keyID requestId, data `requestId + recipient`) |
| `request.response` | `PaymentRequestResponse` | |
| `error`, `bye` | `{ code, message }` / `{}` | |

Validation mirrors `PeerPayClient.normalizePaymentToken`: canonical keys, transaction 1 byte…32 MiB AtomicBEEF, positive safe-integer amount, `outputIndex` uint32 (default 0), base64 derivation strings ≤ 400 chars, note ≤ 500 chars.

`acceptDirectPayment(wallet, incoming, { originator, labels, description, seen })` — validates, derives and checks the output script/amount, consults the idempotency store (`txid` + derivation pair), then calls

```ts
wallet.internalizeAction({ tx, outputs: [{ outputIndex, protocol: 'wallet payment',
  paymentRemittance: { senderIdentityKey, derivationPrefix, derivationSuffix } }],
  labels: ['peerpay', 'direct', 'inbound'], description: 'Received direct BSV' }, originator)
```

(`PeerPayClient.acceptPayment` cannot be reused: it re-fetches the message from the MessageBox server.)

Payee auto-accepts direct payments (decision, my call): unlike MessageBox there is no server copy to come back to, so a payment held only in renderer `localStorage` could be lost on logout. Accepting immediately makes "delivered" mean "in the payee's wallet". A failed internalize keeps the token in a local retry list (preserved across logout and wallet removal; see §6 and §12) and acks `received`.

## 6. BSV Desktop integration

- **Service**: `DirectPayManager` (mirrors `PeerPayManager`: `EventEmittable` + `useSyncExternalStore`), created in `WalletService._buildWallet` beside `peerPay.createClient` and torn down at the same four sites. It owns the `DirectPayClient`, keeps listening while the wallet is unlocked (not only while the Payments page is mounted), auto-accepts, emits `balance-changed`.
- **Settings** (device-local, `localStorage['bsv-desktop-direct-pay-v1']`): *Receive direct payments* (**off by default** — answering reveals your public IP address to the payer, and anyone who knows your identity key can try to connect); signaling `messagebox` | `relay`; relay URL; STUN URLs (default `stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478` until BSVA STUN is live); optional TURN URL/username/credential for testing. Sending directly needs no setting. UI: a `DirectPayConfig` card next to `MessageBoxConfig` in Advanced settings.
- **Inbound limits** (payee side, enforced in the package): at most 3 concurrent inbound sessions, 10 offers per minute overall and 3 per minute per sender, inbound message cap 16 MiB, session idle timeout 60 s. Offers beyond the limits are rejected without gathering ICE (no IP disclosed).
- **Send**: for identity recipients, a "Delivery" choice — *Message box* (default) or *Direct (peer-to-peer)*. Direct connects first (§3.1); if the payee cannot be reached nothing is spent and the error suggests Message box. The outbox row gains `via?: 'messagebox' | 'direct'`; "Retry delivery" offers both.
- **Receive**: shows whether direct payments are online and how (MessageBox signaling / relay).
- **Nearby**: a "Direct (WebRTC)" mode next to the existing animated-QR flow, using offer/answer codes (§3.1).
- **Persistence hazard fixed**: on **logout**, `_clearLocalWalletState` preserves `peerpay-outbox-v1:*`, `nearby-payment-v1:*`, `bsv-desktop-direct-pay-v1` and the direct retry/idempotency keys, so a logout cannot orphan an undelivered or unaccepted payment (today it wipes the MessageBox outbox too). On **remove wallet from this device** everything else is wiped as before — the user asked to scrub the device (decision, my call) — **except acknowledged-but-not-yet-added incoming direct payments** (`direct-pay-retry-v1:<identity>:<chain>`): their payers were told the payment arrived and will not resend it, and only this device has their derivation, so wiping them would strand the funds. They are keyed by identity and network, so the same wallet opened here again adds them and no other wallet sees them; the remove dialog says how many are waiting and their total. (Amended after the final review; the wallet database files stay on disk on removal anyway.)
- **Consuming the package**: `@bsv/webrtpay` was vendored as a tarball under `vendor/` until it was published; it is now the npm release (`^0.2.1`).
- **Testing aid**: `BSV_DESKTOP_USER_DATA=/path` env var sets Electron `userData` before `ready`, so two wallets can run on one machine (ports 2121/3321 already fail soft with `EADDRINUSE`).
- Payments UI stays English (it is untranslated today); new `t()` keys in Settings get all 12 locales.

## 7. Package: `@bsv/webrtpay`

- Name and location (my call): `@bsv/webrtpay` at `ts-stack/packages/messaging/webrtpay` — keeps the name of the experimental project. Version 0.1.0, `status: experimental`.
- Root entry is browser-safe: no Node builtins, `RTCPeerConnection` from an injected factory or `globalThis`. `@bsv/sdk` is a peer dependency (`^2.8.6 || ^3.0.0`; BSV Desktop pins 2.8.11), zero other runtime dependencies in the root entry. `./server` (Node) depends on `ws`.
- Tests: jest (ESM), `node-datachannel/polyfill` as a devDependency for real two-peer tests bound to `127.0.0.1`, fast-check property suites for the codecs and frame parser (adversarial peer input), optional coturn TURN test in Docker (`RUN_TURN_TESTS=1`).
- Prototype first in the `WebRTPay` repo (branch `v2`); then the same files go into ts-stack with the governance registrations (projects.json, baselines, release notes, docs page, test-governance property/mutation entries, count bumps) in a draft PR opened under a BotBoard handle.

## 8. Infrastructure

- **Phase 1 (this PR): STUN** — `coturn/coturn` in STUN-only mode on **bsva-us-1** (the cluster with every MessageBox network), UDP+TCP 3478 behind an internet-facing NLB (teranode `p2p-nlb` annotation pattern, not Traefik's typo), DNS `stun-${app_suffix}.bsvb.tech` via the Route53 external-dns (Cloudflare tunnels cannot carry UDP). Hardened pod (non-root, read-only root fs, drop ALL caps), pinned image, resource limits. Draft PR; merging deploys.
- **Phase 2: TURN — decided (2026-10-18): Cloudflare managed TURN, credentials minted by the WebRTPay relay** (`TURN_PROVIDER=cloudflare`; decision record and prepared wiring in bsv-blockchain/bsva-infra-flux#427). Self-hosted coturn on bsva-us-1 was ruled out as built: the workers are private behind one NAT gateway, so packets coturn sends first from a relay port would leave from the NAT gateway rather than the TURN address and be dropped by exactly the restrictive NATs TURN is for; only one Elastic IP is free and an NLB caps at 50 listeners. The coturn REST credential format (`<expiry>:<pseudonym>`, HMAC-SHA1) applies only to the coturn provider used for local tests and self-hosting. Enable Cloudflare mode only after clients that read `ice.expiresAt` have shipped. Locally, `docker compose` in the package runs coturn (STUN+TURN, REST credentials) for end-to-end tests.
- **Relay (P1)**: image and manifests prepared but not added to a cluster until the image is published from ts-stack.

## 9. Testing and verification

| Layer | How | Proves |
| --- | --- | --- |
| Codecs, frames, envelopes, validators | jest unit + fast-check | round trips, rejects malformed/oversized input |
| Handshake | jest with `ProtoWallet`s | binding works; swapped fingerprints / wrong key / replayed nonce fail |
| Two real peers | node-datachannel loopback | offer/answer, chunked 1 MiB+ BEEF, ack, timeouts |
| Signalers | fake MessageBox client, real relay server over `ws` | end-to-end dial-by-identity without a browser |
| TURN | coturn in Docker, `iceTransportPolicy: 'relay'` | relayed path + ephemeral credentials |
| Desktop logic | vitest on pure modules + node-datachannel | send/receive/outbox/idempotency/settings |
| Desktop UI | launch the app, smoke the settings and pages | renders, signaler connects |

Known gap: this sandbox drops UDP to non-loopback addresses, so Electron-to-Electron across a real network can only be verified by you (handoff recipe in `docs/webrtc-direct-payments-testing.md`).

## 10. Decisions made without you (please check)

1. MessageBox carries signaling for remote direct payments by default (HTTP send to the recipient's host + polling); code exchange in person; relay built this round as the no-MessageBox option.
2. Signed-fingerprint channel binding rather than a full BRC-103 `Peer` over the data channel (BRC-103 alone authenticates messages but does not bind them to the DTLS session, so a relaying MITM could still read payments).
3. Direct path connects and authenticates before spending anything.
4. Payee auto-accepts direct payments.
5. Direct receive is opt-in (off by default) with inbound limits.
6. Payee is the offerer in code exchange.
7. Package named `@bsv/webrtpay`, types redeclared (not imported) from message-box-client; desktop consumes a committed tarball until it is published.
8. Logout preserves payment outboxes; removing the wallet wipes them, but keeps acknowledged-but-not-yet-added incoming direct payments (amended after the final review: wiping those would strand funds the payer was told had arrived).
9. STUN-only on bsva-us-1 first; TURN later.
10. Prototype in the WebRTPay repo, then port to ts-stack (avoids holding a BotBoard lease for a whole day).

## 11. Questions only you can answer

1. Is MessageBox-carried signaling acceptable as the default remote path, or should remote direct payments wait for our own relay?
2. Should direct payments be auto-accepted, or land in the inbox for a click like MessageBox payments?
3. TURN: self-hosted coturn (needs an EIP and an NLB with a narrow port range) or Cloudflare's managed TURN? Decided 2026-10-18: Cloudflare (see §8); override if you disagree.
4. Package name `@bsv/webrtpay` OK?


## 12. Amendments after implementation and security review

An adversarial audit (crypto, privacy, abuse lenses; 21 verified findings) and per-task reviews changed these points. The package README and `docs/protocol.md` in WebRTPay `v2` are the byte-level reference.

- **Relay hardening.** Per-source-IP (/64 and coarser /48 for IPv6) socket and connection-rate limits, sockets that keep sending over the rate are closed, a per-(source, recipient) forwarding share (6/min) under a per-recipient total (120/min), envelope cap 24672 bytes (fits the 16384-char SDP after encryption), (client IP from `TRUSTED_IP_HEADER`, e.g. `cf-connecting-ip` behind Cloudflare), unauthenticated-socket cap, write-buffer cap with ping/pong liveness, per-recipient forwarding budget, envelope and frame size checks before parsing. The relay refuses to start in production mode without `PUBLIC_URLS`.
- **TURN credentials** are no longer pushed at authentication. A socket asks with `{ t: 'turn' }`; issuance is rate-limited per source IP (6/h) and globally (600/h), TTL 600 s, and the username is `<expiry>:<pseudonym>` (HMAC of the identity key — no raw key on the wire or in coturn logs). `DirectPayClient` takes an `iceServersProvider` consulted before each ICE gather. Phase-2 TURN still needs coturn quotas (`--total-quota`, `--max-bps`, `--denied-peer-ip` …) because free identities bypass `--user-quota`.
- **Inbound limits** are sender-first: one concurrent session per sender, refusals answered within a 1/s budget (silent otherwise), slot released as soon as a connect fails, 60 s first-message timeout after `ready` (raised from 15 s: the payer spends and broadcasts after connecting, which can include a wallet prompt).
- **Payer-side validation.** `validatePaymentToken` and `MAX_DIRECT_TRANSACTION_BYTES` let the payer refuse an invalid or oversize payment before broadcasting; `AuthenticatedPeer.isOpen` lets it re-check the session right before broadcasting. PeerLink refuses SDPs without exactly one sha-256 fingerprint.
- **Parser bounds.** JSON structural-token cap (4096) in addition to depth, signal ciphertext cap before decryption, bounded MessageBox listing and batched acks with a per-poll deadline, replay cache entries kept for their whole freshness window.
- **Privacy.** Electron installs a permission-check handler so Chromium hides host candidates behind mDNS (before, raw LAN IPv4 and global IPv6 went into every offer, answer and QR code). Amended 2026-10-20: mDNS names alone often failed between two computers on one network (the peer could not resolve them and the router did not hairpin), so the "Connect directly on the same network" setting, on by default, sets the window's WebRTC IP handling policy to `default_public_and_private_interfaces`: offers carry the default-route LAN IPv4 and IPv6 address (never VPN or virtual adapters, because the media check stays denied), sealed to the counterparty in signals and in clear in face-to-face codes. Off restores mDNS-only offers. Disclosure text: while direct receive is on, any wallet that knows your identity key can learn your public IP address and when your wallet is unlocked by starting a connection, without paying; dialing reveals the payer's IP to the payee; carriers (MessageBox, relay, Cloudflare) see identity keys, IPs, timing and sizes, never the payment. The relay's `offline` reply is a known presence oracle kept for fast dial failure.
- **Receive screen only, BSVA STUN, 1 MB (2026-10-21).** Live payments are answered only while the Payments page's Receive tab is showing (`DirectPayManager.openReceiveScreen`); opening and closing it starts and stops receiving on the same client, so a payment being sent keeps its connection. The rest of the time no dial is answered and the wallet holds no relay socket, so the presence oracle, the ring and the SDP answer show nothing; payers fall back to the message box. The default STUN list is `stun:stun-us-1.bsvb.tech:3478` only (stored settings holding exactly the previous default list are read with the new one), and STUN urls in the relay's TURN answer are dropped. Live sessions carry payments only (no payment request handler), and an authenticated peer may send at most `MAX_LIVE_MESSAGE_BYTES`, a payment with a 1 MB transaction (`MAX_LIVE_TRANSACTION_BYTES`); a larger outgoing payment is released before anything is spent and offered to the message box.
- **Payee never discards a valid payment.** A payment that verifies against the payee's derived key is accepted even if its amount differs from an offer; the UI shows the difference. Internalize failures are kept for retry only when transient (wallet locked, storage/network down); malformed payments are rejected and nothing is stored.
- **Protocol IDs** `[2,'webrtpay channel' | 'webrtpay signaling' | 'webrtpay relay']` are ordinary BRC-43 protocols; wallets should prompt other originators before signing under `webrtpay channel`, and auto-answering wallets use their own admin originator.
- **Network binding (final review).** An identity key is the same on every network, so a dial by identity key is bound to the wallet's network: offers and answers name the client's chain, a payee refuses an offer from another network (or one that names none) with a sealed reject (`wrong_network`) before gathering ICE, and the payer refuses such an answer before applying it. The payer is told "The recipient's wallet is on a different network. Nothing was spent." Desktop also signals through one message box per network (`webrtpay_signals` on Mainnet, `webrtpay_signals_<chain>` elsewhere), so one network's dials are not even delivered to another. Builds from before this cannot pay, or be paid by, these directly.
- **Kept payments are never lost (final review).** A payment acked `received` (kept because the wallet could not take it then) leaves the retry list only when the wallet has it: not on wallet removal (§6), and not by giving up. After 5 failed tries over more than a day, or a definite refusal, it is flagged as needing attention, retried less often, and the Payments page offers "Copy recovery details" (txid, Atomic BEEF, derivation, sender, amount); once they were copied the user may dismiss it, after a confirmation (only the user, and only a flagged payment, can remove one). Flagged payments do not count towards the 50-payment limit (the size budget still bounds the list). A kept list the device cannot read is never written over, and entries it does not recognise are passed through unchanged: while it cannot be read, a payment the wallet cannot take at once is refused, so its payer keeps it. While a wallet is open its kept payments are retried after 60 s, backing off to 15 minutes, and at once when the network comes back, one wallet call at a time (a wallet operation per call, at most 15 s) and never while the wallet is busy. A pass starts no payment once 15 s have passed, and Lock, a switch or removal asks it to stop at its next payment; their refusal names the background retry when it alone holds the wallet. A payment that arrives during a network or profile switch is kept rather than refused. Screens and notices say "added to your wallet" only for an accepted payment; a kept one is "received, not yet added" and not shown as a success.
