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
    `smctl sign --fingerprint "${fingerprint}" --input "${configuration.path}" --verbose`,
    { stdio: 'inherit' }
  );
};
