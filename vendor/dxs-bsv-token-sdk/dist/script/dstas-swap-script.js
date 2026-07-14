"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitDstasPreviousTransactionByCounterpartyScript = exports.extractDstasCounterpartyScript = void 0;
const script_builder_1 = require("./build/script-builder");
const op_codes_1 = require("../bitcoin/op-codes");
const readRawChunk = (script, offset) => {
    if (offset >= script.length)
        return undefined;
    const opcode = script[offset];
    if (opcode > op_codes_1.OpCode.OP_0 && opcode < op_codes_1.OpCode.OP_PUSHDATA1) {
        const size = opcode;
        const start = offset + 1;
        const end = start + size;
        if (end > script.length)
            return undefined;
        return { opcode, start: offset, end, data: script.subarray(start, end) };
    }
    if (opcode === op_codes_1.OpCode.OP_PUSHDATA1) {
        if (offset + 2 > script.length)
            return undefined;
        const size = script[offset + 1];
        const start = offset + 2;
        const end = start + size;
        if (end > script.length)
            return undefined;
        return { opcode, start: offset, end, data: script.subarray(start, end) };
    }
    if (opcode === op_codes_1.OpCode.OP_PUSHDATA2) {
        if (offset + 3 > script.length)
            return undefined;
        const size = script[offset + 1] | (script[offset + 2] << 8);
        const start = offset + 3;
        const end = start + size;
        if (end > script.length)
            return undefined;
        return { opcode, start: offset, end, data: script.subarray(start, end) };
    }
    if (opcode === op_codes_1.OpCode.OP_PUSHDATA4) {
        if (offset + 5 > script.length)
            return undefined;
        const size = (script[offset + 1] |
            (script[offset + 2] << 8) |
            (script[offset + 3] << 16) |
            (script[offset + 4] << 24)) >>>
            0;
        const start = offset + 5;
        const end = start + size;
        if (end > script.length)
            return undefined;
        return { opcode, start: offset, end, data: script.subarray(start, end) };
    }
    return { opcode, start: offset, end: offset + 1 };
};
const asBytes = (value) => value instanceof script_builder_1.ScriptBuilder ? value.toBytes() : value;
const extractDstasCounterpartyScript = (lockingScript) => {
    const scriptBytes = asBytes(lockingScript);
    const owner = readRawChunk(scriptBytes, 0);
    if (!owner || !owner.data || owner.data.length === 0) {
        throw new Error("DSTAS locking script must start with owner field");
    }
    const second = readRawChunk(scriptBytes, owner.end);
    if (!second) {
        throw new Error("DSTAS locking script must include action data");
    }
    return scriptBytes.subarray(second.end);
};
exports.extractDstasCounterpartyScript = extractDstasCounterpartyScript;
const findNextOccurrence = (source, needle, from) => {
    if (needle.length === 0) {
        throw new Error("counterpartyScript must not be empty");
    }
    for (let i = from; i <= source.length - needle.length; i++) {
        let matched = true;
        for (let j = 0; j < needle.length; j++) {
            if (source[i + j] !== needle[j]) {
                matched = false;
                break;
            }
        }
        if (matched)
            return i;
    }
    return -1;
};
const splitDstasPreviousTransactionByCounterpartyScript = (previousTransaction, counterpartyScript) => {
    const pieces = [];
    if (counterpartyScript.length === 0) {
        throw new Error("counterpartyScript must not be empty");
    }
    let cursor = 0;
    while (cursor <= previousTransaction.length) {
        const match = findNextOccurrence(previousTransaction, counterpartyScript, cursor);
        if (match < 0) {
            pieces.push(previousTransaction.subarray(cursor));
            break;
        }
        pieces.push(previousTransaction.subarray(cursor, match));
        cursor = match + counterpartyScript.length;
    }
    return pieces;
};
exports.splitDstasPreviousTransactionByCounterpartyScript = splitDstasPreviousTransactionByCounterpartyScript;
//# sourceMappingURL=dstas-swap-script.js.map