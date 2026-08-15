"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetStrictMode = exports.configureStrictMode = exports.getStrictModeConfig = void 0;
const defaultStrictModeConfig = {
    strictTxParse: true,
    strictOutPointValidation: true,
    strictFeeRateValidation: true,
    maxFeeRateSatsPerByte: 1000,
    strictPresetUnlockingScript: false,
    strictMultisigKeys: false,
    strictScriptReader: true,
    strictScriptEvaluation: true,
    scriptEvaluationLimits: {
        maxScriptSizeBytes: 100000,
        maxOps: 50000,
        maxStackDepth: 1000,
        maxElementSizeBytes: 1024 * 1024,
    },
};
let strictModeConfig = Object.assign(Object.assign({}, defaultStrictModeConfig), { scriptEvaluationLimits: Object.assign({}, defaultStrictModeConfig.scriptEvaluationLimits) });
const getStrictModeConfig = () => strictModeConfig;
exports.getStrictModeConfig = getStrictModeConfig;
const configureStrictMode = (patch) => {
    var _a;
    strictModeConfig = Object.assign(Object.assign(Object.assign({}, strictModeConfig), patch), { scriptEvaluationLimits: Object.assign(Object.assign({}, strictModeConfig.scriptEvaluationLimits), ((_a = patch.scriptEvaluationLimits) !== null && _a !== void 0 ? _a : {})) });
    return strictModeConfig;
};
exports.configureStrictMode = configureStrictMode;
const resetStrictMode = () => {
    strictModeConfig = Object.assign(Object.assign({}, defaultStrictModeConfig), { scriptEvaluationLimits: Object.assign({}, defaultStrictModeConfig.scriptEvaluationLimits) });
    return strictModeConfig;
};
exports.resetStrictMode = resetStrictMode;
//# sourceMappingURL=strict-mode.js.map