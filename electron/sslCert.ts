import { app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import forge from 'node-forge';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CertificateKeyPair {
  cert: string;
  key: string;
  certPath: string;
}

/**
 * Generates or loads a self-signed certificate for HTTPS server
 * Certificate is cached in user data directory for reuse
 */
export async function generateSelfSignedCert(): Promise<CertificateKeyPair> {
  const userDataPath = app.getPath('userData');
  const certDir = path.join(userDataPath, 'certs');
  const certPath = path.join(certDir, 'server.crt');
  const keyPath = path.join(certDir, 'server.key');

  // Check if certificate already exists and is valid
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath, 'utf8');
      const key = fs.readFileSync(keyPath, 'utf8');

      // Parse and validate certificate expiration
      const forgeCert = forge.pki.certificateFromPem(cert);
      const now = new Date();

      if (forgeCert.validity.notAfter > now) {
        console.log('Using existing SSL certificate');
        return { cert, key, certPath };
      } else {
        console.log('Existing certificate expired, generating new one');
      }
    } catch (error) {
      console.log('Failed to load existing certificate, generating new one:', error);
    }
  }

  // Generate new certificate
  console.log('Generating new self-signed SSL certificate...');

  // Create directory if it doesn't exist
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  // Generate key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';

  // Valid for 1 year
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  // Set certificate attributes
  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'countryName', value: 'US' },
    { shortName: 'ST', value: 'California' },
    { name: 'localityName', value: 'San Francisco' },
    { name: 'organizationName', value: 'BSV Desktop' },
    { shortName: 'OU', value: 'Development' }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Add extensions
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true
    },
    {
      name: 'subjectAltName',
      altNames: [
        {
          type: 2, // DNS
          value: 'localhost'
        },
        {
          type: 7, // IP
          ip: '127.0.0.1'
        }
      ]
    }
  ]);

  // Self-sign certificate
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Convert to PEM format
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  // Save to disk
  fs.writeFileSync(certPath, certPem);
  fs.writeFileSync(keyPath, keyPem);

  console.log('SSL certificate generated and saved');

  return {
    cert: certPem,
    key: keyPem,
    certPath
  };
}

/**
 * Checks if the certificate is trusted by the system
 */
async function isCertTrusted(certPath: string): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      // macOS: Check if cert is in user keychain
      await execAsync(`security find-certificate -c "BSV Desktop" -p ~/Library/Keychains/login.keychain-db`);
      return true;
    } else if (process.platform === 'win32') {
      // Windows: Check if cert is in trusted root store
      const { stdout } = await execAsync(`certutil -user -verifystore Root "BSV Desktop"`);
      return stdout.includes('BSV Desktop');
    } else {
      // Linux: Various cert stores, hard to check reliably
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Attempts to install the certificate to the system trust store
 * Returns true if successful or user dismissed, false if failed
 */
async function installCertificate(certPath: string): Promise<boolean> {
  const platform = process.platform;

  let instructions = '';
  let canAutoInstall = false;

  if (platform === 'darwin') {
    canAutoInstall = true;
    instructions = `To trust the certificate, you'll be prompted to enter your password to add it to the system keychain.

Certificate location: ${certPath}`;
  } else if (platform === 'win32') {
    canAutoInstall = true;
    instructions = `To trust the certificate, you'll be prompted to add it to the Trusted Root Certification Authorities store.

Certificate location: ${certPath}`;
  } else {
    // Linux
    instructions = `To trust the certificate, please run the following commands:

sudo cp "${certPath}" /usr/local/share/ca-certificates/bsv-desktop.crt
sudo update-ca-certificates

Certificate location: ${certPath}`;
  }

  const response = await dialog.showMessageBox({
    type: 'info',
    title: 'SSL Certificate Trust',
    message: 'BSV Desktop uses HTTPS for secure communication',
    detail: instructions,
    buttons: canAutoInstall ? ['Trust Certificate', 'Not Now'] : ['OK'],
    defaultId: 0,
    cancelId: 1
  });

  // User clicked "Not Now" or dismissed
  if (response.response !== 0) {
    return true;
  }

  if (!canAutoInstall) {
    return true; // Just showed instructions
  }

  try {
    if (platform === 'darwin') {
      // macOS: Add to user keychain first (no password needed)
      await execAsync(`security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain-db "${certPath}"`);

      // await dialog.showMessageBox({
      //   type: 'info',
      //   title: 'Certificate Installed',
      //   message: 'The SSL certificate has been successfully installed and trusted in your user keychain.',
      //   buttons: ['OK']
      // });

      return true;
    } else if (platform === 'win32') {
      // Windows: Import to Trusted Root store
      await execAsync(`certutil -addstore -user Root "${certPath}"`);

      // await dialog.showMessageBox({
      //   type: 'info',
      //   title: 'Certificate Installed',
      //   message: 'The SSL certificate has been successfully installed and trusted.',
      //   buttons: ['OK']
      // });

      return true;
    }
  } catch (error) {
    console.error('Failed to install certificate:', error);

    await dialog.showMessageBox({
      type: 'error',
      title: 'Certificate Installation Failed',
      message: 'Failed to install the certificate automatically.',
      detail: `Please manually trust the certificate at:\n${certPath}\n\nError: ${error}`,
      buttons: ['OK']
    });

    return false;
  }

  return true;
}

/**
 * Prompts user to trust the certificate if not already trusted
 */
export async function ensureCertTrusted(certPath: string): Promise<void> {
  const userDataPath = app.getPath('userData');
  const promptedFlagPath = path.join(userDataPath, 'certs', '.ssl-prompted');

  // Check if we've already prompted the user
  const alreadyPrompted = fs.existsSync(promptedFlagPath);

  const trusted = await isCertTrusted(certPath);

  if (!trusted && !alreadyPrompted) {
    console.log('Certificate not trusted, prompting user...');
    await installCertificate(certPath);

    // Mark that we've prompted the user, regardless of their choice
    fs.writeFileSync(promptedFlagPath, new Date().toISOString());
  } else if (trusted) {
    console.log('Certificate already trusted');
  } else {
    console.log('Certificate not trusted, but user already prompted');
  }
}
