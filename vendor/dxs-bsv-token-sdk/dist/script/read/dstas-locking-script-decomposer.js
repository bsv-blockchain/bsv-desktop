"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decomposeDstasLockingScript = void 0;
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const bytes_1 = require("../../bytes");
const script_builder_1 = require("../build/script-builder");
const dstas_locking_template_base_1 = require("../templates/dstas-locking-template-base");
const DSTAS_TEMPLATE_BASE_SCRIPT = script_builder_1.ScriptBuilder.fromTokens((0, dstas_locking_template_base_1.buildDstasTemplateBaseTokens)(), script_type_1.ScriptType.unknown).toBytes();
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
const decomposeDstasLockingScript = (script) => {
    const result = {
        baseMatched: false,
        serviceFieldHexes: [],
        optionalDataHexes: [],
        trailingOpcodes: [],
        errors: [],
    };
    const owner = readRawChunk(script, 0);
    if (!owner || !owner.data || owner.data.length === 0) {
        result.errors.push("owner field pushdata was not found at script start");
        return result;
    }
    result.ownerHex = (0, bytes_1.toHex)(owner.data);
    if (owner.data.length === 20) {
        result.ownerPkhHex = result.ownerHex;
    }
    const second = readRawChunk(script, owner.end);
    if (!second) {
        result.errors.push("action data was not found");
        return result;
    }
    result.actionData = second.data
        ? { kind: "data", hex: (0, bytes_1.toHex)(second.data) }
        : { kind: "opcode", opcode: second.opcode };
    const baseStart = second.end;
    const baseEnd = baseStart + DSTAS_TEMPLATE_BASE_SCRIPT.length;
    if (baseEnd > script.length) {
        result.errors.push("script is shorter than DSTAS template base");
        return result;
    }
    result.baseMatched = (0, bytes_1.equal)(script.subarray(baseStart, baseEnd), DSTAS_TEMPLATE_BASE_SCRIPT);
    if (!result.baseMatched) {
        result.errors.push("script middle does not match DSTAS template base");
        return result;
    }
    const redemption = readRawChunk(script, baseEnd);
    if (!redemption || !redemption.data || redemption.data.length !== 20) {
        result.errors.push("redemption PKH pushdata(20) was not found");
        return result;
    }
    result.redemptionPkhHex = (0, bytes_1.toHex)(redemption.data);
    let cursor = redemption.end;
    const flags = readRawChunk(script, cursor);
    if (!flags)
        return result;
    if (flags.data) {
        result.flagsHex = (0, bytes_1.toHex)(flags.data);
        const rightmostByte = flags.data.length > 0 ? flags.data[flags.data.length - 1] : 0;
        result.freezeEnabled = (rightmostByte & 0x01) === 0x01;
        result.confiscationEnabled = (rightmostByte & 0x02) === 0x02;
    }
    else if (flags.opcode === op_codes_1.OpCode.OP_0) {
        result.flagsHex = "";
        result.freezeEnabled = false;
        result.confiscationEnabled = false;
    }
    else {
        result.errors.push("flags field is not pushdata/OP_0");
        result.trailingOpcodes.push(flags.opcode);
    }
    cursor = flags.end;
    const expectedServiceFieldsCount = (result.freezeEnabled ? 1 : 0) + (result.confiscationEnabled ? 1 : 0);
    while (cursor < script.length) {
        const chunk = readRawChunk(script, cursor);
        if (!chunk) {
            result.errors.push("failed to parse tail chunk");
            break;
        }
        if (chunk.data) {
            if (result.serviceFieldHexes.length < expectedServiceFieldsCount) {
                result.serviceFieldHexes.push((0, bytes_1.toHex)(chunk.data));
            }
            else {
                result.optionalDataHexes.push((0, bytes_1.toHex)(chunk.data));
            }
        }
        else {
            result.trailingOpcodes.push(chunk.opcode);
        }
        cursor = chunk.end;
    }
    return result;
};
exports.decomposeDstasLockingScript = decomposeDstasLockingScript;
//# sourceMappingURL=dstas-locking-script-decomposer.js.map