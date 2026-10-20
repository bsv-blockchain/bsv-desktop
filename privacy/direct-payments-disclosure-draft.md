# Direct payments: what each service can see

**Status:** DRAFT FOR COUNSEL REVIEW. Not legal text. Do not publish until counsel signs off.
**Scope:** BSV Desktop push payments, live (WebRTC) and through the message box. These are bsv-desktop#133 and #134, which are not yet released.
**Prepared:** 2026-10-20 from the code and production manifests. Every claim is traced to source; see Part 4.

This document has three parts:
1. A data-flow table for review.
2. Proposed policy text in the house style of the wallet Privacy Policy (`bsv-wallet/docs/privacy.html`).
3. Open facts that have to be confirmed before the text is final.

---

## Part 1: data-flow table

"Sees" means what the operator can technically observe while providing the service. "Keeps" means what our code stores or logs. We cannot speak for third-party operators' own logs.

| Service (operator) | When it is used | Sees | Never sees | Keeps | You can turn it off |
|---|---|---|---|---|---|
| **Signalling relay** `webrtpay-relay-us-1.bsvblockchain.tech` (BSVA, US, behind Cloudflare) | The whole time the wallet is unlocked with receiving on (default). Also when sending a live payment. | <ul><li>The identity key of each connected wallet</li><li>Its IP address</li><li>How long it is connected ("online")</li><li>How many devices are connected per identity key</li><li>For each connection attempt: both identity keys, a random session id, the time, and the size of encrypted messages</li></ul> | The payment, the amount, the transaction, and the network addresses inside the encrypted connection details. | Nothing is stored. State is in memory only and is lost on restart. Our code writes no identity keys or IPs to logs. Container output goes to the log processor (see below). | Yes, in Settings > Advanced settings > Direct Payments. Turning off "Receive direct payments" closes the always-on connection. Choosing "Message box" signalling stops using the relay. |
| **Presence answers** (same relay) | Anyone, at any time, can ask the relay to reach an identity key. | Not applicable. The relay *answers* "not online" at once if that key is not connected. | | | Turning off receiving makes the key always appear offline. |
| **Message box** `messagebox.bsvblockchain.tech` (BSVA, US, behind Cloudflare) | Message box payments (fallback, or when the recipient is offline). The wallet also checks its inbox about once a minute while open. | <ul><li>Sender identity key and recipient identity key</li><li>Mailbox name `payment_inbox`, which identifies the message as a payment</li><li>A message id</li><li>The size of the encrypted message</li><li>Times sent, listed and acknowledged</li></ul> | The transaction, the amount, and the key-derivation data. They are end-to-end encrypted to the recipient. | <ul><li>The encrypted message until the recipient acknowledges it, then it is deleted. Unacknowledged messages have no expiry.</li><li>A lasting record that an identity key has received messages in that mailbox, with the first time.</li><li>Today the server also logs the recipient identity key and message id for each payment. A fix is proposed.</li></ul> | Partly. The Message Box can be turned off in Settings > Advanced settings; payments then work only live. |
| **Push notifications** (Google FCM, Apple APNs) | Mobile-wallet recipients only, when a message box payment arrives. | The device push token, the time, the title "Payment received" and a message id. The message box stores the identity key, push token and platform. | Amount, sender, transaction. | Per Google/Apple. | Per the mobile app's notification settings. |
| **STUN servers**: `stun-us-1.bsvb.tech` (BSVA, US), `stun.l.google.com` (Google), `stun.cloudflare.com` (Cloudflare). This is the default list. | Each time a live connection is set up, by both payer and payee. | The device's public IP address and port, and the time. | Identity keys, who is paying whom, the payment. | BSVA's server is not configured to log these requests (confirmed from source, not yet observed at runtime). Google's and Cloudflare's logs are per their policies. | The list can be edited in Settings. Live payments need at least one STUN or TURN server across networks. |
| **TURN** (Cloudflare Realtime TURN). **Not enabled yet.** | Only when two wallets cannot connect directly. Credentials may still be fetched on every connection attempt. | Both devices' IP addresses and ports, connection times, and traffic volume. Volume approximates the transaction size. | Identity keys (credentials are not derived from them) and the payment, which is end-to-end encrypted. | Per Cloudflare. BSVA receives aggregate usage figures. | Not yet decided. |
| **Cloudflare** (network edge for the relay, the message box and the transaction broadcaster) | Every request to those services. | Everything those services see, plus IP address, browser/app version string and connection metadata. Cloudflare terminates the encrypted (TLS) connection. | Content that is end-to-end encrypted: payments, signals and message bodies. | Per Cloudflare. | No. |
| **Transaction broadcaster** (Arcade, BSVA, behind Cloudflare) | Every payment, before delivery, by the payer and often again by the recipient. Fallbacks: TAAL, GorillaPool, Bitails, WhatsOnChain. | The full transaction, the IP address, and a callback token linked to the wallet. | | Under review (see open facts). | No. |
| **Overlay lookup hosts** (`overlay-*.bsvb.tech` and others) | Message box path, when the sender has no host for the recipient. | The recipient's identity key, the sender's IP, and the time. | | Per operator. | No. |
| **The other wallet** | Every live payment, and every live connection attempt. | <ul><li>The other party's identity key</li><li>Its public IP address and port</li><li>That it is online and unlocked</li><li>With "Connect directly on the same network" on (default): its LAN IPv4 and IPv6 address</li><li>The payment itself, which it receives</li></ul> | | Its wallet keeps the payment and the sender's identity key. | Turning off receiving stops others learning your IP and online status by trying to connect. Turning off "same network" hides LAN and IPv6 addresses. |
| **Anyone who knows your identity key** (no payment needed) | While receiving is on. | Your public IP address and that your wallet is unlocked, by starting a connection that is never completed. | | | Turn off receiving. |
| **Face-to-face payment codes** (QR) | When shown. | The code holds your identity key and network addresses, not encrypted. With "same network" on this includes LAN and IPv6 addresses. | | | Don't show a code. Turn off "same network". |
| **Public blockchain** | Every payment. | The amount and the transaction. Outputs use per-payment derived keys, so the chain alone does not link them to identity keys. | Identity keys. | Permanent. | No. |
| **Log processor** (Coralogix, EU) | Continuously. | The standard output of the relay, STUN and message box servers, including the message box line noted above until it is fixed. | | Retention not yet confirmed. | No. |

