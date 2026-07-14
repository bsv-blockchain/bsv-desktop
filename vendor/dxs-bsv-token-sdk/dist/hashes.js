"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hash256 = exports.hash160 = exports.ripemd160 = exports.sha256 = void 0;
const sha2_js_1 = require("@noble/hashes/sha2.js");
const legacy_js_1 = require("@noble/hashes/legacy.js");
const sha256 = (message) => (0, sha2_js_1.sha256)(message);
exports.sha256 = sha256;
const ripemd160 = (message) => (0, legacy_js_1.ripemd160)(message);
exports.ripemd160 = ripemd160;
const hash160 = (buffer) => (0, exports.ripemd160)((0, exports.sha256)(buffer));
exports.hash160 = hash160;
const hash256 = (buffer) => (0, exports.sha256)((0, exports.sha256)(buffer));
exports.hash256 = hash256;
//# sourceMappingURL=hashes.js.map