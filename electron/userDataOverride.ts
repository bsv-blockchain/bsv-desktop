import path from 'path';

/**
 * Environment variable that moves Electron's `userData` directory. It exists so
 * a second copy of the app (a second wallet) can run on one machine for
 * testing: the vault, secrets, boot config, certificates and the renderer's
 * localStorage (the wallet snapshot, payment outboxes, settings) all live under
 * `userData`. Unset, nothing changes.
 */
export const USER_DATA_ENV = 'BSV_DESKTOP_USER_DATA';

/** The part of Electron's `app` this needs, so it can be tested without Electron. */
export interface UserDataTarget {
  setPath(name: 'userData', value: string): void;
}

/**
 * Points `userData` at the directory named by BSV_DESKTOP_USER_DATA, resolved
 * against the working directory (a leading `~` is not expanded here; the shell
 * does that for an unquoted `VAR=~/dir`). Returns the path it set, or
 * undefined when the variable is unset or blank.
 *
 * Must run before the app is ready and before anything reads `userData`.
 * Electron creates the directory itself, and `sessionData` (Chromium's
 * localStorage and cache) follows `userData` unless it was set separately.
 */
export function applyUserDataOverride(
  app: UserDataTarget,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const value = env[USER_DATA_ENV]?.trim();
  if (!value) return undefined;
  const userData = path.resolve(value);
  app.setPath('userData', userData);
  return userData;
}
