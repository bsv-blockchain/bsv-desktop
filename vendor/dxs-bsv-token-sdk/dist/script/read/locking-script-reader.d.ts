import { Address } from "../../bitcoin/address";
import { ScriptType } from "../../bitcoin/script-type";
import { Bytes } from "../../bytes";
import { BaseScriptReader } from "./base-script-reader";
import { ScriptReadToken } from "./script-read-token";
import { ParsedActionData } from "../dstas-action-data";
export declare class LockingScriptReader extends BaseScriptReader {
    private samples;
    private dstasBaseTokens;
    private dstasCtx;
    Address?: Address;
    Data?: Bytes[];
    Dstas?: {
        Owner: Bytes;
        ActionDataRaw?: Bytes;
        ActionDataOpCode?: number;
        ActionDataParsed?: ParsedActionData;
        Redemption: Bytes;
        Flags: Bytes;
        FreezeEnabled: boolean;
        ConfiscationEnabled: boolean;
        ServiceFields: Bytes[];
        OptionalData: Bytes[];
    };
    get ScriptType(): ScriptType;
    private constructor();
    private read;
    protected handleToken(token: ScriptReadToken, tokenIdx: number): boolean;
    private sameToken;
    private addData;
    private handleDstasToken;
    private finalizeDstas;
    private isPushData;
    getTokenId(): string | null;
    getSymbol(): string | null;
    getData(): Bytes;
    static readHex(hex: string): LockingScriptReader;
    static read(bytes: Bytes, expectedLength?: number): LockingScriptReader;
    private ScriptTypeOverride?;
}
//# sourceMappingURL=locking-script-reader.d.ts.map