---

## Part 2: proposed policy text

*For insertion as a new section after "Message Box", in the same style as "Encrypted Wallet Backup". Product names and settings paths are those in BSV Desktop; the mobile app will need its own paths when it ships.*

### Direct Payments

You can pay another wallet by its identity key, and receive payments the same way. The wallet first tries to deliver the payment **live**: it connects directly to the recipient's wallet over an encrypted peer-to-peer connection. If the recipient is not online, the wallet asks whether to leave the payment in the recipient's **Message Box** instead, as described in the section titled Message Box.

Receiving live payments is enabled by default. While the app is open and your wallet is unlocked, it stays connected to a signalling service operated by BSV Association so that other wallets can reach you.

#### What is encrypted

The payment is protected from end to end. That includes the transaction, the amount and the information your wallet needs to spend the funds. On a live payment it travels only over the encrypted connection between the two wallets. Through the Message Box it is encrypted to the recipient before it leaves your device. We cannot read it on either route. The connection details the two wallets exchange to find each other are encrypted to the other wallet in the same way. That includes their network addresses.

#### What the services can observe

To connect two wallets, some information is visible to the services involved:

- **Signalling service (operated by us).** While you are connected, we can see your wallet's identity key, your IP address and when you are online. For each payment attempt we can see the identity keys of both wallets, the time, and the size of the encrypted messages. Any wallet can ask the service whether an identity key is currently online. We do not store this information beyond the life of the connection.
- **Address discovery (STUN) servers.** To find a route between two wallets, your device asks a STUN server for its public IP address. By default these are operated by us, by Google and by Cloudflare. Each sees your IP address and the time, but not your identity key or the payment.
- **Relay (TURN) servers.** If two wallets cannot connect directly, the encrypted connection may be relayed through a server operated by Cloudflare. It can see both devices' IP addresses, the time and the amount of data relayed, but not the payment.
- **Network provider.** Our services are delivered through Cloudflare, which can see the same information our services see.
- **Transaction broadcast.** As with any payment, the transaction is sent to a transaction processing service and is recorded on the public BSV blockchain, where the amount is visible.

#### What the other wallet learns

When you pay someone, or someone pays you, the other wallet learns your identity key and your public IP address. While receiving is on, a wallet that knows your identity key can learn your IP address and whether your wallet is unlocked by starting a connection, even if it does not then pay you. When "Connect directly on the same network" is on, the other wallet also learns your device's local network address and IPv6 address. These addresses also appear in face-to-face payment codes.

#### Your control

- To stop receiving live payments, open Settings > Advanced settings > Direct Payments and turn off **Receive direct payments**. Other wallets can then no longer reach your wallet live or learn your IP address by trying to, and the always-on connection to the signalling service ends. You can still send live payments.
- To keep your local network address private, turn off **Connect directly on the same network**. Payments between devices on the same network may then fail.
- You can change the STUN servers, or choose the Message Box instead of the signalling service, in the same section.

These settings apply to every wallet profile on the device.

#### Edits to existing sections (redlines)

- **Message Box:**
  - Add: "and the IP addresses that connect."
  - Add: "Message Box payments are stored in a mailbox named for payments, so the operator can tell that a message is a payment, but not its amount."
  - Add the retention rule: "kept until the recipient's wallet acknowledges it, then deleted."
