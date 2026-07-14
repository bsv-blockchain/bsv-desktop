"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toHex = exports.fromHex = exports.bytesToUtf8 = exports.utf8ToBytes = exports.equal = exports.concat = void 0;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const concat = (chunks) => {
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
};
exports.concat = concat;
const equal = (a, b) => {
    if (a.length !== b.length)
        return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
    }
    return result === 0;
};
exports.equal = equal;
const utf8ToBytes = (value) => encoder.encode(value);
exports.utf8ToBytes = utf8ToBytes;
const bytesToUtf8 = (value) => decoder.decode(value);
exports.bytesToUtf8 = bytesToUtf8;
const fromHex = (value) => {
    if (!/^[0-9a-fA-F]*$/.test(value)) {
        throw new Error("Invalid hex string");
    }
    const normalized = value.length % 2 === 0 ? value : `0${value}`;
    const length = normalized.length / 2;
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        const hi = Number.parseInt(normalized[i * 2], 16);
        const lo = Number.parseInt(normalized[i * 2 + 1], 16);
        const byte = (hi << 4) | lo;
        out[i] = byte;
    }
    return out;
};
exports.fromHex = fromHex;
const toHex = (value) => {
    let result = "";
    for (const byte of value) {
        result += byte.toString(16).padStart(2, "0");
    }
    return result;
};
exports.toHex = toHex;
//# sourceMappingURL=bytes.js.map