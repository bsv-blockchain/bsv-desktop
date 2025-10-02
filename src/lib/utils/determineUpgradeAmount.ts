/**
 * Given a previous authorised amount (satoshis) work out the next tier
 * ($5 → $10 → $20 → $50).  Return either satoshis or USD.
 */
export const determineUpgradeAmount = (
  previousAmountInSats: number,
  usdPerBsv: number,
  returnType: 'sats' | 'usd' = 'sats',
): number => {
  const previousUsd = previousAmountInSats * (usdPerBsv / 1e8);

  const nextUsd =
    previousUsd < 5 ? 5 :
      previousUsd < 10 ? 10 :
        previousUsd < 20 ? 20 : 50;

  return returnType === 'usd'
    ? nextUsd
    : Math.round((nextUsd * 1e8) / usdPerBsv);
};
