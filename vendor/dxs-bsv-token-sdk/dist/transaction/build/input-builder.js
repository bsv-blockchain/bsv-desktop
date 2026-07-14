"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputBilder = void 0;
const buffer_utils_1 = require("../../buffer/buffer-utils");
const binary_1 = require("../../binary");
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const sig_hash_type_1 = require("../../bitcoin/sig-hash-type");
const hashes_1 = require("../../hashes");
const script_builder_1 = require("../../script/build/script-builder");
const transaction_builder_1 = require("./transaction-builder");
const bytes_1 = require("../../bytes");
const strict_mode_1 = require("../../security/strict-mode");
const dstas_swap_script_1 = require("../../script/dstas-swap-script");
const dstas_action_data_1 = require("../../script/dstas-action-data");
const script_reader_1 = require("../../script/read/script-reader");
class InputBilder {
    constructor(txBuilder, outPoint, signer, merge) {
        this.AllowPresetUnlockingScript = false;
        this.DstasSpendingType = 1;
        this.Sequence = transaction_builder_1.TransactionBuilder.DefaultSequence;
        this._mergeVout = 0;
        this._mergeSegments = [];
        this._swapCounterpartyScript = null;
        this.sign = (force = false) => {
            if (!force && this.UnlockingScript !== undefined) {
                if ((0, strict_mode_1.getStrictModeConfig)().strictPresetUnlockingScript &&
                    !this.AllowPresetUnlockingScript) {
                    throw new Error("Preset unlocking script is disabled in strict mode for this input");
                }
                return;
            }
            const scriptType = this.OutPoint.ScriptType;
            const preimage = this.preimage(transaction_builder_1.TransactionBuilder.DefaultSighashType);
            const hashedPreimage = (0, hashes_1.hash256)(preimage);
            const der = this.Owner.sign(hashedPreimage);
            const derWithSigHashType = new Uint8Array(der.length + 1);
            derWithSigHashType.set(der);
            derWithSigHashType[der.length] = transaction_builder_1.TransactionBuilder.DefaultSighashType;
            if (scriptType === script_type_1.ScriptType.p2pkh || scriptType === script_type_1.ScriptType.p2mpkh) {
                const size = (0, buffer_utils_1.getChunkSize)(derWithSigHashType) + (0, buffer_utils_1.getChunkSize)(this.Owner.PublicKey);
                const buffer = new Uint8Array(size);
                const bufferWriter = new binary_1.ByteWriter(buffer);
                bufferWriter.writeVarChunk(derWithSigHashType);
                bufferWriter.writeVarChunk(this.Owner.PublicKey);
                this.UnlockingScript = buffer;
            }
            else if (scriptType === script_type_1.ScriptType.p2stas ||
                scriptType === script_type_1.ScriptType.dstas) {
                this.prepareMergeInfo();
                const script = new script_builder_1.ScriptBuilder(script_type_1.ScriptType.p2stas);
                let hasNote = false;
                let hasChangeOutput = false;
                for (let outIdx = 0; outIdx < this.TxBuilder.Outputs.length; outIdx++) {
                    const output = this.TxBuilder.Outputs[outIdx];
                    if (output.LockingScript.ScriptType === script_type_1.ScriptType.nullData) {
                        const nulldata = output.LockingScript.toBytes();
                        const payload = nulldata.subarray(2);
                        script.addData(payload);
                        hasNote = true;
                    }
                    else {
                        script
                            .addNumber(output.Satoshis)
                            .addData(this.resolveOutputOwnerField(output.LockingScript));
                        if (output.LockingScript.ScriptType === script_type_1.ScriptType.dstas) {
                            const actionDataToken = output.LockingScript._tokens[1];
                            if (actionDataToken === null || actionDataToken === void 0 ? void 0 : actionDataToken.Data) {
                                script.addData(actionDataToken.Data);
                            }
                            else if (actionDataToken) {
                                script.addOpCode(actionDataToken.OpCodeNum);
                            }
                            else {
                                throw new Error("Divisible STAS output is missing action-data token in locking script");
                            }
                        }
                        else if (this.isDstasRedeemLike() &&
                            outIdx === 0 &&
                            this.isP2PkLike(output.LockingScript.ScriptType)) {
                            script.addOpCode(op_codes_1.OpCode.OP_0);
                        }
                        if (this.isP2PkLike(output.LockingScript.ScriptType)) {
                            hasChangeOutput = true;
                        }
                    }
                }
                if (!hasChangeOutput) {
                    script.addOpCode(op_codes_1.OpCode.OP_0);
                    script.addOpCode(op_codes_1.OpCode.OP_0);
                }
                if (!hasNote)
                    script.addOpCode(op_codes_1.OpCode.OP_0);
                const fundingInput = this.resolveFundingInput();
                script
                    .addNumber(fundingInput.OutPoint.Vout)
                    .addData((0, buffer_utils_1.reverseBytes)((0, bytes_1.fromHex)(fundingInput.OutPoint.TxId)));
                if (this.Merge) {
                    script.addNumber(this._mergeVout).addDatas(this._mergeSegments);
                    if (this._swapCounterpartyScript) {
                        script
                            .addNumber(this._mergeSegments.length)
                            .addData(this._swapCounterpartyScript)
                            .addNumber(1);
                    }
                    else {
                        script.addNumber(this._mergeSegments.length);
                    }
                }
                else {
                    script.addOpCode(op_codes_1.OpCode.OP_0);
                }
                script.addData(preimage);
                if (scriptType === script_type_1.ScriptType.dstas) {
                    script.addNumber(this.DstasSpendingType);
                }
                script.addData(derWithSigHashType).addData(this.Owner.PublicKey);
                this.UnlockingScript = script.toBytes();
            }
        };
        this.size = () => 32 +
            4 +
            this.unlockingScriptSize() +
            4;
        this.preimageLength = () => 4 +
            32 +
            32 +
            32 +
            4 +
            (0, buffer_utils_1.getChunkSize)(this.OutPoint.LockingScript) +
            8 +
            4 +
            32 +
            4 +
            4;
        this.stasNullDataLength = () => {
            const nullDataOutput = this.TxBuilder.Outputs.find((x) => x.LockingScript.ScriptType === script_type_1.ScriptType.nullData);
            if (!nullDataOutput)
                return 1;
            return (0, buffer_utils_1.estimateChunkSize)(nullDataOutput.LockingScript.size() - 2);
        };
        this.resolveOutputOwnerField = (script) => {
            if (script.ToAddress)
                return script.ToAddress.Hash160;
            const ownerToken = script._tokens[0];
            if (!(ownerToken === null || ownerToken === void 0 ? void 0 : ownerToken.Data) || ownerToken.Data.length === 0) {
                throw new Error("Output locking script is missing owner field");
            }
            return ownerToken.Data;
        };
        this.isStasScriptType = (scriptType) => scriptType === script_type_1.ScriptType.p2stas || scriptType === script_type_1.ScriptType.dstas;
        this.isP2PkLike = (scriptType) => scriptType === script_type_1.ScriptType.p2pkh || scriptType === script_type_1.ScriptType.p2mpkh;
        this.hasDstasSwapActionData = (lockingScript) => {
            const tokens = script_reader_1.ScriptReader.read(lockingScript);
            const actionDataToken = tokens[1];
            if (!(actionDataToken === null || actionDataToken === void 0 ? void 0 : actionDataToken.Data) || actionDataToken.Data.length === 0) {
                return false;
            }
            try {
                return (0, dstas_action_data_1.decodeActionData)(actionDataToken.Data).kind === "swap";
            }
            catch (_a) {
                return false;
            }
        };
        this.isDstasRedeemLike = () => {
            if (this.OutPoint.ScriptType !== script_type_1.ScriptType.dstas)
                return false;
            if (this.TxBuilder.Outputs.length === 0)
                return false;
            const hasDstasOutput = this.TxBuilder.Outputs.some((x) => x.LockingScript.ScriptType === script_type_1.ScriptType.dstas);
            if (hasDstasOutput)
                return false;
            return this.isP2PkLike(this.TxBuilder.Outputs[0].LockingScript.ScriptType);
        };
        this.resolveFundingInput = () => {
            const candidates = this.TxBuilder.Inputs.filter((input, idx) => idx !== this.Idx && !this.isStasScriptType(input.OutPoint.ScriptType));
            if (candidates.length === 0) {
                throw new Error("Unable to resolve funding input: expected one non-STAS input");
            }
            if (candidates.length > 1) {
                throw new Error("Unable to resolve funding input: multiple non-STAS inputs are present");
            }
            return candidates[0];
        };
        this.prevoutHashLength = () => (32 + 4) * this.TxBuilder.Inputs.length;
        this.unlockingScriptSize = () => {
            if (this.UnlockingScript !== undefined) {
                return (0, buffer_utils_1.estimateChunkSize)(this.UnlockingScript.length);
            }
            if (this.PresetUnlockingScriptSizeHint !== undefined) {
                if (!Number.isInteger(this.PresetUnlockingScriptSizeHint)) {
                    throw new Error("Preset unlocking script size hint must be an integer");
                }
                if (this.PresetUnlockingScriptSizeHint <= 0) {
                    throw new Error("Preset unlocking script size hint must be greater than zero");
                }
                return (0, buffer_utils_1.estimateChunkSize)(this.PresetUnlockingScriptSizeHint);
            }
            const singleSigTailSize = 1 +
                73 +
                1 +
                33;
            const authorityTailSize = () => {
                if (this.AuthoritySignaturesCount === undefined ||
                    this.AuthorityPubKeysCount === undefined) {
                    return singleSigTailSize;
                }
                const sigCount = this.AuthoritySignaturesCount;
                const pubKeyCount = this.AuthorityPubKeysCount;
                if (sigCount <= 0 || pubKeyCount <= 0) {
                    throw new Error("Authority signature/public-key counts must be > 0");
                }
                const mlpkhPreimageSize = 1 +
                    pubKeyCount * (1 + 33) +
                    1;
                return (1 +
                    sigCount * (1 + 73) +
                    (0, buffer_utils_1.estimateChunkSize)(mlpkhPreimageSize));
            };
            if (this.OutPoint.ScriptType === script_type_1.ScriptType.p2pkh ||
                this.OutPoint.ScriptType === script_type_1.ScriptType.p2mpkh) {
                return (0, buffer_utils_1.estimateChunkSize)(singleSigTailSize);
            }
            let size = 0;
            if (this.OutPoint.ScriptType === script_type_1.ScriptType.p2stas ||
                this.OutPoint.ScriptType === script_type_1.ScriptType.dstas) {
                this.prepareMergeInfo();
                const fundingOutpoint = this.resolveFundingInput().OutPoint;
                size += this.stasNullDataLength();
                let hasChangeOutput = false;
                size += this.TxBuilder.Outputs.reduce((a, x, outIdx) => {
                    if (x.LockingScript.ScriptType === script_type_1.ScriptType.nullData)
                        return a;
                    const ownerField = this.resolveOutputOwnerField(x.LockingScript);
                    a += (0, buffer_utils_1.getNumberSize)(x.Satoshis) + (0, buffer_utils_1.estimateChunkSize)(ownerField.length);
                    if (x.LockingScript.ScriptType === script_type_1.ScriptType.dstas) {
                        a += (0, buffer_utils_1.estimateChunkSize)(x.LockingScript._tokens[1].DataLength);
                    }
                    else if (this.isDstasRedeemLike() &&
                        outIdx === 0 &&
                        this.isP2PkLike(x.LockingScript.ScriptType)) {
                        a += 1;
                    }
                    if (this.isP2PkLike(x.LockingScript.ScriptType)) {
                        hasChangeOutput = true;
                    }
                    return a;
                }, 0);
                if (!hasChangeOutput) {
                    size += 2;
                }
                size += (0, buffer_utils_1.getNumberSize)(fundingOutpoint.Vout);
                size += (0, buffer_utils_1.estimateChunkSize)(32);
                size += (0, buffer_utils_1.estimateChunkSize)(this.preimageLength());
                if (!this.Merge) {
                    size += 1;
                }
                else {
                    size += (0, buffer_utils_1.getNumberSize)(this._mergeVout);
                    size += (0, buffer_utils_1.getNumberSize)(this._mergeSegments.length);
                    size += this._mergeSegments.reduce((a, x) => (0, buffer_utils_1.getChunkSize)(x) + a, 0);
                    if (this._swapCounterpartyScript) {
                        size += (0, buffer_utils_1.estimateChunkSize)(this._swapCounterpartyScript.length);
                        size += (0, buffer_utils_1.getNumberSize)(1);
                    }
                }
                if (this.OutPoint.ScriptType === script_type_1.ScriptType.dstas) {
                    size += (0, buffer_utils_1.getNumberSize)(this.DstasSpendingType);
                }
                if (this.OutPoint.ScriptType === script_type_1.ScriptType.dstas) {
                    size += authorityTailSize();
                }
                else {
                    size += singleSigTailSize;
                }
            }
            if (size === 0) {
                size = singleSigTailSize;
            }
            return (0, buffer_utils_1.estimateChunkSize)(size);
        };
        this.preimage = (signatureHashType) => {
            const size = this.preimageLength();
            const buffer = new Uint8Array(size);
            const writer = new binary_1.ByteWriter(buffer);
            const baseType = signatureHashType & 0x1f;
            const anyoneCanPay = (signatureHashType & sig_hash_type_1.SignatureHashType.SIGHASH_ANYONECANPAY) !== 0;
            writer.writeUInt32(this.TxBuilder.Version);
            if (anyoneCanPay) {
                this.writeZeroHash(writer);
            }
            else {
                this.writePrevoutHash(writer);
            }
            if (anyoneCanPay ||
                baseType === sig_hash_type_1.SignatureHashType.SIGHASH_NONE ||
                baseType === sig_hash_type_1.SignatureHashType.SIGHASH_SINGLE) {
                this.writeZeroHash(writer);
            }
            else {
                this.writeSequenceHash(writer);
            }
            writer.writeChunk((0, buffer_utils_1.reverseBytes)((0, bytes_1.fromHex)(this.OutPoint.TxId)));
            writer.writeUInt32(this.OutPoint.Vout);
            writer.writeVarChunk(this.OutPoint.LockingScript);
            writer.writeUInt64(this.OutPoint.Satoshis);
            writer.writeUInt32(this.Sequence);
            if (baseType === sig_hash_type_1.SignatureHashType.SIGHASH_ALL) {
                this.writeOutputsHash(writer);
            }
            else if (baseType === sig_hash_type_1.SignatureHashType.SIGHASH_SINGLE) {
                this.writeSingleOutputHash(writer);
            }
            else {
                this.writeZeroHash(writer);
            }
            writer.writeUInt32(this.TxBuilder.LockTime);
            writer.writeUInt32(signatureHashType);
            return buffer;
        };
        this.writePrevoutHash = (writer) => {
            const size = this.prevoutHashLength();
            const buffer = new Uint8Array(size);
            const bufferWriter = new binary_1.ByteWriter(buffer);
            for (const input of this.TxBuilder.Inputs) {
                bufferWriter.writeChunk((0, buffer_utils_1.reverseBytes)((0, bytes_1.fromHex)(input.OutPoint.TxId)));
                bufferWriter.writeUInt32(input.OutPoint.Vout);
            }
            writer.writeChunk((0, hashes_1.hash256)(buffer));
        };
        this.writeSequenceHash = (writer) => {
            const buffer = new Uint8Array(4 * this.TxBuilder.Inputs.length);
            const bufferWriter = new binary_1.ByteWriter(buffer);
            for (const input of this.TxBuilder.Inputs)
                bufferWriter.writeUInt32(input.Sequence);
            writer.writeChunk((0, hashes_1.hash256)(buffer));
        };
        this.writeOutputsHash = (writer) => {
            const size = this.TxBuilder.Outputs.reduce((a, x) => a + x.size(), 0);
            const buffer = new Uint8Array(size);
            const bufferWriter = new binary_1.ByteWriter(buffer);
            for (const output of this.TxBuilder.Outputs) {
                bufferWriter.writeUInt64(output.Satoshis);
                bufferWriter.writeVarChunk(output.LockingScript.toBytes());
            }
            writer.writeChunk((0, hashes_1.hash256)(buffer));
        };
        this.writeSingleOutputHash = (writer) => {
            if (this.Idx >= this.TxBuilder.Outputs.length) {
                this.writeZeroHash(writer);
                return;
            }
            const output = this.TxBuilder.Outputs[this.Idx];
            const buffer = new Uint8Array(output.size());
            const bufferWriter = new binary_1.ByteWriter(buffer);
            output.writeTo(bufferWriter);
            writer.writeChunk((0, hashes_1.hash256)(buffer));
        };
        this.writeZeroHash = (writer) => {
            writer.writeChunk(new Uint8Array(32));
        };
        this.prepareMergeInfo = () => {
            var _a;
            if (!this.Merge || this._mergeSegments.length > 0)
                return;
            const mergeUtxo = this.TxBuilder.Inputs[this.Idx === 0 ? 1 : 0];
            const mergeRaw = (_a = mergeUtxo.OutPoint.Transaction) === null || _a === void 0 ? void 0 : _a.Raw;
            if (!mergeRaw) {
                throw new Error("Merge input requires source transaction raw bytes");
            }
            this._mergeVout = mergeUtxo.OutPoint.Vout;
            if (this.OutPoint.ScriptType === script_type_1.ScriptType.dstas) {
                const isSwap = this.hasDstasSwapActionData(this.OutPoint.LockingScript) ||
                    this.hasDstasSwapActionData(mergeUtxo.OutPoint.LockingScript);
                const scriptSource = isSwap
                    ? mergeUtxo.OutPoint.LockingScript
                    : this.TxBuilder.Inputs[0].OutPoint.LockingScript;
                const scriptToCut = (0, dstas_swap_script_1.extractDstasCounterpartyScript)(scriptSource);
                this._mergeSegments = (0, dstas_swap_script_1.splitDstasPreviousTransactionByCounterpartyScript)(mergeRaw, scriptToCut).reverse();
                if (isSwap) {
                    this._swapCounterpartyScript = scriptToCut;
                }
                return;
            }
            const lockingScript = this.TxBuilder.Inputs[0].OutPoint.LockingScript;
            const scriptToCut = (0, buffer_utils_1.cloneBytes)(lockingScript, 0, 23);
            this._mergeSegments = (0, buffer_utils_1.splitBytes)(mergeRaw, scriptToCut).reverse();
        };
        this.TxBuilder = txBuilder;
        this.Idx = txBuilder.Inputs.length;
        this.OutPoint = outPoint;
        this.Owner = signer;
        this.Merge = merge;
    }
    writeTo(writer) {
        writer.writeChunk((0, buffer_utils_1.reverseBytes)((0, bytes_1.fromHex)(this.OutPoint.TxId)));
        writer.writeUInt32(this.OutPoint.Vout);
        writer.writeVarChunk(this.UnlockingScript);
        writer.writeUInt32(this.Sequence);
    }
}
exports.InputBilder = InputBilder;
//# sourceMappingURL=input-builder.js.map