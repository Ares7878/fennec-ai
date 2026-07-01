const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
let apiSecret = pem;
let rawSecret = apiSecret
  .replace(/-----BEGIN EC PRIVATE KEY-----/gi, '')
  .replace(/-----END EC PRIVATE KEY-----/gi, '')
  .replace(/\\n/g, '')
  .replace(/\s/g, '')
  .replace(/"/g, '');
const formattedBody = rawSecret.match(/.{1,64}/g)?.join('\n') || rawSecret;
const finalSecret = '-----BEGIN EC PRIVATE KEY-----\n' + formattedBody + '\n-----END EC PRIVATE KEY-----\n';
try {
  crypto.createPrivateKey(finalSecret);
  console.log('SUCCESS!');
} catch (e) {
  console.log('FAILED:', e.message);
}
