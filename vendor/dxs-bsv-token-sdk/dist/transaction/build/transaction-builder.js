"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionBuilder = exports.TransactionBuilderError = void 0;
const buffer_utils_1 = require("../../buffer/buffer-utils");
const binary_1 = require("../../binary");
const op_codes_1 = require("../../bitcoin/op-codes");
const sig_hash_type_1 = require("../../bitcoin/sig-hash-type");
const null_data_builder_1 = require("../../script/build/null-data-builder");
const p2mpkh_builder_1 = require("../../script/build/p2mpkh-builder");
const p2pkh_builder_1 = require("../../script/build/p2pkh-builder");
const p2stas_builder_1 = require("../../script/build/p2stas-builder");
const script_reader_1 = require("../../script/read/script-reader");
const input_builder_1 = require("./input-builder");
const output_builder_1 = require("./output-builder");
const bytes_1 = require("../../bytes");
const strict_mode_1 = require("../../security/strict-mode");
class TransactionBuilderError extends Error {
    constructor(message, devMessage) {
        super(message);
        this.devMessage = devMessage;
    }
}
exports.TransactionBuilderError = TransactionBuilderError;
class TransactionBuilder {
    constructor() {
        this.Inputs = [];
        this.Outputs = [];
        this.Version = 1;
        this.LockTime = 0;
        this.validateFeeRate = (satoshisPerByte) => {
            const strict = (0, strict_mode_1.getStrictModeConfig)();
            if (!strict.strictFeeRateValidation)
                return;
            if (!Number.isFinite(satoshisPerByte) || satoshisPerByte <= 0) {
                throw new TransactionBuilderError("Invalid fee rate", `feeRate must be a positive finite number, got: ${satoshisPerByte}`);
            }
            if (satoshisPerByte > strict.maxFeeRateSatsPerByte) {
                throw new TransactionBuilderError("Fee rate too high", `feeRate ${satoshisPerByte} exceeds strict max ${strict.maxFeeRateSatsPerByte}`);
            }
        };
        this.size = () => 4 +
            4 +
            (0, buffer_utils_1.getVarIntLength)(this.Inputs.length) +
            this.Inputs.reduce((a, x) => a + x.size(), 0) +
            (0, buffer_utils_1.getVarIntLength)(this.Outputs.length) +
            this.Outputs.reduce((a, x) => a + x.size(), 0);
        this.getFee = (satoshisPerByte) => {
            this.validateFeeRate(satoshisPerByte);
            return Math.ceil(this.size() * satoshisPerByte);
        };
        this.addInput = (outPoint, signer, sequence = TransactionBuilder.DefaultSequence) => {
            const input = new input_builder_1.InputBilder(this, outPoint, signer, false);
            input.Sequence = sequence;
            this.Inputs.push(input);
            return this;
        };
        this.addStasMergeInput = (outPoint, signer, sequence = TransactionBuilder.DefaultSequence) => {
            const input = new input_builder_1.InputBilder(this, outPoint, signer, true);
            input.Sequence = sequence;
            this.Inputs.push(input);
            return this;
        };
        this.addP2PkhOutput = (value, to, data = []) => {
            const script = new p2pkh_builder_1.P2pkhBuilder(to);
            for (const d of data) {
                script.addReturnData(d);
            }
            this.Outputs.push(new output_builder_1.OutputBuilder(script, value));
            return this;
        };
        this.addP2MpkhOutput = (value, to) => {
            const script = new p2mpkh_builder_1.P2mpkhBuilder(to);
            this.Outputs.push(new output_builder_1.OutputBuilder(script, value));
            return this;
        };
        this.addStasOutputByScheme = (schema, satoshis, to, data = []) => {
            const script = new p2stas_builder_1.P2stasBuilder(to, schema.TokenId, schema.Symbol);
            for (const d of data) {
                script.addData(d);
            }
            this.Outputs.push(new output_builder_1.OutputBuilder(script, satoshis));
            return this;
        };
        this.addStasOutputByPrevLockingScript = (satoshis, to, prevStasLockingScript) => {
            const prevScriptTokens = script_reader_1.ScriptReader.read(prevStasLockingScript);
            const opReturnIdx = prevScriptTokens.findIndex((x) => x.OpCodeNum === op_codes_1.OpCode.OP_RETURN);
            if (opReturnIdx < 0) {
                throw new TransactionBuilderError("Invalid STAS locking script", "OP_RETURN marker was not found in previous STAS locking script");
            }
            const tokenIdToken = prevScriptTokens[opReturnIdx + 1];
            const symbolToken = prevScriptTokens[opReturnIdx + 2];
            if (!(tokenIdToken === null || tokenIdToken === void 0 ? void 0 : tokenIdToken.Data) || !(symbolToken === null || symbolToken === void 0 ? void 0 : symbolToken.Data)) {
                throw new TransactionBuilderError("Invalid STAS locking script", "TokenId and symbol pushdatas must follow OP_RETURN in previous STAS locking script");
            }
            const toknenId = (0, bytes_1.toHex)(tokenIdToken.Data);
            const symbol = (0, bytes_1.bytesToUtf8)(symbolToken.Data);
            const data = [];
            for (let i = opReturnIdx + 3; i < prevScriptTokens.length; i++) {
                const token = prevScriptTokens[i];
                if (!token.Data) {
                    throw new TransactionBuilderError("Invalid STAS locking script", `Unexpected opcode after OP_RETURN payload at token index ${i}`);
                }
                data.push(token.Data);
            }
            const script = new p2stas_builder_1.P2stasBuilder(to, toknenId, symbol, data);
            this.Outputs.push(new output_builder_1.OutputBuilder(script, satoshis));
            return this;
        };
        this.sign = (force = false) => {
            for (const input of this.Inputs) {
                input.sign(force);
            }
            return this;
        };
        this.toBytes = () => {
            const size = this.size();
            const buffer = new Uint8Array(size);
            const bufferWriter = new binary_1.ByteWriter(buffer);
            bufferWriter.writeUInt32(this.Version);
            bufferWriter.writeVarInt(this.Inputs.length);
            for (const input of this.Inputs)
                input.writeTo(bufferWriter);
            bufferWriter.writeVarInt(this.Outputs.length);
            for (const output of this.Outputs)
                output.writeTo(bufferWriter);
            bufferWriter.writeUInt32(this.LockTime);
            return buffer;
        };
        this.toHex = () => (0, bytes_1.toHex)(this.toBytes());
    }
    addNullDataOutput(data) {
        const script = new null_data_builder_1.NullDataBuilder(data);
        this.Outputs.push(new output_builder_1.OutputBuilder(script, 0));
        return this;
    }
    addChangeOutputWithFee(to, change, satoshisPerByte, idx = null) {
        const script = new p2pkh_builder_1.P2pkhBuilder(to);
        const output = new output_builder_1.OutputBuilder(script, change);
        if (idx !== null)
            this.Outputs.splice(idx, 0, output);
        else
            this.Outputs.push(output);
        const fee = this.getFee(satoshisPerByte);
        if (fee >= change)
            throw new TransactionBuilderError(`Insufficient satoshis to pay fee`, `Insufficient satoshis to pay fee. Change: ${change}; Fee: ${fee}`);
        output.Satoshis = change - fee;
        return this;
    }
}
exports.TransactionBuilder = TransactionBuilder;
TransactionBuilder.DefaultSequence = 0xffffffff;
TransactionBuilder.DefaultSighashType = sig_hash_type_1.SignatureHashType.SIGHASH_ALL | sig_hash_type_1.SignatureHashType.SIGHASH_FORKID;
TransactionBuilder.init = () => new TransactionBuilder();
//# sourceMappingURL=transaction-builder.js.map