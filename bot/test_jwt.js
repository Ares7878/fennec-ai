const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();

let apiKey = "organizations/123/apiKeys/456";
const fakeJson = JSON.stringify({
  name: apiKey,
  privateKey: pem.replace(/\n/g, '\\n')
});

let apiSecret = fakeJson;
if (apiSecret.startsWith('{') && apiSecret.includes('"privateKey"')) {
  const parsed = JSON.parse(apiSecret);
  apiKey = parsed.name;
  apiSecret = parsed.privateKey;
}

let rawSecret = apiSecret
  .replace(/-----BEGIN EC PRIVATE KEY-----/gi, '')
  .replace(/-----END EC PRIVATE KEY-----/gi, '')
  .replace(/\\n/g, '')
  .replace(/\s/g, '')
  .replace(/"/g, '');

const formattedBody = rawSecret.match(/.{1,64}/g)?.join('\n') || rawSecret;
const finalSecret = '-----BEGIN EC PRIVATE KEY-----\n' + formattedBody + '\n-----END EC PRIVATE KEY-----\n';

try {
  const token = jwt.sign(
    { sub: apiKey },
    finalSecret,
    { algorithm: 'ES256' }
  );
  console.log('SUCCESS, token generated');
} catch (e) {
  console.log('FAILED:', e.message);
}
