import { useCallback, useContext, useEffect, useState } from "react";
import { WalletContext } from "../WalletContext";

type Output = { satoshis: number };
type ListOutputsResult = { outputs: Output[]; totalOutputs: number };

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

      const limit = 10000;
      let offset = 0;
      let allOutputs: Output[] = [];

      const firstPage = (await managers.permissionsManager.listOutputs(
        { basket, limit, offset },
        adminOriginator
      )) as ListOutputsResult;

      allOutputs = firstPage.outputs ?? [];
      const totalOutputs = firstPage.totalOutputs ?? allOutputs.length;

      while (allOutputs.length < totalOutputs) {
        offset += limit;
        const page = (await managers.permissionsManager.listOutputs(
          { basket, limit, offset },
          adminOriginator
        )) as ListOutputsResult;

        allOutputs = allOutputs.concat(page.outputs ?? []);
      }

      const sum = allOutputs.reduce((acc, o) => acc + (o?.satoshis ?? 0), 0);
      setBalance(sum);
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
