/**
 * electron-builder custom Windows signing hook.
 *
 * Why this exists: signing an .exe changes its bytes. The release workflow used
 * to run signtool *after* `electron-builder --win` had already finished, which
 * meant latest.yml carried the sha512 of the UNSIGNED installer while the .exe
 * uploaded alongside it was the SIGNED one. electron-updater hashes what it
 * downloads and compares against latest.yml, so every Windows update aborted
 * with "sha512 checksum mismatch". macOS was unaffected because its signing and
 * notarization happen inside electron-builder.
 *
 * Running signtool from here keeps signing inside the build: electron-builder
 * calls this hook (packager.signIf) before it computes update metadata, so the
 * hash written to latest.yml is the hash of the signed artifact.
 *
 * Expects the DigiCert KeyLocker certificate to already be synced into the
 * Windows certificate store (`smctl windows certsync`) and the certificate
 * thumbprint in WIN_SIGN_SHA1.
 *
 * .cjs because package.json declares "type": "module" and electron-builder
 * loads this hook with require().
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TIMESTAMP_URL = process.env.WIN_SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com';

function findSigntool() {
  if (process.env.WIN_SIGNTOOL_PATH) {
    return process.env.WIN_SIGNTOOL_PATH;
  }

  const kitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (!fs.existsSync(kitsRoot)) {
    throw new Error(`signtool.exe not found: ${kitsRoot} does not exist`);
  }

  // Prefer the highest SDK version available.
  const candidates = fs
    .readdirSync(kitsRoot)
    .sort()
    .reverse()
    .map((dir) => path.join(kitsRoot, dir, 'x64', 'signtool.exe'))
    .filter((candidate) => fs.existsSync(candidate));

  if (candidates.length === 0) {
    throw new Error(`signtool.exe not found under ${kitsRoot}`);
  }
  return candidates[0];
}

exports.default = async function sign(configuration) {
  const file = configuration.path;
  const sha1 = process.env.WIN_SIGN_SHA1;

  if (!sha1) {
    // Local/unsigned builds are allowed; CI must never ship unsigned artifacts.
    if (process.env.CI) {
      throw new Error(
        'WIN_SIGN_SHA1 is not set. Refusing to produce unsigned Windows artifacts in CI, ' +
          'because latest.yml would then describe an installer that no longer matches what is published.'
      );
    }
    console.warn(`[win-sign] WIN_SIGN_SHA1 not set — skipping signing of ${path.basename(file)}`);
    return;
  }

  const signtool = findSigntool();

  console.log(`[win-sign] Signing: ${file}`);
  execFileSync(
    signtool,
    ['sign', '/tr', TIMESTAMP_URL, '/td', 'SHA256', '/fd', 'SHA256', '/sha1', sha1, file],
    { stdio: 'inherit' }
  );

  console.log(`[win-sign] Verifying: ${file}`);
  execFileSync(signtool, ['verify', '/pa', file], { stdio: 'inherit' });
};
