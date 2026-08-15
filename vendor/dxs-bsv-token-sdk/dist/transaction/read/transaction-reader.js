"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionReader = void 0;
const binary_1 = require("../../binary");
const buffer_utils_1 = require("../../buffer/buffer-utils");
const bytes_1 = require("../../bytes");
const transaction_1 = require("../../bitcoin/transaction");
const transaction_input_1 = require("../../bitcoin/transaction-input");
const transaction_output_1 = require("../../bitcoin/transaction-output");
const strict_mode_1 = require("../../security/strict-mode");
class TransactionReader {
}
exports.TransactionReader = TransactionReader;
TransactionReader.readHex = (raw) => TransactionReader.readBytes((0, bytes_1.fromHex)(raw));
TransactionReader.readBytes = (buffer) => {
    const reader = new binary_1.ByteReader(buffer);
    const version = reader.readUInt32();
    const inputCount = reader.readVarInt();
    const inputs = [];
    for (let i = 0; i < inputCount; i++) {
        inputs.push(TransactionReader.readInput(reader));
    }
    const outputCount = reader.readVarInt();
    const outputs = [];
    for (let i = 0; i < outputCount; i++) {
        outputs.push(TransactionReader.readOutput(reader));
    }
    const lockTime = reader.readUInt32();
    if ((0, strict_mode_1.getStrictModeConfig)().strictTxParse &&
        reader.offset !== buffer.length) {
        throw new Error(`Unexpected trailing bytes after locktime: ${buffer.length - reader.offset}`);
    }
    return new transaction_1.Transaction(buffer, inputs, outputs, version, lockTime);
};
TransactionReader.readInput = (reader) => {
    const txId = (0, buffer_utils_1.reverseBytes)(reader.readChunk(32));
    const vout = reader.readUInt32();
    const unlockingScript = reader.readVarChunk();
    const sequence = reader.readUInt32();
    return new transaction_input_1.TransactionInput((0, bytes_1.toHex)(txId), vout, unlockingScript, sequence);
};
TransactionReader.readOutput = (reader) => {
    const satoshis = reader.readUInt64();
    const lockignScript = reader.readVarChunk();
    return new transaction_output_1.TransactionOutput(satoshis, lockignScript);
};
//# sourceMappingURL=transaction-reader.js.map