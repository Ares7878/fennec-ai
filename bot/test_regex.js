const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
const fakeJson = JSON.stringify({ privateKey: pem.replace(/\n/g, '\\n') });

const match = fakeJson.match(/-----BEGIN EC PRIVATE KEY-----(.*?)-----END EC PRIVATE KEY-----/is);
if (match) {
  let body = match[1].replace(/\\\\n/g, '').replace(/\\n/g, '').replace(/\s/g, '').replace(/"/g, '').replace(/\\/g, '');
  const formattedBody = body.match(/.{1,64}/g)?.join('\n') || body;
  const finalSecret = '-----BEGIN EC PRIVATE KEY-----\n' + formattedBody + '\n-----END EC PRIVATE KEY-----\n';
  try { 
    crypto.createPrivateKey(finalSecret); 
    console.log('SUCCESS'); 
  } catch(e) { 
    console.log('FAIL:', e.message); 
  }
} else { 
  console.log('NO MATCH'); 
}
