'use strict';

const { execSync } = require('child_process');

exports.default = async function (configuration) {
  const fingerprint = process.env.SM_FINGERPRINT;
  if (!fingerprint) {
    console.warn('SM_FINGERPRINT not set, skipping code signing');
    return;
  }

  console.log(`Signing: ${configuration.path}`);
  execSync(
    `signtool.exe sign /sha1 "${fingerprint}" /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 /debug "${configuration.path}"`,
    { stdio: 'inherit' }
  );
};
