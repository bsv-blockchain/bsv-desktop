"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyBitcoinSignedMessage = exports.PrivateKey = exports.verify = void 0;
const secp256k1_1 = require("@noble/secp256k1");
const hmac_js_1 = require("@noble/hashes/hmac.js");
const sha2_js_1 = require("@noble/hashes/sha2.js");
const buffer_utils_1 = require("../buffer/buffer-utils");
const address_1 = require("./address");
const binary_1 = require("../binary");
const hashes_1 = require("../hashes");
const bytes_1 = require("../bytes");
var secp256k1_2 = require("@noble/secp256k1");
Object.defineProperty(exports, "verify", { enumerable: true, get: function () { return secp256k1_2.verify; } });
secp256k1_1.hashes.hmacSha256 = (key, msg) => (0, hmac_js_1.hmac)(sha2_js_1.sha256, key, msg);
secp256k1_1.hashes.sha256 = (msg) => (0, sha2_js_1.sha256)(msg);
const bigintToBytes = (value) => {
    let hex = value.toString(16);
    if (hex.length % 2)
        hex = `0${hex}`;
    let bytes = (0, bytes_1.fromHex)(hex);
    if (bytes.length > 0 && (bytes[0] & 0x80) !== 0) {
        bytes = (0, bytes_1.concat)([new Uint8Array([0x00]), bytes]);
    }
    return bytes;
};
const bytesToBigInt = (bytes) => {
    if (bytes.length === 0)
        return BigInt(0);
    return BigInt(`0x${(0, bytes_1.toHex)(bytes)}`);
};
const derEncodeSignature = (signature) => {
    const r = bigintToBytes(signature.r);
    const s = bigintToBytes(signature.s);
    const totalLen = 2 + r.length + 2 + s.length;
    return (0, bytes_1.concat)([
        new Uint8Array([0x30, totalLen, 0x02, r.length]),
        r,
        new Uint8Array([0x02, s.length]),
        s,
    ]);
};
const derDecodeSignature = (der) => {
    if (der.length < 8 || der[0] !== 0x30) {
        throw new Error("Invalid DER signature");
    }
    const totalLen = der[1];
    if (totalLen + 2 !== der.length) {
        throw new Error("Invalid DER signature length");
    }
    let offset = 2;
    if (der[offset++] !== 0x02)
        throw new Error("Invalid DER signature");
    const rLen = der[offset++];
    const r = der.subarray(offset, offset + rLen);
    offset += rLen;
    if (der[offset++] !== 0x02)
        throw new Error("Invalid DER signature");
    const sLen = der[offset++];
    const s = der.subarray(offset, offset + sLen);
    return new secp256k1_1.Signature(bytesToBigInt(r), bytesToBigInt(s));
};
class PrivateKey {
    constructor(pk) {
        this._disposed = false;
        this.assertAlive = () => {
            if (this._disposed) {
                throw new Error("PrivateKey has been disposed");
            }
        };
        this.sign = (message) => {
            this.assertAlive();
            return derEncodeSignature(secp256k1_1.Signature.fromBytes((0, secp256k1_1.sign)(message, this._pk, {
                prehash: false,
                lowS: true,
                extraEntropy: false,
            })));
        };
        this.verify = (signature, message) => {
            const sig = signature.length > 0 && signature[0] === 0x30
                ? derDecodeSignature(signature).toBytes()
                : signature;
            return (0, secp256k1_1.verify)(sig, message, this.PublicKey, {
                prehash: false,
                format: "compact",
            });
        };
        this.dispose = () => {
            this._pk.fill(0);
            this._disposed = true;
        };
        this._pk = new Uint8Array(pk);
        this.PublicKey = (0, secp256k1_1.getPublicKey)(this._pk, true);
        this.Address = address_1.Address.fromPublicKey(this.PublicKey);
    }
}
exports.PrivateKey = PrivateKey;
const verifyBitcoinSignedMessage = (message, publicKey, signature) => {
    const prefix = (0, bytes_1.utf8ToBytes)("Bitcoin Signed Message:\n");
    const writer = binary_1.ByteWriter.fromSize((0, buffer_utils_1.getChunkSize)(prefix) + (0, buffer_utils_1.getChunkSize)(message));
    writer.writeVarChunk(prefix);
    writer.writeVarChunk(message);
    return (0, secp256k1_1.verify)(signature, (0, hashes_1.hash256)(writer.buffer), publicKey, {
        prehash: false,
        format: "compact",
    });
};
exports.verifyBitcoinSignedMessage = verifyBitcoinSignedMessage;
//# sourceMappingURL=private-key.js.map