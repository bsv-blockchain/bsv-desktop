import { OutPoint } from "./out-point";
import { PrivateKey } from "./private-key";
import { Wallet } from "./wallet";
export type TPayment = {
    OutPoint: OutPoint;
    Owner: PrivateKey | Wallet;
};
//# sourceMappingURL=payment.d.ts.map