import { ByteWriter } from "../../binary";
import { ScriptBuilder } from "../../script/build/script-builder";
export declare class OutputBuilder {
    Satoshis: number;
    LockingScript: ScriptBuilder;
    constructor(lockingScript: ScriptBuilder, satoshis: number);
    size(): number;
    writeTo(writer: ByteWriter): void;
}
//# sourceMappingURL=output-builder.d.ts.map