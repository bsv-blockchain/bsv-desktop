# Testing direct (WebRTC) payments

Direct payments send the same payment data as a message-box payment, but straight from one BSV Desktop wallet to the other over an encrypted WebRTC data channel. The payment itself never passes through a server: the message box or the relay only carries the two wallets' encrypted connection details (the offer and the answer), and the message box keeps them only until they are read. Nothing is spent unless the channel to the recipient is up first. The design is in [`docs/superpowers/specs/2026-10-17-webrtc-direct-payments-design.md`](superpowers/specs/2026-10-17-webrtc-direct-payments-design.md).

This recipe walks through every path: signaling through the message box, signaling through the relay, and the face-to-face code exchange. The sandbox this was built in drops UDP to non-loopback addresses, so a real network between two wallets could only be tried by you.

## What you need

- **Two wallets that are different identities.** Two machines is the better test, because it exercises real NATs. One machine works too (see [Two wallets on one machine](#two-wallets-on-one-machine)).
- **The same build on both**: this branch (`feat/webrtc-direct-payments`) run from source, or a package built from it (`npm run package`).
- **The same network on both**: Mainnet, or Testnet. The chip at the top of the Payments page shows which. Wallets on different networks cannot pay each other, and a code made for the other network is refused.
- **Funds in the payer wallet.** Use small amounts (a few hundred satoshis is enough). Testnet is fine if you have testnet coins.
- **A message box on both wallets** for the message-box signaling tests (Settings → Advanced settings → **Message Box Configuration**). Check it with an ordinary message-box payment first (test 0).
- **Each wallet's identity key**, from Settings → Your identity. Paste it into the other wallet's Send tab as the recipient.
- For the relay tests: Node 22+ (the relay runs from the vendored tarball), or Docker and a checkout of the WebRTPay repo for the relay with a TURN server (see [Relay tests](#relay-tests)).

Direct payments need **both wallets online and unlocked at the same moment**. If the recipient is offline, use the message box; that is what it is for.

**What the other side learns.** Sending directly shows your IP address to the recipient's wallet, and the codes in a face-to-face exchange show each wallet's network address to anyone who can read them. While receiving is on, any wallet that knows your identity key can learn your public IP address and when your wallet is unlocked by starting a connection, without paying you. The app says so next to the switches; use test wallets if that matters to you.

## Two wallets on one machine

BSV Desktop reads `BSV_DESKTOP_USER_DATA` at startup. When it is set, Electron's `userData` directory is moved there, before anything reads it. Unset, nothing changes.

```bash
# Terminal 1: Vite (port 5173) and the first wallet, with the normal data directory
npm run dev

# Terminal 2: the second wallet, with its own data directory
BSV_DESKTOP_USER_DATA=$HOME/.bsv-desktop-b npm run dev:electron
```

Notes:

- The second window loads its UI from the Vite server that terminal 1 started, so start that first. `dev:electron` also rebuilds `dist-electron`; the first window is not affected until you restart it. Once built, `BSV_DESKTOP_USER_DATA=$HOME/.bsv-desktop-b npx electron .` starts a second window without rebuilding.
- Use an absolute path, or an unquoted `~/…` that your shell expands. The app does not expand `~` itself, so a quoted `"~/dir"` becomes a folder named `~` inside the working directory. A packaged app can be started from a terminal the same way, by running its executable with the variable set. On Windows set the variable in your shell first; the dev scripts use `cp`, so run them from Git Bash or WSL, or use a packaged build.
- There is no single-instance lock, which is why a second copy starts at all.
- A build run from source and an installed BSV Desktop share the same default data directory (`bsv-desktop-electron`). On a machine that has your everyday wallet, give **both** test wallets their own `BSV_DESKTOP_USER_DATA` so the test cannot touch it.
- **The second wallet must be a new identity** (create a new wallet, or restore a different recovery phrase). Do not restore the same phrase in both: both copies would open the same database file.

What moves and what stays shared:

| Moves with `BSV_DESKTOP_USER_DATA` | Stays in `~/.bsv-desktop` (shared) |
| --- | --- |
| Wallet snapshot, payment outboxes and direct-pay settings (the window's localStorage) | One SQLite database per identity and network (`wallet-<identityKey>-main.db`), so two identities never touch the same file |
| `vault.dat`, `secrets.dat`, `boot-config.json`, `network-settings.json` | `fee-settings.json` |
| `certs/` (the local HTTPS certificate) | `wallet-portability-v1/`, `arcade-sse/` (both keyed per identity) |

**Ports 2121 and 3321 fail soft.** Only one copy can own the local wallet bridge (the BRC-100 interface other apps connect to). The copy that starts second logs a `PortInUseError` and shows a **Wallet Bridge Unavailable** dialog. That is expected: click **OK** and carry on. The wallet works normally; only apps connecting to the bridge cannot reach it. Direct payments do not use these ports. The second copy keeps its own certificate in its own `certs/` folder and does not ask you to trust it, because it never gets as far as serving.

## Turn direct receiving on

Receiving is **off by default** (see *What the other side learns* above). Sending directly needs no setting.

On the wallet that will **receive** (do the same on both for the reverse test):

1. Settings → Advanced settings → the **Direct Payments** card (below Message Box Configuration).
2. Turn on **Receive direct payments**. The warning under the switch explains what that discloses.
3. Leave **Signaling** on **Message box** for now. STUN servers stay at their defaults (`stun:stun.l.google.com:19302, stun:stun.cloudflare.com:3478`); once the BSVA STUN service is deployed you can add `stun:stun-us-1.bsvb.tech:3478`.
4. **Save**. The **Status** chip should read **Online via message box**, and the Receive tab of the Payments page should say **Direct payments: online via the message box.**

If the wallet has no message box, the chip reads **Not set up** and a note explains that direct payments reach other wallets through the message box: connect one, or use a relay server. That is not an error; face-to-face codes (test 4) still work.

Settings are stored on the device, survive logout, and are removed with **Remove wallet from this device**.

## The tests

Run them in this order. Stop and read [Troubleshooting](#troubleshooting) at the first failure.

### 0. Baseline: an ordinary message-box payment

Payments → Send, recipient = the other wallet's identity key, **Delivery: Message box** (the default). Send a small amount. It should arrive in the other wallet. This proves the identities, the network and the message box before you add WebRTC.

### 1. Direct payment, signaling through the message box

Both wallets: receiving on, signaling **Message box**, both unlocked.

1. On the payer: Payments → Send, recipient = the payee's identity key, an amount, **Delivery: Direct**. The text under the choice says it connects to the recipient's wallet first, that nothing is spent if they are offline, and that a direct payment reveals your IP address to their wallet.
2. **Review payment**. The dialog shows **Delivery: Direct (peer-to-peer)** with the same text. **Confirm & send**; the button reads **Connecting…** while it works.
3. Expect a few seconds of connecting (the payee checks for the offer every 2.5 s), then the payment.

Success looks like this:

- **Payer**: the notice **Payment sent.**, and the payment is not listed under **Saved payments**. Activity shows the outgoing payment. Behind that, the payee replied with an **accepted** acknowledgement (the payment is in its wallet). A **received** acknowledgement is also a success: the payee has the payment and adds it to its wallet as soon as it can.
- **Payee**: the balance goes up, and Activity shows **Received direct BSV** (the entry carries the wallet labels `peerpay`, `direct` and `inbound`, which only the wallet interface shows). If its Payments page is open, it also shows **Direct payment received: … satoshis.** There is no pop-up on other pages.
- No message-box payment appears on the payee, because the payment never went through the message box.

Repeat in the other direction (payee becomes payer) so both NATs get tested.

### 2. Receiving off: nothing is spent

On the payee, turn **Receive direct payments** off and save. On the payer, send with **Delivery: Direct**.

Expected: the send fails with **The recipient's wallet could not be reached directly. Nothing was spent. Send it through the message box instead.**, and **no transaction is created**: the payer's balance, Activity and Saved payments are unchanged. With message-box signaling this takes about 30 seconds (the payer waits for an answer that never comes); with relay signaling it fails within a few seconds, because the relay reports the payee as not connected. Then send the same amount with **Delivery: Message box**; it must still work.

### 3. Relay signaling

See [Relay tests](#relay-tests). This swaps the carrier of the offer and answer; the payment path is the same.

### 4. Face to face, code exchange (no server)

The payee makes the code; the payer answers it. Neither wallet needs receiving turned on, and neither needs a message box or relay: the codes are the invitation.

1. **Payee**: Payments → **Nearby** → **Direct (WebRTC)** → **Receive directly**. Optionally fill in **Amount to request (optional)**, then **Create direct request**. A QR code (a `webrtpay1:` code) appears with **Copy code** and **Show the code as text**. It can wait on screen for minutes.
2. **Payer**: Payments → **Nearby** → **Direct (WebRTC)** → **Pay directly**. **Scan their request**, or paste the code into **Recipient’s direct request**. Check the amount (it is fixed when the code carries one), then **Review direct payment** → **Confirm & show answer**. The answer appears as a QR code: **Ask them to scan this answer now**.
3. **Payee**: **2. Scan their answer**, and scan it (or paste it into the scanner's **Or paste a code** field) **within about 15 seconds of it appearing**. After that the connecting side gives up. Scanning from across a table works; pasting between chat windows usually misses the window, and the page says so.
4. The payee shows **Connected to a verified wallet** with the payer's identity key, then **Waiting for their payment…**; the payer sends the payment, then the payee shows **Payment received** and the payer **Payment delivered**.

On one machine you can copy the code from one window and paste it into the other; hold the answer back no longer than the 15 seconds.

Things to check:

- A code made on Testnet pasted into a Mainnet wallet (or the reverse) is **refused** before any payment is made, with a message naming both networks.
- A code with an amount makes the payer pay **exactly** that amount.
- A request code serves one payment. After a success, make a new request.
- If another wallet pays a different amount than requested, the payee still takes the payment (it is already on the network and pays this wallet) and shows **Received X satoshis — you requested Y.** BSV Desktop as payer always pays the requested amount, so you will only see this from other wallets.

### 5. A payment interrupted after broadcast (optional, hard to time)

If the connection drops after the payer has broadcast but before the acknowledgement arrives, the payer's payment stays under **Saved payments** with an error, rather than hanging. To try it, start a direct send and quit the payee wallet in the second between connecting and the result. Then, on the payer:

- **Saved payments** lists it (**sent directly**) with **Retry via message box** and **Retry directly**; either one delivers the same transaction. Retry by message box while the payee is offline, bring the payee back, and it receives the payment from its message box.
- Face to face: when the payer next answers a request code from the same payee (of the same amount, or with no amount), Nearby offers **Deliver saved payment of N satoshis** instead of a new payment. It delivers the same transaction.
- Saved payments survive logout: log out and back in on the payer and they are still there.

A payee that receives the same payment twice (the payer retried after losing the acknowledgement) takes it once and shows it once.

## Relay tests

The relay is an optional rendezvous for the encrypted offer and answer, run from the `@bsv/webrtpay` package as `webrtpay-relay`. It stores nothing. It can also hand out short-lived TURN credentials.

**Run it from the tarball** (the bsv-desktop repo carries it as `vendor/bsv-webrtpay-0.1.0.tgz`; `npm pack` in the WebRTPay repo makes the same file):

```bash
HOST=127.0.0.1 PORT=8787 npx --yes --package ./vendor/bsv-webrtpay-0.1.0.tgz webrtpay-relay
```

The relay refuses to start without `PUBLIC_URLS` unless `HOST` is a loopback address: wallets sign the relay URL they dial, and without `PUBLIC_URLS` the relay would check that signature against a URL built from the request's `Host` header, which the client chooses. On loopback that is fine for a test; it logs a warning about it.

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` | Listen port | `8787` |
| `HOST` | Listen address | `0.0.0.0` |
| `PUBLIC_URLS` | Comma-separated URLs wallets dial, such as `wss://relay.example.com`. Each wallet's **Relay URL** must be exactly one of them. **Required unless `HOST` is a loopback address**, and whenever a proxy fronts the relay. | unset |
| `TRUSTED_IP_HEADER` | Header the outermost proxy sets to the client's address (`cf-connecting-ip` behind Cloudflare), for the per-address limits | unset |
| `STUN_URLS` | Comma-separated `stun:` URLs handed to wallets | unset |
| `TURN_SECRET` | coturn `static-auth-secret`; turns on TURN credentials (needs `TURN_URLS`) | unset |
| `TURN_URLS` | Comma-separated `turn:` URLs to issue credentials for | unset |
| `TURN_TTL` | Lifetime of issued TURN credentials, in seconds | `600` |
| `TURN_PER_IP_PER_HOUR` | TURN credential sets one source address may get per hour | `6` |

**Or run the relay and a TURN server together with Docker**, from the WebRTPay repo (branch `v2`; on the author's machine `~/git/experimental/WebRTPay`):

```bash
docker compose -f docker/docker-compose.yml up -d --build   # relay on 127.0.0.1:8787, coturn on 127.0.0.1:3478
docker compose -f docker/docker-compose.yml down             # when finished
```

The stack runs coturn 4.18.0 (STUN and TURN, relay ports 49160–49200) with the public dev secret `webrtpay-dev-secret`, and a relay with `PUBLIC_URLS=ws://127.0.0.1:8787` that hands out TURN credentials for `turn:127.0.0.1:3478`. Everything is published on 127.0.0.1 only, so as shipped it serves wallets on that one machine. Never deploy it.

**Point the wallets at it.** On both wallets: Settings → Advanced settings → Direct Payments → **Signaling: Relay server**, **Relay URL**, **Save**, keeping **Receive direct payments** on for the payee. The chip should read **Online via relay server**, and the Receive tab **Direct payments: online via the relay server.**

- **One machine**: relay URL `ws://127.0.0.1:8787`, exactly (with the Docker relay, `ws://localhost:8787` is refused because it is not in its `PUBLIC_URLS`). Plain `ws://` is only accepted for localhost.
- **Two machines**: the wallet only accepts `wss://` for anything but localhost, and the relay checks that the URL a wallet signed is one it serves. Two ways to satisfy both:
  - Tunnel the relay port to the other machine so both wallets use the same localhost address. On the machine that does not run the relay: `ssh -N -L 8787:127.0.0.1:8787 user@relay-machine`, then both wallets use `ws://127.0.0.1:8787` (with `PUBLIC_URLS` set, it must include that address).
  - Put the relay behind TLS (a reverse proxy or a tunnel) and use its `wss://` address in both wallets. Start the relay with `PUBLIC_URLS` set to exactly that address (and `TRUSTED_IP_HEADER` if the proxy is Cloudflare).

Then repeat test 1 (Delivery: Direct). Also check:

- **Relay down and back.** Stop the relay with the wallets open. On the receiving wallet the chip turns to **Cannot receive** with **Direct payments cannot be received: the relay server cannot be reached. Trying again…**. Start the relay again: within about 30 seconds the chip is back to **Online via relay server** by itself (saving the settings again reconnects at once). A wallet started while the relay is down recovers the same way.
- **Wrong relay URL.** Point the payee at a URL the relay does not serve (with the Docker relay, `ws://localhost:8787`). The chip reads **Cannot receive** with *the relay server did not accept this wallet at ws://localhost:8787. The address in Settings must be exactly one the relay serves (its PUBLIC_URLS).*
- **Payee not connected.** A payment to a wallet that is not connected to the relay fails within a few seconds and nothing is spent.

### TURN (connections that cannot go direct)

TURN carries the payment data when two NATs cannot be punched through, which is typical on mobile carrier networks. The relay hands out TURN credentials itself, which is the easy way to test it: run the Docker stack above (or the relay with `TURN_SECRET` and `TURN_URLS` set) and use **Signaling: Relay server**. Before each connection the wallet asks the relay for TURN credentials and reuses them while they are valid (10 minutes by default), so it does not use up the relay's hourly allowance per address (6 by default; the Docker stack sets 600). You enter nothing in the TURN fields.

Notes:

- As shipped, the Docker stack publishes everything on 127.0.0.1 and coturn advertises `127.0.0.1`, so TURN only helps a same-machine test. For two machines, publish the relay port (8787), 3478 (UDP and TCP) and 49160–49200 (UDP) on an address the other machine can reach in `docker/docker-compose.yml`, set `external-ip` in `docker/turnserver.conf` and the relay's `TURN_URLS` to that address (for example `turn:192.168.1.20:3478`), set the relay's `PUBLIC_URLS` to the URL the wallets dial, and allow those ports through the host firewall.
- The wallet has no "force relay" switch. To see TURN used, make a direct path impossible (put the wallets on different networks, such as a phone hotspot, or block UDP between them while allowing it to the TURN host) and confirm the payment still completes. The coturn log (`docker compose -f docker/docker-compose.yml logs coturn`) shows an allocation for the test.
- A relay without a TURN server hands out STUN servers only, and the wallet connects without TURN. When the relay refuses TURN credentials (its allowance for your address is used up) or does not answer within 5 seconds, the wallet connects without them too, and the developer console logs `Connecting without the relay's TURN servers`.
- To use the **TURN server (optional, for testing)** fields yourself (they take a fixed username and credential), mint coturn REST credentials for the dev secret that last an hour:

  ```bash
  node -e 'const c=require("crypto");const u=(Math.floor(Date.now()/1000)+3600)+":tester";console.log("username:",u);console.log("credential:",c.createHmac("sha1","webrtpay-dev-secret").update(u).digest("base64"))'
  ```

  Enter the TURN URL (such as `turn:127.0.0.1:3478`), that username and that credential, then Save.

## Troubleshooting

| Symptom | Likely cause and what to do |
| --- | --- |
| The direct send fails with "could not be reached directly" (after about 30 seconds with the message box, within a few seconds with a relay) | The payee is not receiving. Check that it is open and unlocked, that **Receive direct payments** is on and saved, and that its chip reads **Online via …**. Signaling must match: both on the message box, or both on the same relay URL. |
| The direct send fails with "not taking direct payments right now" | The payee is busy (too many connections at once) or has receiving off while it is itself paying someone. Try again in a minute. |
| The chip reads **Not set up** | The wallet has no message box and signaling is **Message box**. Connect a message box, or switch signaling to a relay server. |
| A code is refused as being for a different network | The code was made on the other network (Mainnet versus Testnet). Compare the chips on the Payments page of both wallets and make a new code on the right one. |
| Message-box signaling never connects | Baseline test 0 first: if a plain message-box payment does not arrive, the message box is the problem. Both wallets need one. The payee only checks every few seconds, so allow 5–10 s. |
| The recipient rejected the payment | The payee received the payment and refused it (for example, it does not pay that wallet); the error names the reason. Please report it with the console output from both wallets. |
| Connects on the same Wi-Fi in one direction only, or never | Wi-Fi client isolation, a VPN, or a firewall. Allow incoming connections for BSV Desktop (macOS asks the first time; allow it), open outbound UDP, turn off the VPN, and try a phone hotspot for both machines. BSV Desktop hides local addresses behind `.local` names, so a network that blocks multicast DNS can break same-network connections that would otherwise work. |
| Works on the same network but not across networks | Both NATs are strict, so you need TURN: see [TURN](#turn-connections-that-cannot-go-direct). |
| The chip reads **Cannot receive** with a relay | The message under it says why. *Cannot be reached*: the relay is down or the URL is wrong; the wallet keeps trying. *Did not accept this wallet*: the **Relay URL** is not exactly one of the relay's `PUBLIC_URLS` (a different host name, `localhost` instead of `127.0.0.1`, or a trailing path). *Limiting connections*: too many connections from your address; wait. |
| The relay will not start: "PUBLIC_URLS is required…" | Set `PUBLIC_URLS`, or `HOST=127.0.0.1` for a test on one machine. |
| **Wallet Bridge Unavailable** dialog on the second wallet | Expected when two copies run on one machine; see [Two wallets on one machine](#two-wallets-on-one-machine). Click **OK**. |
| Code exchange: nothing happens after scanning the answer | The answer was applied more than about 15 seconds after it appeared. Make a new request and scan the answer straight away. |
| The second wallet starts empty, or the first wallet looks different | Each data directory is its own wallet. Start each copy with the same `BSV_DESKTOP_USER_DATA` value every time. |

For anything else, open the developer tools (they open by themselves in `npm run dev`; Cmd+Opt+I or Ctrl+Shift+I otherwise) and read the console on both wallets.

## What to report back

Please send: the build or commit on both sides, the operating system on each, whether the two were on one network, the network (Mainnet or Testnet), the signaling used (message box, relay, code), how long the connection took, whether it needed TURN, and the console output from both wallets for anything that failed. Say which of tests 0 to 5 passed.
