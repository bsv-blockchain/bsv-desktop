"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChunkSize = exports.estimateChunkSize = exports.getNumberBytes = exports.getMinimumRequiredByte = exports.getNumberSize = exports.getVarIntLength = exports.splitBytes = exports.cloneBytes = exports.reverseBytes = exports.slice = exports.ensureUInt = exports.asMinimalOP = exports.OP_INT_BASE = void 0;
const op_codes_1 = require("../bitcoin/op-codes");
exports.OP_INT_BASE = op_codes_1.OpCode.OP_RESERVED;
const asMinimalOP = (buffer) => {
    if (buffer.length === 0)
        return op_codes_1.OpCode.OP_0;
    if (buffer.length !== 1)
        return;
    if (buffer[0] >= 1 && buffer[0] <= 16)
        return exports.OP_INT_BASE + buffer[0];
    if (buffer[0] === 0x81)
        return op_codes_1.OpCode.OP_1NEGATE;
};
exports.asMinimalOP = asMinimalOP;
const ensureUInt = (value, max) => {
    if (value < 0)
        throw new Error("specified a negative value for writing an unsigned value");
    if (value > max)
        throw new Error("RangeError: value out of range");
    if (Math.floor(value) !== value)
        throw new Error(`value has a fractional component: ${value}`);
};
exports.ensureUInt = ensureUInt;
const slice = (buffer, offset, length) => buffer.slice(offset, length);
exports.slice = slice;
const reverseBytes = (buffer) => {
    let j = buffer.length - 1;
    let tmp = 0;
    for (let i = 0; i < buffer.length / 2; i++) {
        tmp = buffer[i];
        buffer[i] = buffer[j];
        buffer[j] = tmp;
        j--;
    }
    return buffer;
};
exports.reverseBytes = reverseBytes;
const cloneBytes = (source, targetStart = 0, sourceStart, sourceEnd) => {
    sourceStart = sourceStart !== null && sourceStart !== void 0 ? sourceStart : 0;
    sourceEnd = sourceEnd !== null && sourceEnd !== void 0 ? sourceEnd : source.length;
    const clone = new Uint8Array(sourceEnd - sourceStart);
    clone.set(source.subarray(sourceStart, sourceEnd), targetStart);
    return clone;
};
exports.cloneBytes = cloneBytes;
const indexOfSubarray = (source, needle, fromIndex = 0) => {
    if (needle.length === 0)
        return fromIndex;
    for (let i = fromIndex; i <= source.length - needle.length; i++) {
        let match = true;
        for (let j = 0; j < needle.length; j++) {
            if (source[i + j] !== needle[j]) {
                match = false;
                break;
            }
        }
        if (match)
            return i;
    }
    return -1;
};
const splitBytes = (source, splitBy) => {
    let search = -1;
    const move = 0;
    const segments = [];
    while ((search = indexOfSubarray(source, splitBy)) > -1) {
        const segment = (0, exports.slice)(source, 0, search + move);
        if (segment.length > 0)
            segments.push(segment);
        source = (0, exports.slice)(source, search + splitBy.length, source.length);
    }
    if (source.length > 0)
        segments.push(source);
    return segments;
};
exports.splitBytes = splitBytes;
const getVarIntLength = (value) => value < 0xfd ? 1 : value <= 0xffff ? 3 : value <= 0xffffffff ? 5 : 9;
exports.getVarIntLength = getVarIntLength;
const getNumberSize = (data) => data > 0 && data <= 16
    ? 1
    : (0, exports.getVarIntLength)((0, exports.getMinimumRequiredByte)(data)) +
        (0, exports.getMinimumRequiredByte)(data);
exports.getNumberSize = getNumberSize;
const asSafeInteger = (value) => {
    if (!Number.isInteger(value)) {
        throw new Error(`value has a fractional component: ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
        throw new Error(`value exceeds Number.MAX_SAFE_INTEGER bounds: ${value}`);
    }
    return value;
};
const getMinimumRequiredByte = (value) => {
    const safeValue = asSafeInteger(value);
    const big = BigInt(safeValue);
    for (let bytes = 1; bytes <= 8; bytes++) {
        const bits = BigInt(bytes * 8 - 1);
        const min = -(BigInt(1) << bits);
        const max = (BigInt(1) << bits) - BigInt(1);
        if (big >= min && big <= max) {
            return bytes;
        }
    }
    return 8;
};
exports.getMinimumRequiredByte = getMinimumRequiredByte;
const getNumberBytes = (value) => {
    const safeValue = asSafeInteger(value);
    const size = (0, exports.getMinimumRequiredByte)(safeValue);
    const buffer = new Uint8Array(size);
    const sizeBits = BigInt(size * 8);
    let big = BigInt(safeValue);
    if (safeValue < 0) {
        big = (BigInt(1) << sizeBits) + big;
    }
    for (let i = 0; i < size; i++) {
        buffer[i] = Number(big & BigInt(0xff));
        big >>= BigInt(8);
    }
    return buffer;
};
exports.getNumberBytes = getNumberBytes;
const estimateChunkSize = (bufferSize) => (0, exports.getVarIntLength)(bufferSize) + bufferSize;
exports.estimateChunkSize = estimateChunkSize;
const getChunkSize = (buffer) => (0, exports.estimateChunkSize)(buffer.length);
exports.getChunkSize = getChunkSize;
//# sourceMappingURL=buffer-utils.js.map