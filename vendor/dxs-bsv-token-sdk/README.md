# dxs-bsv-token-sdk

TypeScript SDK for building, reading, and validating Bitcoin SV transactions.

This SDK implements the [official STAS 3.0 version](https://github.com/stassso/STAS-3-script-templates) through its DSTAS surface.

The public surface is split into three entrypoints:

- `dxs-bsv-token-sdk/dstas`: canonical Divisible STAS flow API
- `dxs-bsv-token-sdk/stas`: older STAS workflow helpers
- `dxs-bsv-token-sdk/bsv`: low-level blockchain primitives, script tooling, and transaction utilities

Root imports expose only the `dstas`, `stas`, and `bsv` namespaces.

## Install

```bash
npm install dxs-bsv-token-sdk
```

## Choose your entrypoint

Use the narrowest surface that matches your task.

- `dxs-bsv-token-sdk/dstas`
  Use for protocol-facing DSTAS flows: issue, transfer, split, merge, freeze, unfreeze, confiscation, swap, redeem.
- `dxs-bsv-token-sdk/stas`
  Use for the older STAS transaction workflow.
- `dxs-bsv-token-sdk/bsv`
  Use for low-level work: keys, addresses, scripts, transaction parsing, transaction building, and script evaluation.
- `dxs-bsv-token-sdk`
  Use only if you explicitly want namespace aggregation for `dstas`, `stas`, and `bsv`.

## Quickstart: DSTAS issue and transfer

```ts
import { dstas } from "dxs-bsv-token-sdk/dstas";
import { bsv } from "dxs-bsv-token-sdk/bsv";

const {
  OutPoint,
  PrivateKey,
  TokenScheme,
  TransactionReader,
  fromHex,
  toHex,
  utf8ToBytes,
} = bsv;

const issuer = new PrivateKey(
  fromHex("b62fd57a07804f79291317261054eb9b19c9ccec49146c38b30a29d48636c368"),
);
const alice = new PrivateKey(
  fromHex("77b1b7d5bfe1288d94f829baba86d503e1a06b571aaa5d36820be19ef2fe520e"),
);

const scheme = new TokenScheme(
  "Divisible STAS",
  toHex(issuer.Address.Hash160),
  "DSTAS",
  1,
  {
    isDivisible: true,
    freeze: true,
    confiscation: true,
    freezeAuthority: { m: 1, publicKeys: [toHex(issuer.PublicKey)] },
    confiscationAuthority: { m: 1, publicKeys: [toHex(issuer.PublicKey)] },
  },
);

const fundingTx = TransactionReader.readHex("<funding-tx-hex>");
const fundingOut = OutPoint.fromTransaction(fundingTx, 0);

const { issueTxHex } = dstas.BuildDstasIssueTxs({
  fundingPayment: { OutPoint: fundingOut, Owner: issuer },
  scheme,
  destinations: [{ Satoshis: 100, To: issuer.Address }],
  feeRate: 0.1,
});

const issueTx = TransactionReader.readHex(issueTxHex);
const stasOut = OutPoint.fromTransaction(issueTx, 0);
const feeOut = OutPoint.fromTransaction(issueTx, 1);

const transferTxHex = dstas.BuildDstasTransferTx({
  stasPayment: { OutPoint: stasOut, Owner: issuer },
  feePayment: { OutPoint: feeOut, Owner: issuer },
  destination: { Satoshis: 100, To: alice.Address },
  scheme,
  note: [utf8ToBytes("DSTAS"), utf8ToBytes("transfer")],
});
```

## High-level DSTAS APIs

Use these first.

### Single-flow builders

`dxs-bsv-token-sdk/dstas` exports `BuildDstas*` helpers for individual transactions:

- `BuildDstasIssueTxs`
- `BuildDstasTransferTx`
- `BuildDstasSplitTx`
- `BuildDstasMergeTx`
- `BuildDstasFreezeTx`
- `BuildDstasUnfreezeTx`
- `BuildDstasConfiscateTx`
- `BuildDstasRedeemTx`
- `BuildDstasSwapTx`

These helpers are the right starting point when you already know the exact flow you need to build.

### Multi-step planning with `DstasBundleFactory`

Use `DstasBundleFactory` when you want the SDK to plan merge/split/service transactions for you.

Typical use cases:

- many-recipient payouts
- preparing UTXO sizes automatically
- chaining service transactions before final transfers
- building flows where intermediate DSTAS UTXOs must be reshaped before delivery

```ts
import { dstas } from "dxs-bsv-token-sdk/dstas";
import { bsv } from "dxs-bsv-token-sdk/bsv";

const { Address, LockingScriptReader, Transaction, Wallet, utf8ToBytes } = bsv;

const { DstasBundleFactory, DstasSpendType } = dstas;

const stasWallet =
  Wallet.fromMnemonic("<mnemonic>").deriveWallet("m/44'/236'/0'/0/0");
const feeWallet =
  Wallet.fromMnemonic("<mnemonic>").deriveWallet("m/44'/236'/0'/0/1");

const getStasUtxoSet = async (minSats = 0) => {
  return await fetchDstasUtxosForAddress(stasWallet.Address, minSats);
};

const getFundingUtxo = async ({ estimatedFeeSatoshis }) => {
  return await fetchFeeUtxoForAddress(feeWallet.Address, estimatedFeeSatoshis);
};

const getTransactions = async (
  ids: string[],
): Promise<Record<string, Transaction>> => {
  return await fetchTransactionsByIds(ids);
};

const mapSpendTypeToCode = (spendType: DstasSpendType): number => {
  if (spendType === "swap") return 4;
  if (spendType === "confiscation") return 3;
  if (spendType === "freeze" || spendType === "unfreeze") return 2;
  return 1;
};

const factory = new DstasBundleFactory(
  stasWallet,
  feeWallet,
  getFundingUtxo,
  getStasUtxoSet,
  getTransactions,
  ({ fromOutPoint, recipient, spendType, isFreezeLike, isChange }) => {
    const parsed = LockingScriptReader.read(fromOutPoint.LockingScript).Dstas;
    if (!parsed) throw new Error("Expected DSTAS input locking script");
    if (recipient.m !== 1 || recipient.addresses.length !== 1) {
      throw new Error("Example keeps recipient handling at m=1");
    }

    return {
      owner: recipient.addresses[0].Hash160,
      actionData:
        spendType === "swap" && !isChange ? parsed.ActionDataRaw : null,
      redemptionPkh: parsed.Redemption,
      frozen:
        spendType === "freeze"
          ? true
          : spendType === "unfreeze"
            ? false
            : isFreezeLike,
      flags: parsed.Flags,
      serviceFields: parsed.ServiceFields,
      optionalData: parsed.OptionalData,
    };
  },
  ({ txBuilder, inputIndex, spendType, isMerge }) => {
    const input = txBuilder.Inputs[inputIndex];
    input.Merge = isMerge;
    input.DstasSpendingType = mapSpendTypeToCode(spendType);
    input.sign(true);
    if (!input.UnlockingScript) {
      throw new Error("Failed to build DSTAS unlocking script");
    }
    return input.UnlockingScript;
  },
);

const bundle = await factory.transfer({
  outputs: [
    {
      recipient: { m: 1, addresses: [Address.fromBase58("<alice-address>")] },
      satoshis: 150,
    },
    {
      recipient: { m: 1, addresses: [Address.fromBase58("<bob-address>")] },
      satoshis: 200,
    },
  ],
  spendType: "transfer",
  note: [utf8ToBytes("DSTAS"), utf8ToBytes("bundle transfer")],
});
```

Notes:

- `DstasBundleFactory` plans merge/split/transfer service transactions automatically.
- `note` is attached only to final transfer transaction(s), not to intermediate service transactions.
- `spendType` supports `transfer`, `freeze`, `unfreeze`, `confiscation`, and `swap`.

## Low-level BSV toolkit

Use `dxs-bsv-token-sdk/bsv` when you need direct blockchain primitives.

Typical surface:

- keys and wallets: `PrivateKey`, `Wallet`
- addressing: `Address`
- UTXOs: `OutPoint`
- transactions: `Transaction`, `TransactionReader`, `TransactionBuilder`
- script tooling: `ScriptBuilder`, `LockingScriptReader`, `evaluateTransactionHex`
- byte and hash helpers: `fromHex`, `toHex`, `utf8ToBytes`, `hash160`, `hash256`

### Example: build a simple P2PKH transaction

```ts
import { bsv } from "dxs-bsv-token-sdk/bsv";

const {
  Address,
  OutPoint,
  PrivateKey,
  ScriptType,
  TransactionBuilder,
  fromHex,
} = bsv;

const pk = new PrivateKey(
  fromHex("b62fd57a07804f79291317261054eb9b19c9ccec49146c38b30a29d48636c368"),
);
const from = pk.Address;
const to = Address.fromBase58("1MkvWa82XHFqmRHaiRZ8BqZS7Uc83wekjp");
const lockingScript = fromHex(
  "76a914e3b111de8fec527b41f4189e313638075d96ccd688ac",
);

const utxo = new OutPoint(
  "11".repeat(32),
  0,
  lockingScript,
  10_000,
  from,
  ScriptType.p2pkh,
);

const txHex = TransactionBuilder.init()
  .addInput(utxo, pk)
  .addP2PkhOutput(1_000, to)
  .addChangeOutputWithFee(pk.Address, utxo.Satoshis - 1_000, 0.1)
  .sign()
  .toHex();
```

## Older STAS workflow surface

Use `dxs-bsv-token-sdk/stas` only when you need the older STAS flow helpers.

```ts
import { stas } from "dxs-bsv-token-sdk/stas";
import { bsv } from "dxs-bsv-token-sdk/bsv";

const {
  Address,
  OutPoint,
  PrivateKey,
  TokenScheme,
  TransactionReader,
  fromHex,
  utf8ToBytes,
} = bsv;

const issuer = new PrivateKey(
  fromHex("b62fd57a07804f79291317261054eb9b19c9ccec49146c38b30a29d48636c368"),
);
const alice = new PrivateKey(
  fromHex("77b1b7d5bfe1288d94f829baba86d503e1a06b571aaa5d36820be19ef2fe520e"),
);

const tokenScheme = new TokenScheme(
  "Token Name",
  "e3b111de8fec527b41f4189e313638075d96ccd6",
  "TokenSymbol",
  1,
);

const prevTx = TransactionReader.readHex("<issue-tx-hex>");
const stasOut = OutPoint.fromTransaction(prevTx, 0);
const feeOut = OutPoint.fromTransaction(prevTx, 1);

const txHex = stas.BuildTransferTx({
  tokenScheme,
  stasPayment: { OutPoint: stasOut, Owner: alice },
  feePayment: { OutPoint: feeOut, Owner: issuer },
  to: Address.fromBase58("1C2dVLqv1kjNn7pztpQ51bpXVEJfoWUNxe"),
  note: [utf8ToBytes("DXS"), utf8ToBytes("Transfer test")],
});
```

## Binary and data model rules

- Public binary inputs and outputs are `Uint8Array`, not Node.js `Buffer`.
- `OutPoint` represents a spendable UTXO: txid, vout, locking script, satoshis, and owner address.
- `LockingScript` is the canonical property name in API objects.
- `OutPoint.TxId` is stored as big-endian hex and serialized little-endian inside transactions.

## Security and strict mode

Defaults already enabled:

- deterministic ECDSA signing
- `lowS: true`
- `strictTxParse: true`
- `strictOutPointValidation: true`
- `strictFeeRateValidation: true`
- `strictScriptReader: true`
- `strictScriptEvaluation: true`
- strict script-eval max element size of `1024 * 1024`
- compressed secp256k1 multisig key validation with `n <= 5`

Other checks remain opt-in because they are more compatibility-sensitive:

- `strictPresetUnlockingScript`
- `strictMultisigKeys`

```ts
import { bsv } from "dxs-bsv-token-sdk/bsv";

bsv.configureStrictMode({
  strictTxParse: true,
  strictOutPointValidation: true,
  strictFeeRateValidation: true,
  strictPresetUnlockingScript: true,
  strictMultisigKeys: true,
  strictScriptReader: true,
  strictScriptEvaluation: true,
  maxFeeRateSatsPerByte: 5,
  scriptEvaluationLimits: {
    maxScriptSizeBytes: 100000,
    maxOps: 50000,
    maxStackDepth: 1000,
    maxElementSizeBytes: 1024 * 1024,
  },
});
```

## AI agent onboarding

If you are integrating this SDK through an AI coding agent, start with:

- `AGENTS.md`
- `docs/AGENT_RUNBOOK.md`
- `docs/DSTAS_SDK_SPEC.md`

## Author

- Author: [Oleg Panagushin](https://github.com/panagushin)
  CTO / System Architect - Crypto & FinTech
