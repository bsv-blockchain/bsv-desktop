"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DstasBundleFactory = exports.AvgFeeForDstasMerge = void 0;
const bitcoin_1 = require("./bitcoin");
const transaction_1 = require("./transaction");
const transaction_factory_1 = require("./transaction-factory");
const dstas_tx_assembly_1 = require("./dstas-tx-assembly");
exports.AvgFeeForDstasMerge = 500;
class DstasBundleFactory {
    constructor(stasWallet, feeWallet, getFundingUtxo, getStasUtxoSet, getTransactions, buildLockingParams, buildUnlockingScript) {
        this.stasWallet = stasWallet;
        this.feeWallet = feeWallet;
        this.getFundingUtxo = getFundingUtxo;
        this.getStasUtxoSet = getStasUtxoSet;
        this.getTransactions = getTransactions;
        this.buildLockingParams = buildLockingParams;
        this.buildUnlockingScript = buildUnlockingScript;
        this.transfer = (_a) => __awaiter(this, [_a], void 0, function* ({ outputs, spendType = "transfer", note, }) {
            if (outputs.length === 0) {
                throw new Error("At least one transfer output is required");
            }
            for (const output of outputs) {
                if (!Number.isInteger(output.satoshis) || output.satoshis <= 0) {
                    throw new Error(`Transfer output satoshis must be a positive integer, got ${output.satoshis}`);
                }
            }
            const amountSatoshis = outputs.reduce((sum, x) => sum + x.satoshis, 0);
            const stasUtxoSet = (yield this.getStasUtxoSet(amountSatoshis)).sort((a, b) => a.Satoshis - b.Satoshis);
            const availableSatoshis = stasUtxoSet.reduce((a, x) => a + x.Satoshis, 0);
            if (availableSatoshis < amountSatoshis) {
                return {
                    message: "Insufficient STAS tokens balance",
                    feeSatoshis: 0,
                };
            }
            const stasUtxos = this.getStasUtxo(stasUtxoSet, amountSatoshis);
            return this.buildBundleWithResolvedFunding(stasUtxos, amountSatoshis, outputs, spendType, note);
        });
        this.createTransferBundle = (amountSatoshis, recipient, note) => __awaiter(this, void 0, void 0, function* () {
            return this.transfer({
                outputs: [{ recipient, satoshis: amountSatoshis }],
                spendType: "transfer",
                note,
            });
        });
        this.createFreezeBundle = (amountSatoshis, recipient, note) => __awaiter(this, void 0, void 0, function* () {
            return this.transfer({
                outputs: [{ recipient, satoshis: amountSatoshis }],
                spendType: "freeze",
                note,
            });
        });
        this.createUnfreezeBundle = (amountSatoshis, recipient, note) => __awaiter(this, void 0, void 0, function* () {
            return this.transfer({
                outputs: [{ recipient, satoshis: amountSatoshis }],
                spendType: "unfreeze",
                note,
            });
        });
        this.createSwapBundle = (amountSatoshis, recipient, note) => __awaiter(this, void 0, void 0, function* () { return this.createBundle(amountSatoshis, recipient, "swap", note); });
        this.createConfiscationBundle = (amountSatoshis, recipient, note) => __awaiter(this, void 0, void 0, function* () { return this.createBundle(amountSatoshis, recipient, "confiscation", note); });
        this.createBundle = (amountSatoshis, recipient, spendType, note) => __awaiter(this, void 0, void 0, function* () {
            const stasUtxoSet = (yield this.getStasUtxoSet(amountSatoshis)).sort((a, b) => a.Satoshis - b.Satoshis);
            const availableSatoshis = stasUtxoSet.reduce((a, x) => a + x.Satoshis, 0);
            if (availableSatoshis < amountSatoshis)
                return {
                    message: "Insufficient STAS tokens balance",
                    feeSatoshis: 0,
                };
            const stasUtxos = this.getStasUtxo(stasUtxoSet, amountSatoshis);
            return this.buildBundleWithResolvedFunding(stasUtxos, amountSatoshis, [{ recipient, satoshis: amountSatoshis }], spendType, note);
        });
        this.buildBundleWithResolvedFunding = (stasUtxos, amountSatoshis, outputs, spendType, note) => __awaiter(this, void 0, void 0, function* () {
            const utxoIdsToSpend = stasUtxos.map((x) => `${x.TxId}:${x.Vout}`);
            const transactionsCount = this.estimateTransactionsCount(stasUtxos.length, outputs.length);
            const initialEstimatedFeeSatoshis = this.estimateBundleFeeUpperBound(transactionsCount, stasUtxos.length, outputs.length);
            const firstFundingUtxo = yield this.getFundingUtxo({
                utxoIdsToSpend,
                estimatedFeeSatoshis: initialEstimatedFeeSatoshis,
                transactionsCount,
            });
            try {
                return this._createTransferBundle([], stasUtxos, amountSatoshis, firstFundingUtxo, outputs, spendType, note);
            }
            catch (error) {
                if (!this.isInsufficientFeeError(error))
                    throw error;
                const fallbackEstimatedFeeSatoshis = Math.ceil(initialEstimatedFeeSatoshis * 1.5) + 200;
                const secondFundingUtxo = yield this.getFundingUtxo({
                    utxoIdsToSpend,
                    estimatedFeeSatoshis: fallbackEstimatedFeeSatoshis,
                    transactionsCount,
                });
                return this._createTransferBundle([], stasUtxos, amountSatoshis, secondFundingUtxo, outputs, spendType, note);
            }
        });
        this.estimateTransactionsCount = (stasInputCount, outputsCount) => this.estimateMergeTransactionsCount(stasInputCount) +
            this.estimateFinalTransferTransactionsCount(outputsCount);
        this.estimateMergeTransactionsCount = (stasInputCount) => {
            if (stasInputCount <= 1)
                return 0;
            let currentLevelCount = stasInputCount;
            let levelsBeforeTransfer = 0;
            let transactionCount = 0;
            while (currentLevelCount !== 1) {
                if (levelsBeforeTransfer === 3) {
                    levelsBeforeTransfer = 0;
                    transactionCount += currentLevelCount;
                }
                else {
                    levelsBeforeTransfer++;
                    const merges = Math.floor(currentLevelCount / 2);
                    const remainder = currentLevelCount % 2;
                    transactionCount += merges;
                    currentLevelCount = merges + remainder;
                }
            }
            return transactionCount;
        };
        this.estimateFinalTransferTransactionsCount = (outputsCount) => Math.max(1, Math.ceil((outputsCount - 1) / 3));
        this.estimateBundleFeeUpperBound = (transactionsCount, stasInputCount, outputsCount) => Math.max(1200, Math.ceil((transactionsCount * 1400 +
            stasInputCount * 500 +
            outputsCount * 160 +
            500) *
            transaction_factory_1.FeeRate *
            1.5));
        this.isInsufficientFeeError = (error) => {
            var _a;
            if (!(error instanceof Error))
                return false;
            const message = `${error.message}${(_a = error.stack) !== null && _a !== void 0 ? _a : ""}`;
            return message.includes("Insufficient satoshis to pay fee");
        };
        this._createTransferBundle = (transactions, stasUtxos, satoshisToSend, feeUtxo, outputs, spendType, note) => __awaiter(this, void 0, void 0, function* () {
            const { mergeTransactions, mergeFeeUtxo, stasUtxo } = yield this.mergeStasTransactions(stasUtxos, satoshisToSend, feeUtxo);
            if (mergeTransactions) {
                for (const mergeTx of mergeTransactions) {
                    transactions.push(mergeTx);
                }
            }
            const { transactions: transferTransactions, feeOutPoint: feeUtxoOutPoint } = this.buildTransferPlanTransactions(stasUtxo, mergeFeeUtxo, outputs, spendType, note);
            for (const tx of transferTransactions) {
                transactions.push(tx);
            }
            const paidFee = feeUtxo.Satoshis - feeUtxoOutPoint.Satoshis;
            return { transactions, feeSatoshis: paidFee };
        });
        this.buildTransferPlanTransactions = (stasUtxo, feeUtxo, outputs, spendType, note) => {
            let cursor = 0;
            let remainingTotal = outputs.reduce((sum, x) => sum + x.satoshis, 0);
            const transactions = [];
            const selfRecipient = {
                m: 1,
                addresses: [this.stasWallet.Address],
            };
            let currentStas = stasUtxo;
            let currentFee = feeUtxo;
            while (cursor < outputs.length) {
                if (remainingTotal !== currentStas.Satoshis) {
                    throw new Error("Transfer planner invariant failed: remaining outputs must match current STAS input");
                }
                const remainingCount = outputs.length - cursor;
                const isFinal = remainingCount <= 4;
                const transferOutputs = isFinal
                    ? outputs.slice(cursor)
                    : outputs.slice(cursor, cursor + 3);
                const sentSatoshis = transferOutputs.reduce((sum, x) => sum + x.satoshis, 0);
                const txOutputs = transferOutputs.map((x) => ({
                    recipient: x.recipient,
                    satoshis: x.satoshis,
                    isChange: false,
                }));
                if (!isFinal) {
                    txOutputs.push({
                        recipient: selfRecipient,
                        satoshis: currentStas.Satoshis - sentSatoshis,
                        isChange: true,
                    });
                }
                const destinations = this.buildDestinations(currentStas, txOutputs, spendType);
                const txRaw = this.buildDstasTx({
                    stasPayments: [{ OutPoint: currentStas, Owner: this.stasWallet }],
                    feePayment: { OutPoint: currentFee, Owner: this.feeWallet },
                    destinations,
                    note: isFinal ? note : undefined,
                    spendType,
                    isMerge: false,
                });
                const tx = transaction_1.TransactionReader.readHex(txRaw);
                transactions.push(txRaw);
                currentFee = this.getFeeOutPoint(tx);
                if (isFinal)
                    break;
                const changeOutputIndex = txOutputs.length - 1;
                const changeOutput = tx.Outputs[changeOutputIndex];
                if (!changeOutput) {
                    throw new Error("Transfer planner failed to locate STAS change output");
                }
                currentStas = this.outPointFromTransaction(tx, changeOutputIndex);
                cursor += transferOutputs.length;
                remainingTotal -= sentSatoshis;
            }
            return {
                transactions,
                feeOutPoint: currentFee,
            };
        };
        this.getStasUtxo = (utxos, satoshis) => {
            const exactOrGreater = utxos.find((x) => x.Satoshis >= satoshis);
            if (exactOrGreater && exactOrGreater.Satoshis === satoshis) {
                return [exactOrGreater];
            }
            const result = [];
            let accumulated = 0;
            for (const utxo of utxos) {
                result.push(utxo);
                accumulated += utxo.Satoshis;
                if (accumulated >= satoshis)
                    return result;
            }
            return [exactOrGreater];
        };
        this.mergeStasTransactions = (stasUtxos, satoshis, mergeFeeUtxo) => __awaiter(this, void 0, void 0, function* () {
            if (stasUtxos.length === 1)
                return { mergeFeeUtxo, stasUtxo: stasUtxos[0] };
            const mergeTransactions = [];
            const utxos = stasUtxos.map(({ TxId, Vout }) => ({
                TxId,
                Vout,
            }));
            const txIds = Array.from(new Set(stasUtxos.map(({ TxId }) => TxId)));
            const sourceTransactions = yield this.getTransactions(txIds);
            const mergeLevels = [[]];
            for (const { TxId, Vout } of utxos) {
                const tx = sourceTransactions[TxId];
                if (!tx)
                    throw new Error(`Transaction ${TxId} not found`);
                mergeLevels[0].push(this.outPointFromTransaction(tx, Vout));
            }
            const feePayment = {
                OutPoint: mergeFeeUtxo,
                Owner: this.feeWallet,
            };
            let currentLevel = mergeLevels[0];
            let levelsBeforeTransfer = 0;
            let stasUtxo = stasUtxos[0];
            while (currentLevel.length !== 1) {
                const newLevel = [];
                mergeLevels.push(newLevel);
                if (levelsBeforeTransfer === 3) {
                    levelsBeforeTransfer = 0;
                    for (const outPoint of currentLevel) {
                        const stasPayment = {
                            OutPoint: outPoint,
                            Owner: this.stasWallet,
                        };
                        const destinations = this.buildDestinations(outPoint, [
                            {
                                recipient: {
                                    m: 1,
                                    addresses: [this.stasWallet.Address],
                                },
                                satoshis: outPoint.Satoshis,
                                isChange: false,
                            },
                        ], "transfer");
                        const txRaw = this.buildDstasTx({
                            stasPayments: [stasPayment],
                            feePayment,
                            destinations,
                            spendType: "transfer",
                            isMerge: false,
                        });
                        const tx = transaction_1.TransactionReader.readHex(txRaw);
                        newLevel.push(this.getStasOutPoint(tx));
                        mergeTransactions.push(txRaw);
                        stasUtxo = this.getStasOutPoint(tx);
                        feePayment.OutPoint = this.getFeeOutPoint(tx);
                    }
                }
                else {
                    levelsBeforeTransfer++;
                    const mergeCounts = Math.floor(currentLevel.length / 2);
                    const remainder = currentLevel.length % 2;
                    if (remainder !== 0)
                        newLevel.push(currentLevel[currentLevel.length - 1]);
                    let currentIdx = 0;
                    for (let i = 0; i < mergeCounts; i++) {
                        const outPoint1 = currentLevel[currentIdx++];
                        const outPoint2 = currentLevel[currentIdx++];
                        const lastMerge = mergeCounts === 1 && remainder === 0;
                        const inputSatoshis = outPoint1.Satoshis + outPoint2.Satoshis;
                        let outputs = [
                            {
                                recipient: {
                                    m: 1,
                                    addresses: [this.stasWallet.Address],
                                },
                                satoshis: inputSatoshis,
                                isChange: false,
                            },
                        ];
                        if (lastMerge && inputSatoshis !== satoshis) {
                            outputs = [
                                {
                                    recipient: {
                                        m: 1,
                                        addresses: [this.stasWallet.Address],
                                    },
                                    satoshis,
                                    isChange: false,
                                },
                                {
                                    recipient: {
                                        m: 1,
                                        addresses: [this.stasWallet.Address],
                                    },
                                    satoshis: inputSatoshis - satoshis,
                                    isChange: true,
                                },
                            ];
                        }
                        const destinations = this.buildDestinations(outPoint1, outputs, "merge");
                        const txRaw = this.buildDstasTx({
                            stasPayments: [
                                { OutPoint: outPoint1, Owner: this.stasWallet },
                                { OutPoint: outPoint2, Owner: this.stasWallet },
                            ],
                            feePayment,
                            destinations,
                            spendType: "merge",
                            isMerge: true,
                        });
                        const tx = transaction_1.TransactionReader.readHex(txRaw);
                        newLevel.push(this.getStasOutPoint(tx));
                        mergeTransactions.push(txRaw);
                        stasUtxo = this.getStasOutPoint(tx);
                        feePayment.OutPoint = this.getFeeOutPoint(tx);
                    }
                }
                currentLevel = newLevel;
            }
            return { mergeTransactions, mergeFeeUtxo: feePayment.OutPoint, stasUtxo };
        });
        this.buildDstasTx = (params) => {
            const { stasPayments, feePayment, destinations, note, feeRate, spendType, isMerge, } = params;
            if (stasPayments.length === 0)
                throw new Error("At least one STAS input is required");
            if (destinations.length === 0)
                throw new Error("At least one destination is required");
            (0, dstas_tx_assembly_1.validateDstasAmounts)(stasPayments, destinations);
            return (0, dstas_tx_assembly_1.buildSignedDstasTransaction)({
                stasPayments,
                feePayment,
                destinations,
                note,
                feeRate: feeRate !== null && feeRate !== void 0 ? feeRate : transaction_factory_1.FeeRate,
                isMerge,
                configureStasInput: ({ phase, txBuilder, inputIndex }) => {
                    const input = txBuilder.Inputs[inputIndex];
                    input.AllowPresetUnlockingScript = true;
                    const unlockingArgs = {
                        txBuilder,
                        inputIndex,
                        outPoint: input.OutPoint,
                        spendType,
                        isFreezeLike: spendType === "freeze" || spendType === "unfreeze",
                        isMerge,
                    };
                    if (typeof this.buildUnlockingScript.estimateSize === "function") {
                        if (phase === "estimate") {
                            input.PresetUnlockingScriptSizeHint =
                                this.buildUnlockingScript.estimateSize(unlockingArgs);
                            input.UnlockingScript = undefined;
                            return;
                        }
                        input.PresetUnlockingScriptSizeHint = undefined;
                        input.UnlockingScript = this.buildUnlockingScript(unlockingArgs);
                        return;
                    }
                    input.UnlockingScript = this.buildUnlockingScript(unlockingArgs);
                },
            });
        };
        this.buildDestinations = (sourceOutPoint, outputs, spendType) => {
            const outputCount = outputs.length;
            return outputs.map((output, index) => ({
                Satoshis: output.satoshis,
                LockingParams: this.buildLockingParams({
                    fromOutPoint: sourceOutPoint,
                    recipient: output.recipient,
                    spendType,
                    isFreezeLike: spendType === "freeze" || spendType === "unfreeze",
                    outputIndex: index,
                    outputCount,
                    isChange: output.isChange,
                }),
            }));
        };
        this.outPointFromTransaction = (tx, vout) => {
            const output = tx.Outputs[vout];
            const outPoint = new bitcoin_1.OutPoint(tx.Id, vout, output.LockingScript, output.Satoshis, output.Address, output.ScriptType);
            outPoint.Transaction = tx;
            return outPoint;
        };
        this.getStasOutPoint = (tx) => {
            const index = tx.Outputs.findIndex((output) => output.ScriptType !== bitcoin_1.ScriptType.p2pkh &&
                output.ScriptType !== bitcoin_1.ScriptType.p2mpkh &&
                output.ScriptType !== bitcoin_1.ScriptType.nullData);
            if (index === -1)
                throw new Error("STAS output not found");
            return this.outPointFromTransaction(tx, index);
        };
        this.getFeeOutPoint = (tx) => {
            for (let i = tx.Outputs.length - 1; i >= 0; i--) {
                const output = tx.Outputs[i];
                if (output.ScriptType === bitcoin_1.ScriptType.p2pkh ||
                    output.ScriptType === bitcoin_1.ScriptType.p2mpkh) {
                    return new bitcoin_1.OutPoint(tx.Id, i, output.LockingScript, output.Satoshis, output.Address, output.ScriptType);
                }
            }
            throw new Error("Fee output not found");
        };
    }
}
exports.DstasBundleFactory = DstasBundleFactory;
//# sourceMappingURL=dstas-bundle-factory.js.map