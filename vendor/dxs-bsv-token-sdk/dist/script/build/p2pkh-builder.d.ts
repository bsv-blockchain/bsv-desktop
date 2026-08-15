import { Address } from "../../bitcoin/address";
import { ScriptBuilder } from "./script-builder";
import { Bytes } from "../../bytes";
export declare class P2pkhBuilder extends ScriptBuilder {
    private _isOpReturnAdded;
    constructor(address: Address);
    addReturnData(data: Bytes): void;
}
//# sourceMappingURL=p2pkh-builder.d.ts.map