"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDstasLockingAsm = exports.buildDstasLockingScript = exports.buildDstasLockingTokens = exports.buildDstasFlags = void 0;
const buffer_utils_1 = require("../../buffer/buffer-utils");
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const script_builder_1 = require("./script-builder");
const script_token_1 = require("../script-token");
const dstas_locking_template_base_1 = require("../templates/dstas-locking-template-base");
const dstas_action_data_1 = require("../dstas-action-data");
const identity_field_1 = require("../identity-field");
const buildDstasFlags = (flags) => {
    const result = new Uint8Array(1);
    if (flags === null || flags === void 0 ? void 0 : flags.freezable)
        result[0] |= 0x01;
    if (flags === null || flags === void 0 ? void 0 : flags.confiscatable)
        result[0] |= 0x02;
    return result;
};
exports.buildDstasFlags = buildDstasFlags;
const parseProtocolFlags = (flags) => {
    const rightmostByte = flags.length > 0 ? flags[flags.length - 1] : 0;
    return {
        freezable: (rightmostByte & 0x01) === 0x01,
        confiscatable: (rightmostByte & 0x02) === 0x02,
    };
};
const ensureLength = (value, expected, name) => {
    if (value.length !== expected) {
        throw new Error(`${name} must be ${expected} bytes, got ${value.length}`);
    }
};
const resolveOwner = (params) => {
    var _a;
    const owner = (_a = params.owner) !== null && _a !== void 0 ? _a : params.ownerPkh;
    if (!owner || owner.length === 0) {
        throw new Error("owner must be provided");
    }
    (0, identity_field_1.assertSupportedIdentityField)(owner, "owner");
    return owner;
};
const buildOwnerToken = (value) => script_token_1.ScriptToken.fromBytes(value);
const buildActionDataToken = (field, frozen) => {
    if (typeof field === "object" && field && "kind" in field) {
        return script_token_1.ScriptToken.fromBytes((0, dstas_action_data_1.encodeActionData)(field));
    }
    if (field === null) {
        return new script_token_1.ScriptToken(frozen ? op_codes_1.OpCode.OP_2 : op_codes_1.OpCode.OP_0, frozen ? op_codes_1.OpCode.OP_2 : op_codes_1.OpCode.OP_0);
    }
    if (typeof field !== "number" && field.length === 0) {
        return new script_token_1.ScriptToken(frozen ? op_codes_1.OpCode.OP_2 : op_codes_1.OpCode.OP_0, frozen ? op_codes_1.OpCode.OP_2 : op_codes_1.OpCode.OP_0);
    }
    const raw = typeof field === "number" ? (0, buffer_utils_1.getNumberBytes)(field) : new Uint8Array(field);
    if (!frozen)
        return script_token_1.ScriptToken.fromBytes(raw);
    const prefixed = new Uint8Array(raw.length + 1);
    prefixed[0] = 0x02;
    prefixed.set(raw, 1);
    return script_token_1.ScriptToken.fromBytes(prefixed);
};
const buildFlagsToken = (flags) => {
    const fallback = new Uint8Array([0x00]);
    const encoded = flags instanceof Uint8Array
        ? flags.length === 0
            ? fallback
            : flags
        : flags
            ? (0, exports.buildDstasFlags)(flags)
            : fallback;
    if (encoded.length > 75) {
        throw new Error(`flags length must be <= 75 bytes, got ${encoded.length}`);
    }
    return script_token_1.ScriptToken.fromBytes(encoded);
};
const buildDataTokens = (values) => {
    if (!values || values.length === 0)
        return [];
    return values.map((v) => script_token_1.ScriptToken.fromBytes(v));
};
const buildDstasLockingTokens = (params) => {
    var _a, _b;
    const frozen = params.frozen === true;
    ensureLength(params.redemptionPkh, 20, "redemptionPkh");
    const ownerToken = buildOwnerToken(resolveOwner(params));
    const actionDataToken = buildActionDataToken(params.actionData, frozen);
    const redemptionToken = script_token_1.ScriptToken.fromBytes(params.redemptionPkh);
    const flagsToken = buildFlagsToken(params.flags);
    const serviceTokens = buildDataTokens(params.serviceFields);
    const optionalTokens = buildDataTokens(params.optionalData);
    const parsedFlags = parseProtocolFlags((_a = flagsToken.Data) !== null && _a !== void 0 ? _a : new Uint8Array(0));
    const expectedServiceFieldsCount = (parsedFlags.freezable ? 1 : 0) + (parsedFlags.confiscatable ? 1 : 0);
    if (serviceTokens.length !== expectedServiceFieldsCount) {
        throw new Error(`serviceFields count ${serviceTokens.length} does not match flags requirements ${expectedServiceFieldsCount}`);
    }
    for (const serviceField of (_b = params.serviceFields) !== null && _b !== void 0 ? _b : []) {
        (0, identity_field_1.assertSupportedIdentityField)(serviceField, "service field");
    }
    const baseTokens = (0, dstas_locking_template_base_1.buildDstasTemplateBaseTokens)();
    const tokens = [ownerToken, actionDataToken, ...baseTokens];
    tokens.push(redemptionToken, flagsToken, ...serviceTokens, ...optionalTokens);
    return tokens;
};
exports.buildDstasLockingTokens = buildDstasLockingTokens;
const buildDstasLockingScript = (params) => {
    const tokens = (0, exports.buildDstasLockingTokens)(params);
    return script_builder_1.ScriptBuilder.fromTokens(tokens, script_type_1.ScriptType.unknown).toBytes();
};
exports.buildDstasLockingScript = buildDstasLockingScript;
const buildDstasLockingAsm = (params) => {
    const tokens = (0, exports.buildDstasLockingTokens)(params);
    return script_builder_1.ScriptBuilder.fromTokens(tokens, script_type_1.ScriptType.unknown).toAsm();
};
exports.buildDstasLockingAsm = buildDstasLockingAsm;
//# sourceMappingURL=dstas-locking-builder.js.map