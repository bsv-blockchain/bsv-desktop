"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decomposeDstasUnlockingScript = void 0;
const op_codes_1 = require("../../bitcoin/op-codes");
const bytes_1 = require("../../bytes");
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
const parseScriptNum = (value) => {
    if (value.length === 0)
        return 0;
    if (value.length > 4)
        return undefined;
    let result = 0;
    for (let i = 0; i < value.length; i++) {
        result |= value[i] << (8 * i);
    }
    const last = value[value.length - 1];
    const negative = (last & 0x80) !== 0;
    if (negative) {
        result &= ~(0x80 << (8 * (value.length - 1)));
        result = -result;
    }
    return result;
};
const parseNumberChunk = (chunk) => {
    if (chunk.data)
        return parseScriptNum(chunk.data);
    if (chunk.opcode === op_codes_1.OpCode.OP_0)
        return 0;
    if (chunk.opcode === op_codes_1.OpCode.OP_1NEGATE)
        return -1;
    if (chunk.opcode >= op_codes_1.OpCode.OP_1 && chunk.opcode <= op_codes_1.OpCode.OP_16) {
        return chunk.opcode - op_codes_1.OpCode.OP_1 + 1;
    }
    return undefined;
};
const tryParseSwapSection = (chunks) => {
    if (chunks.length < 3)
        return undefined;
    const scriptChunk = chunks[chunks.length - 1];
    if (!scriptChunk.data || scriptChunk.data.length === 0)
        return undefined;
    const piecesCountChunk = chunks[chunks.length - 2];
    const piecesCount = parseNumberChunk(piecesCountChunk);
    if (piecesCount === undefined || piecesCount < 0)
        return undefined;
    const piecesStart = chunks.length - 2 - piecesCount;
    if (piecesStart < 0)
        return undefined;
    const pieces = chunks.slice(piecesStart, chunks.length - 2);
    if (pieces.length !== piecesCount)
        return undefined;
    if (pieces.some((piece) => !piece.data))
        return undefined;
    return {
        start: piecesStart,
        counterpartyPiecesCount: piecesCount,
        counterpartyPiecesHexes: pieces.map((piece) => (0, bytes_1.toHex)(piece.data)),
        counterpartyScriptHex: (0, bytes_1.toHex)(scriptChunk.data),
    };
};
const decomposeDstasUnlockingScript = (script) => {
    var _a, _b, _c;
    const result = {
        parsed: false,
        errors: [],
        noteHexes: [],
        hasExplicitEmptyNote: false,
        authPlaceholderOpcodes: [],
        mergeMode: "unknown",
        counterpartyPiecesHexes: [],
    };
    const chunks = [];
    let cursor = 0;
    while (cursor < script.length) {
        const chunk = readRawChunk(script, cursor);
        if (!chunk) {
            result.errors.push("failed to decode chunk");
            return result;
        }
        chunks.push(chunk);
        cursor = chunk.end;
    }
    if (chunks.length < 9) {
        result.errors.push("too few chunks for DSTAS unlocking layout");
        return result;
    }
    const pubChunk = chunks[chunks.length - 1];
    const sigChunk = chunks[chunks.length - 2];
    const spendingTypeChunk = chunks[chunks.length - 3];
    const preimageChunk = chunks[chunks.length - 4];
    if (!pubChunk.data || pubChunk.data.length !== 33) {
        result.errors.push("public key chunk not found at script end");
    }
    else {
        result.publicKeyHex = (0, bytes_1.toHex)(pubChunk.data);
    }
    if (!sigChunk.data || sigChunk.data.length < 9) {
        result.errors.push("signature chunk not found");
    }
    else {
        result.signatureHex = (0, bytes_1.toHex)(sigChunk.data);
    }
    if (!preimageChunk.data || preimageChunk.data.length < 120) {
        result.errors.push("preimage chunk not found");
    }
    else {
        result.preimageHex = (0, bytes_1.toHex)(preimageChunk.data);
    }
    const spendingType = parseNumberChunk(spendingTypeChunk);
    if (spendingType === undefined) {
        result.errors.push("spending type chunk is not a script number");
    }
    else {
        result.spendingType = spendingType;
    }
    const prefix = chunks.slice(0, chunks.length - 4);
    const swapSection = tryParseSwapSection(prefix);
    if (swapSection) {
        if (result.spendingType !== undefined && result.spendingType !== 1) {
            result.errors.push("swap section requires spending type 1");
        }
        result.counterpartyPiecesCount = swapSection.counterpartyPiecesCount;
        result.counterpartyPiecesHexes = swapSection.counterpartyPiecesHexes;
        result.counterpartyScriptHex = swapSection.counterpartyScriptHex;
    }
    const working = swapSection ? prefix.slice(0, swapSection.start) : prefix;
    if (working.length < 3) {
        result.errors.push("missing funding fields");
        return result;
    }
    const fundingVoutChunk = working[working.length - 3];
    const fundingTxIdChunk = working[working.length - 2];
    const mergeMarkerChunk = working[working.length - 1];
    if (!fundingTxIdChunk.data || fundingTxIdChunk.data.length !== 32) {
        result.errors.push("funding txid(LE) chunk not found");
    }
    else {
        result.fundingTxIdLeHex = (0, bytes_1.toHex)(fundingTxIdChunk.data);
    }
    const fundingVout = parseNumberChunk(fundingVoutChunk);
    if (fundingVout === undefined) {
        result.errors.push("funding vout chunk is not a script number");
    }
    else {
        result.fundingVout = fundingVout;
    }
    result.mergeMode =
        mergeMarkerChunk.opcode === op_codes_1.OpCode.OP_0 && !mergeMarkerChunk.data
            ? "none"
            : "present";
    const head = working.slice(0, working.length - 3);
    if (head.length < 3) {
        result.errors.push("missing first token-output chunks");
        return result;
    }
    const satChunk = head[0];
    const pkhChunk = head[1];
    const sat = parseNumberChunk(satChunk);
    if (sat === undefined) {
        result.errors.push("first output satoshis is not a script number");
    }
    else {
        result.firstOutputSatoshis = sat;
    }
    if (!pkhChunk.data || pkhChunk.data.length !== 20) {
        result.errors.push("first output receiver pkh(20) not found");
    }
    else {
        result.firstOutputReceiverPkhHex = (0, bytes_1.toHex)(pkhChunk.data);
    }
    let noteStartIdx = 3;
    const tailHead = head.slice(3);
    const auth1 = tailHead[0];
    const auth2 = tailHead[1];
    const auth3 = tailHead[2];
    result.authPlaceholderOpcodes = [
        (_a = auth1 === null || auth1 === void 0 ? void 0 : auth1.opcode) !== null && _a !== void 0 ? _a : -1,
        (_b = auth2 === null || auth2 === void 0 ? void 0 : auth2.opcode) !== null && _b !== void 0 ? _b : -1,
        (_c = auth3 === null || auth3 === void 0 ? void 0 : auth3.opcode) !== null && _c !== void 0 ? _c : -1,
    ];
    const hasChangePair = !!auth1 &&
        !!auth2 &&
        parseNumberChunk(auth1) !== undefined &&
        !!auth2.data &&
        auth2.data.length === 20;
    const hasNoChangePlaceholders = !!auth1 &&
        !!auth2 &&
        auth1.opcode === op_codes_1.OpCode.OP_0 &&
        !auth1.data &&
        auth2.opcode === op_codes_1.OpCode.OP_0 &&
        !auth2.data;
    if (hasChangePair || hasNoChangePlaceholders) {
        noteStartIdx = 5;
    }
    else if (tailHead.length > 0) {
        result.errors.push("unexpected post-output layout before funding fields");
    }
    for (let i = noteStartIdx; i < head.length; i++) {
        const chunk = head[i];
        if (chunk.opcode === op_codes_1.OpCode.OP_0 && !chunk.data) {
            result.hasExplicitEmptyNote = true;
        }
        else if (chunk.data) {
            result.noteHexes.push((0, bytes_1.toHex)(chunk.data));
        }
        else {
            result.errors.push(`unexpected opcode in note area: ${chunk.opcode}`);
        }
    }
    result.parsed = result.errors.length === 0;
    return result;
};
exports.decomposeDstasUnlockingScript = decomposeDstasUnlockingScript;
//# sourceMappingURL=dstas-unlocking-script-decomposer.js.map