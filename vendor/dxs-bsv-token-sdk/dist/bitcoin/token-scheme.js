"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenScheme = void 0;
class TokenScheme {
    constructor(name, tokenId, symbol, satoshisPerToken, options = {}) {
        this.toJson = () => JSON.stringify({
            name: this.Name,
            tokenId: this.TokenId,
            symbol: this.Symbol,
            satoshisPerToken: this.SatoshisPerToken,
            freeze: this.Freeze,
            confiscation: this.Confiscation,
            isDivisible: this.IsDivisible,
            freezeAuthority: this.FreezeAuthority,
            confiscationAuthority: this.ConfiscationAuthority,
        });
        this.toBytes = () => new TextEncoder().encode(this.toJson());
        this.Name = name;
        this.TokenId = tokenId;
        this.Symbol = symbol;
        this.SatoshisPerToken = satoshisPerToken;
        this.Freeze = options.freeze === true;
        this.Confiscation = options.confiscation === true;
        this.IsDivisible = options.isDivisible === true;
        this.FreezeAuthority = options.freezeAuthority;
        this.ConfiscationAuthority = options.confiscationAuthority;
    }
}
exports.TokenScheme = TokenScheme;
//# sourceMappingURL=token-scheme.js.map