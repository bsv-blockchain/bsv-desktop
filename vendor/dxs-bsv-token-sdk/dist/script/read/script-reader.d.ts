import { Bytes } from "../../bytes";
import { ScriptToken } from "../script-token";
export declare class ScriptReader {
    static read: (source: Bytes) => ScriptToken[];
    static decode: (buffer: Bytes, offset: number) => {
        opcode: number;
        number: number;
        size: number;
    } | null;
}
//# sourceMappingURL=script-reader.d.ts.map