# Testing direct (WebRTC) payments

Direct payments send the same payment data as a message-box payment, but straight from one BSV Desktop wallet to the other over an encrypted WebRTC data channel. Nothing is stored on a server, and nothing is spent unless the channel to the recipient is up first. The design is in [`docs/superpowers/specs/2026-10-17-webrtc-direct-payments-design.md`](superpowers/specs/2026-10-17-webrtc-direct-payments-design.md).

This recipe walks through every path: signaling through the message box, signaling through the relay, and the face-to-face code exchange. The sandbox this was built in drops UDP to non-loopback addresses, so a real network between two wallets could only be tried by you.

## What you need

- **Two wallets that are different identities.** Two machines is the better test, because it exercises real NATs. One machine works too (see [Two wallets on one machine](#two-wallets-on-one-machine)).
- **The same build on both**: this branch (`feat/webrtc-direct-payments`) run from source, or a package built from it (`npm run package`).
- **The same network on both**: Mainnet, or Testnet. The chip at the top of the Payments page shows which. Wallets on different networks cannot pay each other, and a code made for the other network is refused.
- **Funds in the payer wallet.** Use small amounts (a few hundred satoshis is enough). Testnet is fine if you have testnet coins.
- **A message box on both wallets** for the message-box signaling tests (Settings → Advanced settings → message box). Check it with an ordinary message-box payment first (test 0).
- **Each wallet's identity key**, from Settings → Your identity. Paste it into the other wallet's Send tab as the recipient.
- For the relay tests: Docker, or Node 22+ and the `@bsv/webrtpay` tarball (see [Relay tests](#relay-tests)).

Direct payments need **both wallets online and unlocked at the same moment**. If the recipient is offline, use the message box; that is what it is for.

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

Receiving is **off by default**. Answering a direct payment reveals your public IP address to the payer, and anyone who knows your identity key can try to connect. Sending directly needs no setting.

On the wallet that will **receive** (do the same on both for the reverse test):

1. Settings → Advanced settings → the **Direct payments** card.
2. Turn on **Receive direct payments**.
3. Leave signaling on **Message box** for now. STUN servers stay at their defaults (`stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`); once the BSVA STUN service is deployed you can add `stun:stun-us-1.bsvb.tech:3478`.
4. **Save**. The status chip should read online, and the Receive tab on the Payments page should say direct payments are online through the message box.

Settings are stored on the device, survive logout, and are removed with **Remove wallet from this device**.

## The tests

Run them in this order. Stop and read [Troubleshooting](#troubleshooting) at the first failure.

### 0. Baseline: an ordinary message-box payment

Payments → Send, recipient = the other wallet's identity key, **Delivery: Message box** (the default). Send a small amount. It should arrive in the other wallet. This proves the identities, the network and the message box before you add WebRTC.

### 1. Direct payment, signaling through the message box

Both wallets: receiving on, signaling **Message box**, both unlocked.

1. On the payer: Payments → Send, recipient = the payee's identity key, an amount, **Delivery: Direct**. The helper text says it connects to the recipient's wallet first and spends nothing if they are offline.
2. Review and confirm.
3. Expect a few seconds of "connecting" (the payee checks for the offer every 2.5 s), then the payment.

Success looks like this:

- **Payee**: a toast **Direct payment received: …**, the balance goes up, and Activity shows **Received direct BSV**. The entry carries the wallet labels `peerpay`, `direct` and `inbound`.
- **Payer**: the send completes with a success notice, and the payment is no longer listed as saved or undelivered. Activity shows the outgoing payment. Behind that, the payee replied with an **accepted** acknowledgement (the payee's wallet has the funds). A **received** acknowledgement is also a success for the payer: the payee has the payment and will finish recording it on its side.
- No message-box payment appears on the payee, because the payment never went through the message box.

Repeat in the other direction (payee becomes payer) so both NATs get tested.

### 2. Receiving off: nothing is spent

On the payee, turn **Receive direct payments** off and save. On the payer, send with **Delivery: Direct**.

Expected: the send fails within about 30 seconds with a peer-unreachable error that suggests the message box, and **no transaction is created**. The payer's balance and Activity are unchanged. Then send the same amount with **Delivery: Message box**; it must still work.

### 3. Relay signaling

See [Relay tests](#relay-tests). This swaps the carrier of the offer and answer; the payment path is the same.

### 4. Face to face, code exchange (no server)

The payee is the one who makes the code; the payer answers it.

1. **Payee**: Payments → Nearby → **Direct (WebRTC)** → **Receive nearby**. Optionally enter an amount, then create the request. A QR code (a `webrtpay1:` code) appears, with a copy button. It can wait on screen for minutes.
2. **Payer**: Payments → Nearby → **Direct (WebRTC)** → **Pay nearby**. Scan the QR, or paste the code. Check the amount (it is fixed if the code carries one), confirm, and an **answer** QR code appears.
3. **Payee**: scan the answer QR (or paste it, if the dialog offers a field) **within about 15 seconds of it appearing**. After that the connecting side gives up. Scanning from across a table works; pasting between chat windows usually misses the window, and the page says so.
4. The wallets connect, the payee shows the verified sender, then the payer sends the payment and the payee shows what was received.

On one machine you can copy the code from one window and paste it into the other; hold the answer back no longer than the 15 seconds.

Things to check:

- A code made on Testnet pasted into a Mainnet wallet (or the reverse) is **refused** before any payment is made.
- A code with an amount makes the payer pay **exactly** that amount.
- The code works once. Try it again after a success: it must not pay twice.
- Receiving does **not** need to be turned on for this flow; the code is the invitation.

### 5. A payment interrupted after broadcast (optional, hard to time)

If the connection drops after the payer has broadcast but before the acknowledgement arrives, the payer's saved payment stays pending and shows an error, rather than hanging. To try it, start a direct send and quit the payee wallet in the second between "connected" and the result. Then, on the payer: Payments shows the saved payment with **Retry via message box** and **Retry directly**; either one delivers the same transaction. Retry by message box while the payee is offline, bring the payee back, and it receives the payment from its message box. You can also log out and back in on the payer: saved payments survive logout.

## Relay tests

The relay is an optional rendezvous for the encrypted offer and answer. It stores nothing. It is run from the `@bsv/webrtpay` package as `webrtpay-relay`.

**Run it from the tarball** (the bsv-desktop repo carries it as `vendor/bsv-webrtpay-0.1.0.tgz`; `npm pack` in the WebRTPay repo makes the same file):

```bash
PORT=8787 npx --yes --package ./vendor/bsv-webrtpay-0.1.0.tgz webrtpay-relay
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` | Listen port | `8787` |
| `HOST` | Listen address | `0.0.0.0` |
| `PUBLIC_URLS` | Comma-separated URLs clients are allowed to use, such as `wss://relay.example.com` | derived from the request's host header |
| `TURN_SECRET` | coturn `static-auth-secret`; turns on TURN credential vending | unset |
| `TURN_URLS` | Comma-separated `turn:` URLs sent to clients | unset |
| `STUN_URLS` | Comma-separated `stun:` URLs sent to clients | unset |

**Or run the relay and a TURN server together with Docker**, from the WebRTPay repo (branch `v2`; on the author's machine `~/git/experimental/WebRTPay`):

```bash
docker compose -f docker/docker-compose.yml up -d     # relay on 8787, coturn on 3478
docker compose -f docker/docker-compose.yml down      # when finished
```

The stack runs coturn on port 3478 with the dev REST secret `webrtpay-dev-secret`, and a relay that hands out TURN credentials made from it.

**Point the wallets at it.** On both wallets: Settings → Advanced settings → Direct payments → signaling **Relay server**, **Relay URL**, **Save**, keeping **Receive direct payments** on for the payee.

- **One machine**: relay URL `ws://127.0.0.1:8787`. Plain `ws://` is only accepted for localhost.
- **Two machines**: the wallet only accepts `wss://` for anything but localhost, and the relay checks that the URL a wallet signed is the URL the relay expects. Two ways to satisfy both:
  - Tunnel the relay port to the other machine so both wallets use the same localhost address. On the machine that does not run the relay: `ssh -N -L 8787:127.0.0.1:8787 user@relay-machine`, then both wallets use `ws://127.0.0.1:8787` (if you set `PUBLIC_URLS`, it must include that address).
  - Put the relay behind TLS (a reverse proxy or a tunnel) and use its `wss://` address in both wallets. Start the relay with `PUBLIC_URLS` set to exactly that address.

Then repeat test 1 (Delivery: Direct). The status chip should read online, and the Receive tab should say direct payments are online through the relay. Optionally stop the relay and start it again with the wallets open: they should reconnect by themselves (the client retries with a delay that grows to 30 seconds).

Also check: a payment to a wallet that is not connected to the relay fails fast with peer-unreachable and nothing is spent.

### TURN (connections that cannot go direct)

TURN carries the payment data when two NATs cannot be punched through, which is typical on mobile carrier networks. The relay can pass out TURN credentials itself, which is the easy way to test it: start the Docker stack above (or the relay with `TURN_SECRET` and `TURN_URLS` set), use signaling **Relay server**, and the wallets receive short-lived TURN credentials from the relay when they connect. You enter nothing in the TURN fields.

Notes:

- As shipped, the dev coturn config advertises `127.0.0.1`, so TURN only helps a same-machine test. For two machines, set `external-ip` in `docker/turnserver.conf` and `TURN_URLS` for the relay to an address the other machine can reach (for example `turn:192.168.1.20:3478`), and allow UDP and TCP 3478 and UDP 49160–49200 through the host firewall.
- The wallet has no "force relay" switch. To see TURN used, make a direct path impossible (put the wallets on different networks, such as a phone hotspot, or block UDP between them while allowing it to the TURN host) and confirm the payment still completes. The coturn log (`docker compose -f docker/docker-compose.yml logs coturn`) shows an allocation for the test.
- To use the **TURN** fields yourself (they take a fixed username and credential), mint coturn REST credentials that last an hour:

  ```bash
  node -e 'const c=require("crypto");const u=(Math.floor(Date.now()/1000)+3600)+":tester";console.log("username:",u);console.log("credential:",c.createHmac("sha1","webrtpay-dev-secret").update(u).digest("base64"))'
  ```

  Enter the TURN URL (such as `turn:127.0.0.1:3478`), that username and that credential, then Save.

## Troubleshooting

| Symptom | Likely cause and what to do |
| --- | --- |
| The direct send fails after about 30 seconds with a peer-unreachable error | The payee is not receiving. Check that it is open and unlocked, that **Receive direct payments** is on and saved, and that its status chip reads online. Signaling must match: both on the message box, or both on the same relay URL. |
| A code is refused as being for a different network | The code was made on the other network (Mainnet versus Testnet). Compare the chips on the Payments page of both wallets and make a new code on the right one. |
| Message-box signaling never connects | Baseline test 0 first: if a plain message-box payment does not arrive, the message box is the problem. Both wallets need one. The payee only checks every few seconds, so allow 5–10 s. |
| The recipient rejected the payment | The payee received the payment and refused it; the error names the reason. Please report it with the console output. |
| Connects on the same Wi-Fi in one direction only, or never | Wi-Fi client isolation, a VPN, or a firewall. Allow incoming connections for BSV Desktop (macOS asks the first time; allow it), open outbound UDP, turn off the VPN, and try a phone hotspot for both machines. Browsers hide local addresses behind `.local` names, so a network that blocks multicast DNS can break same-network connections that would otherwise work. |
| Works on the same network but not across networks | Both NATs are strict, so you need TURN: see [TURN](#turn-connections-that-cannot-go-direct). |
| Relay chip shows an error, or the relay closes the connection | The relay URL must be reachable from the wallet, be `wss://` unless it is localhost, and match what the relay expects (`PUBLIC_URLS` if you set it). A trailing path or a different host name than the one the relay was told about fails authentication. |
| **Wallet Bridge Unavailable** dialog on the second wallet | Expected when two copies run on one machine; see [Two wallets on one machine](#two-wallets-on-one-machine). Click **OK**. |
| Code exchange: nothing happens after scanning the answer | The answer was applied more than about 15 seconds after it appeared. Make a new code and scan the answer straight away. |
| The second wallet starts empty, or the first wallet looks different | Each data directory is its own wallet. Start each copy with the same `BSV_DESKTOP_USER_DATA` value every time. |

For anything else, open the developer tools (they open by themselves in `npm run dev`; Cmd+Opt+I or Ctrl+Shift+I otherwise) and read the console on both wallets.

## What to report back

Please send: the build or commit on both sides, the operating system on each, whether the two were on one network, the network (Mainnet or Testnet), the signaling used (message box, relay, code), how long the connection took, whether it needed TURN, and the console output from both wallets for anything that failed. Say which of tests 0 to 5 passed.
