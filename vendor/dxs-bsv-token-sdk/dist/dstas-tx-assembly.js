"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSignedDstasIssueTransaction = exports.buildSignedDstasTransaction = exports.validateDstasAmounts = exports.buildDstasLockingScriptBuilder = void 0;
const dstas_locking_builder_1 = require("./script/build/dstas-locking-builder");
const p2pkh_builder_1 = require("./script/build/p2pkh-builder");
const script_builder_1 = require("./script/build/script-builder");
const transaction_factory_1 = require("./transaction-factory");
const script_type_1 = require("./bitcoin/script-type");
const transaction_builder_1 = require("./transaction/build/transaction-builder");
const output_builder_1 = require("./transaction/build/output-builder");
const buildDstasLockingScriptBuilder = (params) => {
    const tokens = (0, dstas_locking_builder_1.buildDstasLockingTokens)(params);
    return script_builder_1.ScriptBuilder.fromTokens(tokens, script_type_1.ScriptType.dstas);
};
exports.buildDstasLockingScriptBuilder = buildDstasLockingScriptBuilder;
const validateDstasAmounts = (stasPayments, destinations) => {
    const inputTotal = stasPayments.reduce((sum, payment) => sum + payment.OutPoint.Satoshis, 0);
    const outputTotal = destinations.reduce((sum, dest) => sum + dest.Satoshis, 0);
    if (inputTotal !== outputTotal) {
        throw new Error("Input satoshis must be equal output satoshis");
    }
};
exports.validateDstasAmounts = validateDstasAmounts;
const buildSignedDstasTransaction = ({ stasPayments, feePayment, destinations, note, feeRate = transaction_factory_1.FeeRate, omitChangeOutput = false, isMerge = false, configureStasInput, }) => {
    if (stasPayments.length === 0) {
        throw new Error("At least one STAS input is required");
    }
    if (destinations.length === 0) {
        throw new Error("At least one destination is required");
    }
    (0, exports.validateDstasAmounts)(stasPayments, destinations);
    const txBuilder = transaction_builder_1.TransactionBuilder.init();
    const stasInputIdxs = [];
    for (const payment of stasPayments) {
        if (isMerge) {
            txBuilder.addStasMergeInput(payment.OutPoint, payment.Owner);
        }
        else {
            txBuilder.addInput(payment.OutPoint, payment.Owner);
        }
        stasInputIdxs.push(txBuilder.Inputs.length - 1);
    }
    txBuilder.addInput(feePayment.OutPoint, feePayment.Owner);
    for (const destination of destinations) {
        const lockingScript = (0, exports.buildDstasLockingScriptBuilder)(destination.LockingParams);
        txBuilder.Outputs.push(new output_builder_1.OutputBuilder(lockingScript, destination.Satoshis));
    }
    const feeOutputIdx = txBuilder.Outputs.length;
    let changeOutput;
    if (note) {
        txBuilder.addNullDataOutput(note);
    }
    if (!omitChangeOutput) {
        changeOutput = new output_builder_1.OutputBuilder(new p2pkh_builder_1.P2pkhBuilder(feePayment.OutPoint.Address), feePayment.OutPoint.Satoshis);
        txBuilder.Outputs.splice(feeOutputIdx, 0, changeOutput);
    }
    const runConfigure = (phase) => {
        stasInputIdxs.forEach((inputIndex, stasInputIndex) => {
            configureStasInput === null || configureStasInput === void 0 ? void 0 : configureStasInput({
                phase,
                txBuilder,
                inputIndex,
                payment: stasPayments[stasInputIndex],
                stasInputIndex,
                isMerge,
            });
        });
    };
    runConfigure("estimate");
    if (!omitChangeOutput) {
        const fee = txBuilder.getFee(feeRate);
        if (fee >= feePayment.OutPoint.Satoshis) {
            throw new Error(`Insufficient satoshis to pay fee`);
        }
        changeOutput.Satoshis = feePayment.OutPoint.Satoshis - fee;
    }
    runConfigure("finalize");
    return txBuilder.sign().toHex();
};
exports.buildSignedDstasTransaction = buildSignedDstasTransaction;
const buildSignedDstasIssueTransaction = ({ contractOutPoint, contractChangeOutPoint, contractOwner, destinations, feeRate = transaction_factory_1.FeeRate, }) => {
    if (destinations.length === 0) {
        throw new Error("At least one destination is required");
    }
    const txBuilder = transaction_builder_1.TransactionBuilder.init()
        .addInput(contractOutPoint.OutPoint, contractOwner)
        .addInput(contractChangeOutPoint.OutPoint, contractOwner);
    for (const destination of destinations) {
        const lockingScript = (0, exports.buildDstasLockingScriptBuilder)(destination.LockingParams);
        txBuilder.Outputs.push(new output_builder_1.OutputBuilder(lockingScript, destination.Satoshis));
    }
    const feeOutputIdx = txBuilder.Outputs.length;
    txBuilder.addChangeOutputWithFee(contractChangeOutPoint.OutPoint.Address, contractChangeOutPoint.OutPoint.Satoshis, feeRate, feeOutputIdx);
    return txBuilder.sign().toHex();
};
exports.buildSignedDstasIssueTransaction = buildSignedDstasIssueTransaction;
//# sourceMappingURL=dstas-tx-assembly.js.map