- **Data We Collect:** reconcile "We will not attempt to link any information you provide to your wallet address, IP address" with the services above, which necessarily see IP addresses next to identity keys.
- **Third parties:** name Google (STUN, push notifications), Apple (push notifications), Cloudflare (network edge, STUN, TURN) and the log processor.
- **BSV Desktop in-app Privacy Policy** (`src/lib/pages/Policies/privacy.tsx`, dated 2025-10-03). It currently states that we do not collect IP addresses, which is no longer accurate. Replace it with the canonical policy.

---

## Part 3: open facts to confirm before the text is final

1. **Log retention.** What is the retention at the log processor (Coralogix, EU region)? Who can access the relay, STUN and message box logs there? Should those namespaces be excluded?
2. **Cloudflare.** What edge, tunnel and Logpush logging is configured for the relay, message box and broadcaster hostnames? What are the retention terms? Is there a DPA covering STUN, TURN and the tunnel? Are cross-border transfers (US servers, EU log store, Swiss controller) covered?
3. **STUN logging at runtime.** Confirm on the running server that it logs no binding requests. The source and flags say so; it has not been observed.
4. **Message box logging.** Has the fix that stops logging recipient identity keys been deployed? What happens to log lines already shipped?
5. **Transaction broadcaster.** What does it retain? Note that the callback token wallets use with it is under separate review.
6. **Production state.** Is TURN enabled at launch, and with which provider? Do the running services match the reviewed code? The relay image is pinned to v0.2.0 and the message box to go-message-box-server 1.3.4.
7. **Default-on receiving.** Is the in-app notice plus this policy section enough, or should a first-run notice explain the always-on connection and IP visibility?
8. **Store labels.** The app store "data collected" labels and the iOS privacy manifest currently declare none. Do they need updating for IP addresses seen by these services?
9. **Wallet discovery.** Publishing an identity key → message box host advertisement on chain is opt-in ("Enable wallet discovery"). The Troubleshoot tool can also publish it, so policy text should not yet say discovery is "only ever opt-in".
10. **Contact.** Which privacy contact applies: support@ (wallet policies) or privacy@/dpo@ (Association notice)?

---

## Part 4: sources

Repository paths are on `main`/`master` unless noted. Desktop paths are on the push-payments branch (bsv-desktop#133/#134).

- **Relay wire protocol and what it holds:** ts-stack `packages/messaging/webrtpay/src/signaling/RelaySignaler.ts`
  - frame types: lines 34-56
  - auth frame: lines 656-670
  - `server/relay.ts`:
    - sign-in: lines 493-547
    - in-memory identities: line 299
    - pings: line 118
    - at most 5 sockets per identity: line 108
    - per-source buckets: lines 762-771
    - the "offline" reply (documented presence oracle): README "Security and privacy"
- **Signals are encrypted to the counterparty:** `src/signaling/envelope.ts`, BRC-2 with protocol `[2,'webrtpay signaling']`. The plaintext includes `from`, `to`, `kind`, `sdp`.
- **Receiving on by default; the relay socket held while unlocked:** desktop
  - `src/lib/utils/directPaySettings.ts` (defaults)
  - `src/lib/services/WalletService.ts` (`_startDirectPay`)
  - `src/lib/services/DirectPayManager.ts`
- **Default STUN list:** desktop `src/lib/utils/directPaySettings.ts`, `DEFAULT_DIRECT_PAY_SETTINGS`.
- **Same-network addresses:** desktop `electron/webrtcPrivacy.ts`. Probe on Electron 41.10.7 (Chrome 146):
  - default policy: `.local` names only
  - `default_public_and_private_interfaces`: LAN IPv4 plus IPv6 temporary address
- **TURN credentials not derived from identity keys:** ts-stack webrtpay `server/turn.ts`; the Cloudflare provider sends no custom identifier.
- **Message box payment token encrypted:**
  - `message-box-client` `MessageBoxClient.ts` `sendMessage`: encrypts unless `skipEncryption`, which the desktop never sets
  - `PeerPayClient` token fields: transaction, amount, outputIndex, derivation prefix/suffix
- **Message box storage and logging:** `go-message-box-server` v1.3.4
  - `pkg/storage/mongostore/mongostore.go`: messages deleted on acknowledge (247-258); permanent permission row (325-340); no TTL index
  - `internal/firebase/send_fmc_notification.go` (42-62): logs the recipient key and message id at Info
- **Production deployment** (bsva-infra-flux `main`):
  - `apps/base/messagebox/mainnet/` (image 1.3.4, Firebase on)
  - `apps/base/webrtpay-relay/` (image v0.2.0, TURN off)
  - `apps/base/stun/` (coturn `--stun-only`, AWS NLB)
  - `apps/base/coralogix*` (log shipping to eu2; namespace exclusions)
  - Relay, message box and broadcaster are proxied by Cloudflare tunnel.
- **Broadcaster callback token:** desktop `electron/arcade.ts`.
- **Existing policies:**
  - bsv-wallet `docs/privacy.html` (2026-10-16) and `docs/usage.html` (2026-08-23)
  - desktop `src/lib/pages/Policies/privacy.tsx` and `usage.tsx` (2025-10-03)
