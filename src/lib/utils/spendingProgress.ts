/**
 * Values for the spending-limit meter.
 *
 * `spent` is `permissionsManager.querySpentSince(token)`, which is already a
 * positive total (stored actions carry negative net satoshis and it sums
 * `a - e.satoshis`), so it is displayed as is. A negative total (more came in
 * than went out this month) is shown as nothing spent.
 */
export const spendingProgress = (
  spent: number,
  authorized: number,
): { spent: number; percent: number } => {
  const shown = Math.max(0, spent);
  if (authorized <= 0) return { spent: shown, percent: shown > 0 ? 100 : 0 };
  return { spent: shown, percent: Math.min((shown / authorized) * 100, 100) };
};
