"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDstasRequestedScriptHash = exports.buildDstasLockingScriptForOwnerField = void 0;
const script_type_1 = require("../bitcoin/script-type");
const bytes_1 = require("../bytes");
const hashes_1 = require("../hashes");
const dstas_locking_builder_1 = require("./build/dstas-locking-builder");
const script_builder_1 = require("./build/script-builder");
const dstas_swap_script_1 = require("./dstas-swap-script");
const buildDstasLockingScriptForOwnerField = ({ ownerField, tokenIdHex, freezable, confiscatable = false, authorityServiceField, confiscationAuthorityServiceField, frozen = false, }) => {
    const flags = { freezable, confiscatable };
    const tokens = (0, dstas_locking_builder_1.buildDstasLockingTokens)({
        owner: ownerField,
        actionData: null,
        redemptionPkh: (0, bytes_1.fromHex)(tokenIdHex),
        frozen,
        flags: (0, dstas_locking_builder_1.buildDstasFlags)(flags),
        serviceFields: [
            ...(freezable ? [authorityServiceField] : []),
            ...(confiscatable
                ? [confiscationAuthorityServiceField !== null && confiscationAuthorityServiceField !== void 0 ? confiscationAuthorityServiceField : authorityServiceField]
                : []),
        ],
        optionalData: [],
    });
    return script_builder_1.ScriptBuilder.fromTokens(tokens, script_type_1.ScriptType.dstas);
};
exports.buildDstasLockingScriptForOwnerField = buildDstasLockingScriptForOwnerField;
const computeDstasRequestedScriptHash = (lockingScript) => (0, hashes_1.sha256)((0, dstas_swap_script_1.extractDstasCounterpartyScript)(lockingScript));
exports.computeDstasRequestedScriptHash = computeDstasRequestedScriptHash;
//# sourceMappingURL=dstas-requested-script-hash.js.map