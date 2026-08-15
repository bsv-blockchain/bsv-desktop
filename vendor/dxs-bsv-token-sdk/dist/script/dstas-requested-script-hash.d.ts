import { Bytes } from "../bytes";
import { ScriptBuilder } from "./build/script-builder";
export declare const buildDstasLockingScriptForOwnerField: ({ ownerField, tokenIdHex, freezable, confiscatable, authorityServiceField, confiscationAuthorityServiceField, frozen, }: {
    ownerField: Bytes;
    tokenIdHex: string;
    freezable: boolean;
    confiscatable?: boolean;
    authorityServiceField: Bytes;
    confiscationAuthorityServiceField?: Bytes;
    frozen?: boolean;
}) => ScriptBuilder;
export declare const computeDstasRequestedScriptHash: (lockingScript: Bytes | ScriptBuilder) => Uint8Array;
//# sourceMappingURL=dstas-requested-script-hash.d.ts.map