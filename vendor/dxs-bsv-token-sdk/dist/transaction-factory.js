"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildRedeemTx = exports.BuildMergeTx = exports.BuildSplitTx = exports.BuildTransferTx = exports.FeeRate = void 0;
const bitcoin_1 = require("./bitcoin");
const transaction_builder_1 = require("./transaction/build/transaction-builder");
exports.FeeRate = 0.1;
const BuildTransferTx = ({ tokenScheme, stasPayment, feePayment, to, note, feeRate, }) => {
    const txBuilder = transaction_builder_1.TransactionBuilder.init()
        .addInput(stasPayment.OutPoint, stasPayment.Owner)
        .addInput(feePayment.OutPoint, feePayment.Owner)
        .addStasOutputByScheme(tokenScheme, stasPayment.OutPoint.Satoshis, to);
    const feeOutputIdx = txBuilder.Outputs.length;
    if (note)
        txBuilder.addNullDataOutput(note);
    return txBuilder
        .addChangeOutputWithFee(feePayment.OutPoint.Address, feePayment.OutPoint.Satoshis, feeRate, feeOutputIdx)
        .sign()
        .toHex();
};
exports.BuildTransferTx = BuildTransferTx;
const BuildSplitTx = ({ tokenScheme, stasPayment, feePayment, destinations, note, feeRate, }) => {
    if (destinations.length === 0 || destinations.length > 4)
        throw new Error("Destinations count must be no less than one and no more than four");
    const outputSatoshis = destinations.reduce((a, x) => a + x.Satoshis, 0);
    if (outputSatoshis !== stasPayment.OutPoint.Satoshis)
        throw new Error("Input satoshis must be equal output satoshis");
    const txBuilder = transaction_builder_1.TransactionBuilder.init()
        .addInput(stasPayment.OutPoint, stasPayment.Owner)
        .addInput(feePayment.OutPoint, feePayment.Owner);
    for (const destination of destinations)
        txBuilder.addStasOutputByScheme(tokenScheme, destination.Satoshis, destination.Address);
    const feeOutputIdx = txBuilder.Outputs.length;
    if (note)
        txBuilder.addNullDataOutput(note);
    return txBuilder
        .addChangeOutputWithFee(feePayment.OutPoint.Address, feePayment.OutPoint.Satoshis, feeRate, feeOutputIdx)
        .sign()
        .toHex();
};
exports.BuildSplitTx = BuildSplitTx;
const BuildMergeTx = ({ tokenScheme, outPoint1, outPoint2, owner, feePayment, destination, splitDestination, note, feeRate, }) => {
    var _a;
    if (outPoint1.Address.Value !== outPoint2.Address.Value)
        throw new Error("Both inputs have to belong to same address");
    const outputSatoshis = destination.Satoshis + ((_a = splitDestination === null || splitDestination === void 0 ? void 0 : splitDestination.Satoshis) !== null && _a !== void 0 ? _a : 0);
    if (outputSatoshis !== outPoint1.Satoshis + outPoint2.Satoshis)
        throw new Error("Input satoshis must be equal output satoshis");
    const txBuilder = transaction_builder_1.TransactionBuilder.init()
        .addStasMergeInput(outPoint1, owner)
        .addStasMergeInput(outPoint2, owner)
        .addInput(feePayment.OutPoint, feePayment.Owner)
        .addStasOutputByScheme(tokenScheme, destination.Satoshis, destination.Address);
    if (splitDestination)
        txBuilder.addStasOutputByScheme(tokenScheme, splitDestination.Satoshis, splitDestination.Address);
    const feeOutputIdx = txBuilder.Outputs.length;
    if (note)
        txBuilder.addNullDataOutput(note);
    return txBuilder
        .addChangeOutputWithFee(feePayment.OutPoint.Address, feePayment.OutPoint.Satoshis, feeRate, feeOutputIdx)
        .sign()
        .toHex();
};
exports.BuildMergeTx = BuildMergeTx;
const BuildRedeemTx = ({ tokenScheme, stasPayment, feePayment, splitDestinations, note, feeRate, }) => {
    var _a, _b;
    const redeemAddress = bitcoin_1.Address.fromHash160Hex(tokenScheme.TokenId);
    if (stasPayment.OutPoint.Address.Value !== redeemAddress.Value)
        throw new Error("Only owner of redeem address can redeem STAS tokens");
    if (((_a = splitDestinations === null || splitDestinations === void 0 ? void 0 : splitDestinations.length) !== null && _a !== void 0 ? _a : 0) > 3)
        throw new Error("Destinations count must be no more than 3");
    const splitAmount = (_b = splitDestinations === null || splitDestinations === void 0 ? void 0 : splitDestinations.reduce((a, x) => a + x.Satoshis, 0)) !== null && _b !== void 0 ? _b : 0;
    const redeemAmount = stasPayment.OutPoint.Satoshis - splitAmount;
    if (redeemAmount < 0)
        throw new Error("Input satoshis must be equal output satoshis");
    if (redeemAmount === 0)
        throw new Error("redeemAmount must be at least 1 satoshi");
    const txBuilder = transaction_builder_1.TransactionBuilder.init()
        .addInput(stasPayment.OutPoint, stasPayment.Owner)
        .addInput(feePayment.OutPoint, feePayment.Owner)
        .addP2PkhOutput(redeemAmount, redeemAddress);
    if (splitDestinations)
        for (const splitDestination of splitDestinations)
            txBuilder.addStasOutputByScheme(tokenScheme, splitDestination.Satoshis, splitDestination.Address);
    const feeOutputIdx = txBuilder.Outputs.length;
    if (note)
        txBuilder.addNullDataOutput(note);
    return txBuilder
        .addChangeOutputWithFee(feePayment.OutPoint.Address, feePayment.OutPoint.Satoshis, feeRate, feeOutputIdx)
        .sign()
        .toHex();
};
exports.BuildRedeemTx = BuildRedeemTx;
//# sourceMappingURL=transaction-factory.js.map