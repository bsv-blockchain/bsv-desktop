"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameBytesOrShape = exports.assertSupportedIdentityField = exports.isSupportedIdentityField = exports.isCanonicalMpkhField = void 0;
const secp256k1_1 = require("@noble/secp256k1");
const bytes_1 = require("../bytes");
const isCompressedPubKey = (key) => key.length === 33 && (key[0] === 0x02 || key[0] === 0x03);
const isCanonicalMpkhField = (value) => {
    if (value.length < 36)
        return false;
    const m = value[0];
    const n = value[value.length - 1];
    if (n <= 0 || n > 5)
        return false;
    if (m <= 0 || m > n)
        return false;
    if (value.length !== 1 + n * 34 + 1)
        return false;
    const seen = new Set();
    let offset = 1;
    for (let i = 0; i < n; i++) {
        if (value[offset] !== 0x21)
            return false;
        const key = value.subarray(offset + 1, offset + 34);
        if (!isCompressedPubKey(key))
            return false;
        try {
            secp256k1_1.Point.fromHex((0, bytes_1.toHex)(key));
        }
        catch (_a) {
            return false;
        }
        const keyHex = (0, bytes_1.toHex)(key);
        if (seen.has(keyHex))
            return false;
        seen.add(keyHex);
        offset += 34;
    }
    return offset === value.length - 1;
};
exports.isCanonicalMpkhField = isCanonicalMpkhField;
const isSupportedIdentityField = (value) => value.length === 20 || (0, exports.isCanonicalMpkhField)(value);
exports.isSupportedIdentityField = isSupportedIdentityField;
const assertSupportedIdentityField = (value, name) => {
    if (value.length === 20)
        return;
    if ((0, exports.isCanonicalMpkhField)(value))
        return;
    throw new Error(`${name} must be either 20-byte PKH or canonical MPKH preimage`);
};
exports.assertSupportedIdentityField = assertSupportedIdentityField;
const sameBytesOrShape = (expected, actual) => {
    if (expected.OpCodeNum !== actual.OpCodeNum)
        return false;
    if (expected.Data !== undefined)
        return (0, bytes_1.equal)(expected.Data, actual.Data);
    return expected.DataLength === actual.Data.length;
};
exports.sameBytesOrShape = sameBytesOrShape;
//# sourceMappingURL=identity-field.js.map