"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDstasTemplateBaseTokens = exports.DSTAS_LOCKING_TEMPLATE_BASE = void 0;
const bytes_1 = require("../../bytes");
const op_codes_1 = require("../../bitcoin/op-codes");
const script_token_1 = require("../script-token");
const dstas_locking_template_1 = require("./dstas-locking-template");
const REDEMPTION_PLACEHOLDER = '<"redemption address"/"protocol ID" - 20 bytes> <flags field> <service data per each flag> <optional data field/s - upto around 4.2GB size>';
const parseBaseAsmTokens = (templateAsm) => {
    const normalized = templateAsm.replace(/\s+/g, " ").trim();
    const headMarker = "<action data>";
    const headIdx = normalized.indexOf(headMarker);
    if (headIdx < 0) {
        throw new Error("DSTAS template is missing '<action data>' marker");
    }
    const bodyStart = headIdx + headMarker.length;
    const tailMarker = `OP_RETURN ${REDEMPTION_PLACEHOLDER}`;
    const tailIdx = normalized.indexOf(tailMarker, bodyStart);
    if (tailIdx < 0) {
        throw new Error("DSTAS template is missing redemption placeholder tail");
    }
    const body = `${normalized.slice(bodyStart, tailIdx).trim()} OP_RETURN`;
    const chunks = body.split(" ").filter(Boolean);
    const opCodes = op_codes_1.OpCode;
    return chunks.map((chunk) => {
        if (chunk.startsWith("OP_")) {
            const normalizedOp = chunk === "OP_FALSE" ? "OP_0" : chunk;
            const op = opCodes[normalizedOp];
            if (typeof op !== "number") {
                throw new Error(`Unsupported opcode in DSTAS template: ${chunk}`);
            }
            return { op };
        }
        if (!/^[0-9a-fA-F]+$/.test(chunk)) {
            throw new Error(`Unsupported token in DSTAS template: ${chunk}`);
        }
        return { data: chunk.toLowerCase() };
    });
};
exports.DSTAS_LOCKING_TEMPLATE_BASE = parseBaseAsmTokens(dstas_locking_template_1.DSTAS_LOCKING_TEMPLATE_ASM);
const buildDstasTemplateBaseTokens = () => exports.DSTAS_LOCKING_TEMPLATE_BASE.map((t) => {
    if (t.data)
        return script_token_1.ScriptToken.fromBytes((0, bytes_1.fromHex)(t.data));
    return new script_token_1.ScriptToken(t.op, t.op);
});
exports.buildDstasTemplateBaseTokens = buildDstasTemplateBaseTokens;
//# sourceMappingURL=dstas-locking-template-base.js.map