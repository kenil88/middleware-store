const crypto = require('crypto');

let _privateKey = null;
let _publicKeyPem = null;

function init() {
  if (_privateKey && _publicKeyPem) return;

  const envPriv = process.env.ENCRYPTION_PRIVATE_KEY;
  const envPub  = process.env.ENCRYPTION_PUBLIC_KEY;

  if (envPriv && envPub) {
    // Stored keys — unescape literal \n back to real newlines
    _privateKey  = envPriv.replace(/\\n/g, '\n');
    _publicKeyPem = envPub.replace(/\\n/g, '\n');
    return;
  }

  // Generate ephemeral pair (survives warm serverless instances; cold-starts
  // regenerate — browser always fetches /api/pubkey fresh, so this is fine)
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',   format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8',  format: 'pem' },
  });

  _privateKey   = privateKey;
  _publicKeyPem = publicKey;

  // Print once so the operator can persist across cold-starts
  const oneLinePub  = publicKey.replace(/\n/g, '\\n');
  const oneLinePriv = privateKey.replace(/\n/g, '\\n');
  console.log('[crypto] Ephemeral RSA key pair generated.');
  console.log('[crypto] To persist across cold-starts, add to .env:');
  console.log(`ENCRYPTION_PUBLIC_KEY="${oneLinePub}"`);
  console.log(`ENCRYPTION_PRIVATE_KEY="${oneLinePriv}"`);
}

function getPublicKeyPem() {
  init();
  return _publicKeyPem;
}

function decryptToken(encryptedBase64) {
  init();
  const buf = Buffer.from(encryptedBase64, 'base64');
  return crypto.privateDecrypt(
    { key: _privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    buf
  ).toString('utf8');
}

module.exports = { getPublicKeyPem, decryptToken };
