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
exports.StasBundleFactory = exports.AvgFeeForMerge = void 0;
const bitcoin_1 = require("./bitcoin");
const transaction_1 = require("./transaction");
const transaction_factory_1 = require("./transaction-factory");
const bytes_1 = require("./bytes");
const hashes_1 = require("./hashes");
const p2pkh_builder_1 = require("./script/build/p2pkh-builder");
exports.AvgFeeForMerge = 500;
class StasBundleFactory {
    constructor(tokenScheme, stasWallet, feeWallet, getFundingUtxo, getStasUtxoSet, getTransactions) {
        this.tokenScheme = tokenScheme;
        this.stasWallet = stasWallet;
        this.feeWallet = feeWallet;
        this.getFundingUtxo = getFundingUtxo;
        this.getStasUtxoSet = getStasUtxoSet;
        this.getTransactions = getTransactions;
        this.createBundle = (amountSatoshis, to, note) => __awaiter(this, void 0, void 0, function* () {
            const stasUtxoSet = (yield this.getStasUtxoSet(amountSatoshis)).sort((a, b) => a.Satoshis - b.Satoshis);
            const availableSatoshis = stasUtxoSet.reduce((a, x) => a + x.Satoshis, 0);
            if (availableSatoshis < amountSatoshis)
                return {
                    message: "Insufficient STAS tokens balance",
                    feeSatoshis: 0,
                };
            const stasUtxos = this.getStasUtxo(stasUtxoSet, amountSatoshis);
            const { feeSatoshis: estimatedFee, transactions: { length: transactionsCount }, } = yield this._createBundle([], stasUtxos, amountSatoshis, this.buildFeeProbeOutPoint(), to, note);
            const adjustedEstimatedFee = estimatedFee + stasUtxos.length * 9 + 1;
            const fudingUtxo = yield this.getFundingUtxo({
                utxoIdsToSpend: stasUtxos.map((x) => `${x.TxId}:${x.Vout}`),
                estimatedFeeSatoshis: adjustedEstimatedFee + 1,
                transactionsCount,
            });
            const transactions = [];
            return this._createBundle(transactions, stasUtxos, amountSatoshis, fudingUtxo, to, note);
        });
        this.buildFeeProbeOutPoint = () => {
            const probeTxId = (0, bytes_1.toHex)((0, hashes_1.hash256)(this.feeWallet.PublicKey));
            const probeScript = new p2pkh_builder_1.P2pkhBuilder(this.feeWallet.Address).toBytes();
            return new bitcoin_1.OutPoint(probeTxId, 0, probeScript, 5000000000, this.feeWallet.Address, bitcoin_1.ScriptType.p2pkh);
        };
        this._createBundle = (transactions, stasUtxos, satoshisToSend, feeUtxo, to, note) => __awaiter(this, void 0, void 0, function* () {
            const { mergeTransactions, mergeFeeUtxo, stasUtxo } = yield this.mergeStasTransactions(stasUtxos, satoshisToSend, feeUtxo);
            if (mergeTransactions) {
                for (const mergeTx of mergeTransactions) {
                    transactions.push(mergeTx);
                }
            }
            if (stasUtxo.Satoshis === satoshisToSend) {
                transactions.push(this.buildTransferTransaction(stasUtxo, mergeFeeUtxo, to, note));
            }
            else {
                transactions.push(this.buildSplitTransaction(stasUtxo, satoshisToSend, to, mergeFeeUtxo, note));
            }
            const transferTx = transaction_1.TransactionReader.readHex(transactions[transactions.length - 1]);
            const feeUtxoIdx = note
                ? transferTx.Outputs.length - 2
                : transferTx.Outputs.length - 1;
            const paidFee = feeUtxo.Satoshis - transferTx.Outputs[feeUtxoIdx].Satoshis;
            return { transactions, feeSatoshis: paidFee };
        });
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
        this.buildFeeTransaction = (utxos, satoshis) => {
            if (utxos.length === 1)
                return {
                    feeUtxo: utxos[0],
                };
            const txBuilder = transaction_1.TransactionBuilder.init().addP2PkhOutput(0, this.feeWallet.Address);
            let accumulated = 0;
            for (const utxo of utxos) {
                txBuilder.addInput(utxo, this.feeWallet);
                const fee = txBuilder.getFee(transaction_factory_1.FeeRate);
                accumulated += utxo.Satoshis;
                if (accumulated - fee >= satoshis)
                    break;
            }
            txBuilder.Outputs = [];
            const result = txBuilder
                .addChangeOutputWithFee(this.feeWallet.Address, accumulated, transaction_factory_1.FeeRate)
                .sign()
                .toHex();
            return { feeTransaction: result, feeUtxo: bitcoin_1.OutPoint.fromHex(result, 0) };
        };
        this.mergeStasTransactions = (stasUtxos, satoshis, mergeFeeUtxo) => __awaiter(this, void 0, void 0, function* () {
            if (stasUtxos.length === 1)
                return { mergeFeeUtxo, stasUtxo: stasUtxos[0] };
            const mergeTransactions = [];
            const utxos = stasUtxos.map(({ TxId, Vout }) => ({ TxId, Vout }));
            const txIds = Array.from(new Set(stasUtxos.map(({ TxId }) => TxId)));
            const sourceTransactions = yield this.getTransactions(txIds);
            const mergeLevels = [[]];
            for (const { TxId, Vout } of utxos) {
                const tx = sourceTransactions[TxId];
                if (!tx)
                    throw new Error(`Transaction ${TxId} not found`);
                mergeLevels[0].push(bitcoin_1.OutPoint.fromTransaction(tx, Vout));
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
                        const txRaw = (0, transaction_factory_1.BuildTransferTx)({
                            tokenScheme: this.tokenScheme,
                            stasPayment,
                            feePayment,
                            to: this.stasWallet.Address,
                            feeRate: transaction_factory_1.FeeRate,
                        });
                        const tx = transaction_1.TransactionReader.readHex(txRaw);
                        newLevel.push(bitcoin_1.OutPoint.fromTransaction(tx, 0));
                        mergeTransactions.push(txRaw);
                        stasUtxo = bitcoin_1.OutPoint.fromTransaction(tx, 0);
                        feePayment.OutPoint = bitcoin_1.OutPoint.fromTransaction(tx, 1);
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
                        let destination = {
                            Address: this.stasWallet.Address,
                            Satoshis: inputSatoshis,
                        };
                        let splitDestination;
                        if (lastMerge && inputSatoshis !== satoshis) {
                            destination = {
                                Address: this.stasWallet.Address,
                                Satoshis: satoshis,
                            };
                            splitDestination = {
                                Address: this.stasWallet.Address,
                                Satoshis: inputSatoshis - satoshis,
                            };
                        }
                        const txRaw = (0, transaction_factory_1.BuildMergeTx)({
                            tokenScheme: this.tokenScheme,
                            outPoint1,
                            outPoint2,
                            owner: this.stasWallet,
                            feePayment,
                            destination,
                            splitDestination,
                            feeRate: transaction_factory_1.FeeRate,
                        });
                        const tx = transaction_1.TransactionReader.readHex(txRaw);
                        newLevel.push(bitcoin_1.OutPoint.fromTransaction(tx, 0));
                        mergeTransactions.push(txRaw);
                        stasUtxo = bitcoin_1.OutPoint.fromTransaction(tx, 0);
                        feePayment.OutPoint = bitcoin_1.OutPoint.fromTransaction(tx, tx.Outputs.length - 1);
                    }
                }
                currentLevel = newLevel;
            }
            return { mergeTransactions, mergeFeeUtxo: feePayment.OutPoint, stasUtxo };
        });
        this.buildTransferTransaction = (stasUtxo, feeUtxo, to, note) => (0, transaction_factory_1.BuildTransferTx)({
            tokenScheme: this.tokenScheme,
            stasPayment: { OutPoint: stasUtxo, Owner: this.stasWallet },
            feePayment: { OutPoint: feeUtxo, Owner: this.feeWallet },
            to,
            note,
            feeRate: transaction_factory_1.FeeRate,
        });
        this.buildSplitTransaction = (stasUtxo, satoshis, to, feeUtxo, note) => (0, transaction_factory_1.BuildSplitTx)({
            tokenScheme: this.tokenScheme,
            stasPayment: { OutPoint: stasUtxo, Owner: this.stasWallet },
            feePayment: { OutPoint: feeUtxo, Owner: this.feeWallet },
            destinations: [
                { Satoshis: satoshis, Address: to },
                {
                    Satoshis: stasUtxo.Satoshis - satoshis,
                    Address: this.stasWallet.Address,
                },
            ],
            note,
            feeRate: transaction_factory_1.FeeRate,
        });
    }
}
exports.StasBundleFactory = StasBundleFactory;
//# sourceMappingURL=stas-bundle-factory.js.map