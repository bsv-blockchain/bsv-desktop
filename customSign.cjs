'use strict';

const { execSync } = require('child_process');

exports.default = async function (configuration) {
  const keypairAlias = process.env.SM_KEYPAIR_ALIAS;
  if (!keypairAlias) {
    console.warn('SM_KEYPAIR_ALIAS not set, skipping code signing');
    return;
  }

  console.log(`Signing: ${configuration.path}`);
  execSync(
    `smctl sign --simple --keypair-alias "${keypairAlias}" --input "${configuration.path}"`,
    { stdio: 'inherit' }
  );
};
