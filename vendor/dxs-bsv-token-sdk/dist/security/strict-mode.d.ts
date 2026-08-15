export type StrictScriptEvaluationLimits = {
    maxScriptSizeBytes: number;
    maxOps: number;
    maxStackDepth: number;
    maxElementSizeBytes: number;
};
export type StrictModeConfig = {
    strictTxParse: boolean;
    strictOutPointValidation: boolean;
    strictFeeRateValidation: boolean;
    maxFeeRateSatsPerByte: number;
    strictPresetUnlockingScript: boolean;
    strictMultisigKeys: boolean;
    strictScriptReader: boolean;
    strictScriptEvaluation: boolean;
    scriptEvaluationLimits: StrictScriptEvaluationLimits;
};
export declare const getStrictModeConfig: () => StrictModeConfig;
export declare const configureStrictMode: (patch: Partial<StrictModeConfig>) => StrictModeConfig;
export declare const resetStrictMode: () => StrictModeConfig;
//# sourceMappingURL=strict-mode.d.ts.map