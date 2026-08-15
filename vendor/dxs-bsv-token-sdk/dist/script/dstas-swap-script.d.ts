import { ScriptBuilder } from "./build/script-builder";
import { Bytes } from "../bytes";
export declare const extractDstasCounterpartyScript: (lockingScript: Bytes | ScriptBuilder) => Bytes;
export declare const splitDstasPreviousTransactionByCounterpartyScript: (previousTransaction: Bytes, counterpartyScript: Bytes) => Bytes[];
//# sourceMappingURL=dstas-swap-script.d.ts.map