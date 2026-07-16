"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSplittable = exports.getData = exports.getSymbol = exports.getTokenId = void 0;
const script_type_1 = require("../../bitcoin/script-type");
const getTokenId = (reader) => reader.getTokenId();
exports.getTokenId = getTokenId;
const getSymbol = (reader) => reader.getSymbol();
exports.getSymbol = getSymbol;
const getData = (reader) => reader.getData();
exports.getData = getData;
const isSplittable = (reader) => {
    if (reader.ScriptType !== script_type_1.ScriptType.p2stas)
        return true;
    if (!reader.Data || reader.Data.length < 2)
        return true;
    const marker = reader.Data[1];
    if (!marker || marker.length !== 1)
        return true;
    return marker[0] === 0x0;
};
exports.isSplittable = isSplittable;
//# sourceMappingURL=script-reader-extensions.js.map