"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureHashType = void 0;
var SignatureHashType;
(function (SignatureHashType) {
    SignatureHashType[SignatureHashType["SIGHASH_ALL"] = 1] = "SIGHASH_ALL";
    SignatureHashType[SignatureHashType["SIGHASH_NONE"] = 2] = "SIGHASH_NONE";
    SignatureHashType[SignatureHashType["SIGHASH_SINGLE"] = 3] = "SIGHASH_SINGLE";
    SignatureHashType[SignatureHashType["SIGHASH_FORKID"] = 64] = "SIGHASH_FORKID";
    SignatureHashType[SignatureHashType["SIGHASH_ANYONECANPAY"] = 128] = "SIGHASH_ANYONECANPAY";
})(SignatureHashType || (exports.SignatureHashType = SignatureHashType = {}));
//# sourceMappingURL=sig-hash-type.js.map