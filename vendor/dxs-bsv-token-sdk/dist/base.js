"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bs58check = void 0;
const sha2_js_1 = require("@noble/hashes/sha2.js");
const base_1 = require("@scure/base");
exports.bs58check = (0, base_1.createBase58check)(sha2_js_1.sha256);
//# sourceMappingURL=base.js.map