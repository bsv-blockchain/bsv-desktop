import { Bytes } from "../../bytes";
import { ScriptReadToken } from "./script-read-token";
export declare abstract class BaseScriptReader {
    protected Source: Bytes;
    protected ExpectedLength: number;
    protected ReadBytes: number;
    constructor(source: Bytes, expectedLength?: number);
    protected abstract handleToken(token: ScriptReadToken, tokenIdx: number, isLastToken: boolean): boolean;
    protected readInternal(): number;
    private handleTokenInternal;
    private handleBytes;
    private handleRest;
    private readUInt8;
    private readUInt16Le;
    private readUInt32Le;
    private readNBytes;
    private varIntLength;
}
//# sourceMappingURL=base-script-reader.d.ts.map