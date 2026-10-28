import { useContext, useEffect, useState, useMemo } from 'react';
import { RegistryClient, type SecurityLevel } from '@bsv/sdk';
import { WalletContext } from '../WalletContext';

/** Optional metadata never participates in authorization or delays the prompt. */
export default function useRegistryProtocolDescription(protocol: string, level: number) {
  const { managers, settings, activeProfile, adminOriginator } = useContext(WalletContext);
  const registryFromWallet = useMemo(() => managers.permissionsManager ? new RegistryClient(managers.permissionsManager, undefined, adminOriginator) : null, [managers.permissionsManager, adminOriginator]);
  const [result, setResult] = useState<{ key: string; description: string; publisher: string } | null>(null);
  const trusted = settings?.trustSettings?.trustedCertifiers ?? [];
  const sourceKey = JSON.stringify(trusted.map(x => [x.identityKey, x.trust]));
  const key = `${level}:${protocol}:${sourceKey}:${activeProfile}`;
  useEffect(() => {
    let done = false;
    const timer = setTimeout(() => { done = true; }, 800);
    setResult(null);
    if (registryFromWallet && protocol && trusted.length) {
      void registryFromWallet.resolve('protocol', { protocolID: [level as SecurityLevel, protocol], registryOperators: trusted.map(x => x.identityKey) }).then(records => {
        if (done) return;
        const ranked = records.filter(x => trusted.some(t => t.identityKey === x.registryOperator)).sort((a, b) => {
          const trust = (key: string) => trusted.find(t => t.identityKey === key)?.trust ?? 0;
          return trust(b.registryOperator) - trust(a.registryOperator) || a.registryOperator.localeCompare(b.registryOperator);
        });
        const record = ranked[0];
        if (record && typeof record.description === 'string') setResult({ key, description: record.description.slice(0, 4096), publisher: record.registryOperator });
      }).catch(() => {});
    }
    return () => { done = true; clearTimeout(timer); };
  }, [registryFromWallet, key]);
  return result?.key === key ? result : null;
}
