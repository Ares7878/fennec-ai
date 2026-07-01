const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();

// Create fake Coinbase JSON
const fakeJson = JSON.stringify({
  name: "organizations/123/apiKeys/456",
  privateKey: pem.replace(/\n/g, '\\n')
});

// Simulate the bot logic
let apiSecret = fakeJson;
if (apiSecret.startsWith('{') && apiSecret.includes('"privateKey"')) {
  try {
    const parsed = JSON.parse(apiSecret);
    apiKey = parsed.name;
    apiSecret = parsed.privateKey;
  } catch(e) {
    console.log("JSON parse failed");
  }
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
