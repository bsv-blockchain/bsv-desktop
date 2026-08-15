"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildDstasMergeTx = exports.BuildDstasSplitTx = exports.BuildDstasTransferTx = exports.BuildDstasMultisigTx = exports.BuildDstasSwapFlowTx = exports.BuildDstasSwapSwapTx = exports.BuildDstasTransferSwapTx = exports.ResolveDstasSwapMode = exports.BuildDstasConfiscateTx = exports.BuildDstasSwapTx = exports.BuildDstasUnfreezeTx = exports.BuildDstasFreezeTx = exports.BuildDstasIssueTxs = exports.BuildDstasBaseTx = void 0;
const bitcoin_1 = require("./bitcoin");
const script_type_1 = require("./bitcoin/script-type");
const bytes_1 = require("./bytes");
const dstas_locking_builder_1 = require("./script/build/dstas-locking-builder");
const transaction_builder_1 = require("./transaction/build/transaction-builder");
const transaction_reader_1 = require("./transaction/read/transaction-reader");
const transaction_factory_1 = require("./transaction-factory");
const hashes_1 = require("./hashes");
const locking_script_reader_1 = require("./script/read/locking-script-reader");
const secp256k1_1 = require("@noble/secp256k1");
const dstas_tx_assembly_1 = require("./dstas-tx-assembly");
const resolveUnlockingScript = (payment) => payment.UnlockingScript;
const deriveFlagsFromScheme = (scheme) => (0, dstas_locking_builder_1.buildDstasFlags)({
    freezable: scheme.Freeze,
    confiscatable: scheme.Confiscation,
});
const isCompressedPubKey = (key) => key.length === 33 && (key[0] === 0x02 || key[0] === 0x03);
const validateMultisigPolicy = (m, n, role) => {
    if (n <= 0) {
        throw new Error(`${role} must define at least one public key`);
    }
    if (n > 5) {
        throw new Error(`${role} supports at most 5 public keys, got ${n}`);
    }
    if (m <= 0 || m > n) {
        throw new Error(`${role} has invalid threshold m=${m}, n=${n}`);
    }
};
const validateMultisigPublicKeys = (keys, role) => {
    const seen = new Set();
    for (const keyHex of keys) {
        const normalized = keyHex.toLowerCase();
        const key = (0, bytes_1.fromHex)(keyHex);
        if (!isCompressedPubKey(key)) {
            throw new Error(`${role} public key must be a compressed SEC key`);
        }
        try {
            secp256k1_1.Point.fromHex(normalized);
        }
        catch (_a) {
            throw new Error(`${role} public key must be a valid compressed secp256k1 point`);
        }
        if (seen.has(normalized)) {
            throw new Error(`${role} contains duplicate public keys`);
        }
        seen.add(normalized);
    }
};
const buildAuthorityServiceField = (authority, role) => {
    var _a, _b;
    const keys = (_a = authority === null || authority === void 0 ? void 0 : authority.publicKeys) !== null && _a !== void 0 ? _a : [];
    if (keys.length === 0) {
        throw new Error(`${role} authority must define at least one public key for service field derivation`);
    }
    const m = (_b = authority === null || authority === void 0 ? void 0 : authority.m) !== null && _b !== void 0 ? _b : 1;
    const n = keys.length;
    validateMultisigPolicy(m, n, `${role} authority`);
    validateMultisigPublicKeys(keys, `${role} authority`);
    if (m === 1 && n === 1) {
        return (0, hashes_1.hash160)((0, bytes_1.fromHex)(keys[0]));
    }
    const preimage = new Uint8Array(1 + n * (1 + 33) + 1);
    let offset = 0;
    preimage[offset++] = m & 0xff;
    for (const keyHex of keys) {
        const key = (0, bytes_1.fromHex)(keyHex);
        if (key.length !== 33) {
            throw new Error(`${role} authority public key must be 33 bytes`);
        }
        preimage[offset++] = 0x21;
        preimage.set(key, offset);
        offset += key.length;
    }
    preimage[offset] = n & 0xff;
    return (0, hashes_1.hash160)(preimage);
};
const deriveServiceFieldsFromScheme = (scheme) => {
    const serviceFields = [];
    if (scheme.Freeze) {
        serviceFields.push(buildAuthorityServiceField(scheme.FreezeAuthority, "freeze"));
    }
    if (scheme.Confiscation) {
        serviceFields.push(buildAuthorityServiceField(scheme.ConfiscationAuthority, "confiscation"));
    }
    return serviceFields;
};
const resolveLockingParams = (dest, schemeFromRequest) => {
    var _a, _b, _c, _d;
    if ("LockingParams" in dest)
        return dest.LockingParams;
    const scheme = schemeFromRequest;
    if (!scheme) {
        throw new Error("scheme must be provided at request level when destination does not define LockingParams");
    }
    const ownerFromMultisig = (() => {
        if (!dest.ToOwnerMultisig)
            return undefined;
        const { m, publicKeys } = dest.ToOwnerMultisig;
        if (publicKeys.length === 0) {
            throw new Error("ToOwnerMultisig.publicKeys must not be empty");
        }
        validateMultisigPolicy(m, publicKeys.length, "ToOwnerMultisig");
        validateMultisigPublicKeys(publicKeys, "ToOwnerMultisig");
        const preimage = new Uint8Array(1 + publicKeys.length * (1 + 33) + 1);
        let off = 0;
        preimage[off++] = m & 0xff;
        for (const keyHex of publicKeys) {
            const key = (0, bytes_1.fromHex)(keyHex);
            if (key.length !== 33) {
                throw new Error(`ToOwnerMultisig public key must be 33 bytes, got ${key.length}`);
            }
            preimage[off++] = 0x21;
            preimage.set(key, off);
            off += key.length;
        }
        preimage[off] = publicKeys.length & 0xff;
        return (0, hashes_1.hash160)(preimage);
    })();
    const owner = (_b = (_a = dest.ToOwner) !== null && _a !== void 0 ? _a : ownerFromMultisig) !== null && _b !== void 0 ? _b : (_c = dest.To) === null || _c === void 0 ? void 0 : _c.Hash160;
    if (!owner) {
        throw new Error("Destination must provide To (address) or ToOwner (raw owner field bytes)");
    }
    return {
        owner,
        actionData: (_d = dest.ActionData) !== null && _d !== void 0 ? _d : null,
        redemptionPkh: (0, bytes_1.fromHex)(scheme.TokenId),
        frozen: dest.Frozen === true,
        flags: deriveFlagsFromScheme(scheme),
        serviceFields: deriveServiceFieldsFromScheme(scheme),
        optionalData: dest.OptionalData !== undefined ? dest.OptionalData : [],
    };
};
const validateDestinationSatoshis = (destinations) => {
    for (const [idx, destination] of destinations.entries()) {
        if (!Number.isInteger(destination.Satoshis) || destination.Satoshis <= 0) {
            throw new Error(`Destination[${idx}] satoshis must be a positive integer, got ${destination.Satoshis}`);
        }
    }
};
const validateFundingAgainstScheme = (fundingPayment, scheme) => {
    const issuerTokenId = (0, bytes_1.toHex)(fundingPayment.OutPoint.Address.Hash160);
    if (issuerTokenId.toLowerCase() !== scheme.TokenId.toLowerCase()) {
        throw new Error(`scheme.TokenId must match issuer address hash160 (${issuerTokenId})`);
    }
};
const BuildDstasBaseTx = ({ stasPayments, feePayment, destinations, scheme, spendingType, note, feeRate = transaction_factory_1.FeeRate, omitChangeOutput = false, }) => {
    if (stasPayments.length === 0)
        throw new Error("At least one STAS input is required");
    if (stasPayments.length > 2)
        throw new Error("At most 2 STAS inputs are supported");
    if (destinations.length === 0)
        throw new Error("At least one destination is required");
    validateDestinationSatoshis(destinations);
    const resolvedDestinations = destinations.map((destination) => ({
        Satoshis: destination.Satoshis,
        LockingParams: resolveLockingParams(destination, scheme),
    }));
    return (0, dstas_tx_assembly_1.buildSignedDstasTransaction)({
        stasPayments,
        feePayment,
        destinations: resolvedDestinations,
        note,
        feeRate,
        omitChangeOutput,
        isMerge: stasPayments.length > 1,
        configureStasInput: ({ phase, txBuilder, inputIndex, payment }) => {
            txBuilder.Inputs[inputIndex].DstasSpendingType = spendingType !== null && spendingType !== void 0 ? spendingType : 1;
            const unlocking = resolveUnlockingScript(payment);
            if (unlocking) {
                txBuilder.Inputs[inputIndex].AllowPresetUnlockingScript = true;
                if (phase === "estimate") {
                    txBuilder.Inputs[inputIndex].PresetUnlockingScriptSizeHint =
                        unlocking.length;
                    txBuilder.Inputs[inputIndex].UnlockingScript = undefined;
                }
                else {
                    txBuilder.Inputs[inputIndex].PresetUnlockingScriptSizeHint =
                        undefined;
                    txBuilder.Inputs[inputIndex].UnlockingScript = unlocking;
                }
            }
        },
    });
};
exports.BuildDstasBaseTx = BuildDstasBaseTx;
const BuildDstasIssueTxs = ({ fundingPayment, scheme, destinations, feeRate = transaction_factory_1.FeeRate, }) => {
    if (destinations.length === 0)
        throw new Error("At least one destination is required");
    validateDestinationSatoshis(destinations);
    validateFundingAgainstScheme(fundingPayment, scheme);
    const totalIssueSatoshis = destinations.reduce((sum, d) => sum + d.Satoshis, 0);
    const contractChangeBudget = fundingPayment.OutPoint.Satoshis - totalIssueSatoshis;
    if (contractChangeBudget <= 0) {
        throw new Error("Funding output must be greater than total tokenized satoshis");
    }
    const contractTxHex = transaction_builder_1.TransactionBuilder.init()
        .addInput(fundingPayment.OutPoint, fundingPayment.Owner)
        .addP2PkhOutput(totalIssueSatoshis, fundingPayment.OutPoint.Address, [
        scheme.toBytes(),
    ])
        .addChangeOutputWithFee(fundingPayment.OutPoint.Address, contractChangeBudget, feeRate)
        .sign()
        .toHex();
    const contractTx = transaction_reader_1.TransactionReader.readHex(contractTxHex);
    const contractOutPoint = new bitcoin_1.OutPoint(contractTx.Id, 0, contractTx.Outputs[0].LockingScript, contractTx.Outputs[0].Satoshis, fundingPayment.OutPoint.Address, script_type_1.ScriptType.p2pkh);
    const contractChangeOutput = contractTx.Outputs[1];
    if (!contractChangeOutput) {
        throw new Error("Contract tx does not have a change output to fund issue tx fee");
    }
    const contractChangeOutPoint = new bitcoin_1.OutPoint(contractTx.Id, 1, contractChangeOutput.LockingScript, contractChangeOutput.Satoshis, fundingPayment.OutPoint.Address, script_type_1.ScriptType.p2pkh);
    const issueTxHex = (0, dstas_tx_assembly_1.buildSignedDstasIssueTransaction)({
        contractOutPoint: {
            OutPoint: contractOutPoint,
            Owner: fundingPayment.Owner,
        },
        contractChangeOutPoint: {
            OutPoint: contractChangeOutPoint,
            Owner: fundingPayment.Owner,
        },
        contractOwner: fundingPayment.Owner,
        destinations: destinations.map((dest) => ({
            Satoshis: dest.Satoshis,
            LockingParams: resolveLockingParams(dest, scheme),
        })),
        feeRate,
    });
    return { contractTxHex, issueTxHex };
};
exports.BuildDstasIssueTxs = BuildDstasIssueTxs;
const BuildDstasFreezeTx = (request) => (0, exports.BuildDstasBaseTx)(Object.assign(Object.assign({}, request), { spendingType: 2 }));
exports.BuildDstasFreezeTx = BuildDstasFreezeTx;
const BuildDstasUnfreezeTx = (request) => (0, exports.BuildDstasBaseTx)(Object.assign(Object.assign({}, request), { spendingType: 2 }));
exports.BuildDstasUnfreezeTx = BuildDstasUnfreezeTx;
const BuildDstasSwapTx = (request) => (0, exports.BuildDstasBaseTx)(Object.assign(Object.assign({}, request), { spendingType: 4 }));
exports.BuildDstasSwapTx = BuildDstasSwapTx;
const BuildDstasConfiscateTx = (request) => (0, exports.BuildDstasBaseTx)(Object.assign(Object.assign({}, request), { spendingType: 3 }));
exports.BuildDstasConfiscateTx = BuildDstasConfiscateTx;
const hasSwapActionData = (payment) => {
    var _a, _b;
    const reader = locking_script_reader_1.LockingScriptReader.read(payment.OutPoint.LockingScript);
    if (reader.ScriptType !== script_type_1.ScriptType.dstas)
        return false;
    return ((_b = (_a = reader.Dstas) === null || _a === void 0 ? void 0 : _a.ActionDataParsed) === null || _b === void 0 ? void 0 : _b.kind) === "swap";
};
const ResolveDstasSwapMode = (stasPayments) => {
    const [left, right] = stasPayments;
    const leftIsSwap = hasSwapActionData(left);
    const rightIsSwap = hasSwapActionData(right);
    return leftIsSwap && rightIsSwap ? "swap-swap" : "transfer-swap";
};
exports.ResolveDstasSwapMode = ResolveDstasSwapMode;
const toSwapFlowDestination = (value) => {
    var _a;
    if (value.Freezable && !value.FreezeAuthorityServiceField) {
        throw new Error("FreezeAuthorityServiceField is required when Freezable=true");
    }
    if (value.Confiscatable && !value.ConfiscationAuthorityServiceField) {
        throw new Error("ConfiscationAuthorityServiceField is required when Confiscatable=true");
    }
    return {
        Satoshis: value.Satoshis,
        LockingParams: {
            owner: value.Owner,
            actionData: value.ActionData !== undefined ? value.ActionData : null,
            redemptionPkh: (0, bytes_1.fromHex)(value.TokenIdHex),
            flags: (0, dstas_locking_builder_1.buildDstasFlags)({
                freezable: value.Freezable,
                confiscatable: value.Confiscatable === true,
            }),
            serviceFields: [
                ...(value.Freezable
                    ? [value.FreezeAuthorityServiceField]
                    : []),
                ...(value.Confiscatable
                    ? [value.ConfiscationAuthorityServiceField]
                    : []),
            ],
            optionalData: (_a = value.OptionalData) !== null && _a !== void 0 ? _a : [],
        },
    };
};
const BuildDstasTransferSwapTx = ({ stasPayments, feePayment, destinations, note, feeRate, omitChangeOutput, }) => (0, exports.BuildDstasBaseTx)({
    stasPayments,
    feePayment,
    destinations: destinations.map(toSwapFlowDestination),
    note,
    feeRate,
    omitChangeOutput,
    spendingType: 1,
});
exports.BuildDstasTransferSwapTx = BuildDstasTransferSwapTx;
const BuildDstasSwapSwapTx = ({ stasPayments, feePayment, destinations, note, feeRate, omitChangeOutput, }) => (0, exports.BuildDstasBaseTx)({
    stasPayments,
    feePayment,
    destinations: destinations.map(toSwapFlowDestination),
    note,
    feeRate,
    omitChangeOutput,
    spendingType: 4,
});
exports.BuildDstasSwapSwapTx = BuildDstasSwapSwapTx;
const BuildDstasSwapFlowTx = (_a) => {
    var { mode = "auto" } = _a, request = __rest(_a, ["mode"]);
    const resolvedMode = mode === "auto" ? (0, exports.ResolveDstasSwapMode)(request.stasPayments) : mode;
    if (resolvedMode === "swap-swap") {
        return (0, exports.BuildDstasSwapSwapTx)(request);
    }
    return (0, exports.BuildDstasTransferSwapTx)(request);
};
exports.BuildDstasSwapFlowTx = BuildDstasSwapFlowTx;
const BuildDstasMultisigTx = (request) => (0, exports.BuildDstasBaseTx)(request);
exports.BuildDstasMultisigTx = BuildDstasMultisigTx;
const BuildDstasTransferTx = ({ stasPayment, feePayment, destination, scheme, note, feeRate, omitChangeOutput, }) => (0, exports.BuildDstasBaseTx)({
    stasPayments: [stasPayment],
    feePayment,
    destinations: [destination],
    scheme,
    note,
    feeRate,
    omitChangeOutput,
});
exports.BuildDstasTransferTx = BuildDstasTransferTx;
const BuildDstasSplitTx = ({ stasPayment, feePayment, destinations, scheme, note, feeRate, }) => (0, exports.BuildDstasBaseTx)({
    stasPayments: [stasPayment],
    feePayment,
    destinations,
    scheme,
    note,
    feeRate,
});
exports.BuildDstasSplitTx = BuildDstasSplitTx;
const BuildDstasMergeTx = ({ stasPayments, feePayment, destinations, scheme, note, feeRate, }) => {
    if (stasPayments.length !== 2) {
        throw new Error("DSTAS merge requires exactly 2 STAS inputs");
    }
    return (0, exports.BuildDstasBaseTx)({
        stasPayments,
        feePayment,
        destinations,
        scheme,
        note,
        feeRate,
    });
};
exports.BuildDstasMergeTx = BuildDstasMergeTx;
//# sourceMappingURL=dstas-factory.js.map