"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSwapActionData = exports.decodeActionData = exports.encodeActionData = void 0;
const ensureLength = (value, expected, name) => {
    if (value.length !== expected) {
        throw new Error(`${name} must be ${expected} bytes, got ${value.length}`);
    }
};
const ensureU32 = (value, name) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new Error(`${name} must be uint32, got ${value}`);
    }
};
const writeU32Le = (value, out, offset) => {
    out[offset] = value & 0xff;
    out[offset + 1] = (value >>> 8) & 0xff;
    out[offset + 2] = (value >>> 16) & 0xff;
    out[offset + 3] = (value >>> 24) & 0xff;
};
const readU32Le = (bytes, offset) => (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>>
    0;
const SWAP_LEG_SIZE = 1 + 32 + 20 + 8;
const encodeSwapCore = (spec) => {
    const legs = [];
    const seen = new Set();
    let current = spec;
    while (current) {
        if (seen.has(current)) {
            throw new Error("swap action data has cyclic next reference");
        }
        seen.add(current);
        ensureLength(current.requestedScriptHash, 32, "requestedScriptHash");
        ensureLength(current.requestedPkh, 20, "requestedPkh");
        ensureU32(current.rateNumerator, "rateNumerator");
        ensureU32(current.rateDenominator, "rateDenominator");
        if (current.rateDenominator === 0 && current.rateNumerator !== 0) {
            throw new Error("rateDenominator must be > 0 when rateNumerator is non-zero");
        }
        legs.push(current);
        current = current.next;
    }
    const out = new Uint8Array(legs.length * SWAP_LEG_SIZE);
    let offset = 0;
    for (const leg of legs) {
        out[offset++] = 1;
        out.set(leg.requestedScriptHash, offset);
        offset += 32;
        out.set(leg.requestedPkh, offset);
        offset += 20;
        writeU32Le(leg.rateNumerator, out, offset);
        offset += 4;
        writeU32Le(leg.rateDenominator, out, offset);
        offset += 4;
    }
    return out;
};
const decodeSwapCore = (bytes, offset) => {
    let nextOffset = offset;
    let first;
    let tail;
    while (nextOffset < bytes.length) {
        if (nextOffset + SWAP_LEG_SIZE > bytes.length) {
            throw new Error("swap action data is truncated");
        }
        if (bytes[nextOffset] !== 1) {
            throw new Error("swap action data must start with action=0x01");
        }
        const parsed = {
            kind: "swap",
            requestedScriptHash: bytes.subarray(nextOffset + 1, nextOffset + 33),
            requestedPkh: bytes.subarray(nextOffset + 33, nextOffset + 53),
            rateNumerator: readU32Le(bytes, nextOffset + 53),
            rateDenominator: readU32Le(bytes, nextOffset + 57),
        };
        if (!first) {
            first = parsed;
            tail = parsed;
        }
        else {
            tail.next = parsed;
            tail = parsed;
        }
        nextOffset += SWAP_LEG_SIZE;
    }
    if (!first) {
        throw new Error("swap action data is truncated");
    }
    return { parsed: first, nextOffset };
};
const encodeActionData = (value) => {
    var _a;
    if (value.kind === "swap")
        return encodeSwapCore(value);
    const payload = (_a = value.payload) !== null && _a !== void 0 ? _a : new Uint8Array(0);
    const out = new Uint8Array(1 + payload.length);
    out[0] = value.action;
    out.set(payload, 1);
    return out;
};
exports.encodeActionData = encodeActionData;
const decodeActionData = (bytes) => {
    if (bytes.length === 0)
        return { kind: "empty" };
    const action = bytes[0];
    if (action === 1) {
        const decoded = decodeSwapCore(bytes, 0);
        if (decoded.nextOffset !== bytes.length) {
            throw new Error("swap action data has trailing bytes");
        }
        return decoded.parsed;
    }
    if (action === 2 ||
        action === 3) {
        return {
            kind: "action",
            action,
            payload: bytes.subarray(1),
        };
    }
    return {
        kind: "unknown",
        action,
        payload: bytes.subarray(1),
    };
};
exports.decodeActionData = decodeActionData;
const buildSwapActionData = (value) => (0, exports.encodeActionData)(Object.assign({ kind: "swap" }, value));
exports.buildSwapActionData = buildSwapActionData;
//# sourceMappingURL=dstas-action-data.js.map