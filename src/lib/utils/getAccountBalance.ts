import { useCallback, useContext, useEffect, useState } from "react";
import { WalletContext } from "../WalletContext";
import { loadAccountBalance } from "./loadAccountBalance";

export function getAccountBalance(basket: string = "default") {
  const { managers, adminOriginator } = useContext(WalletContext);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!managers?.permissionsManager) {
      setBalance(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      setBalance(await loadAccountBalance(managers.permissionsManager, adminOriginator, basket));
    } catch {
      // keep last known balance if an error occurs
    } finally {
      setLoading(false);
    }
  }, [managers, adminOriginator, basket]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balance, loading, refresh };
}
