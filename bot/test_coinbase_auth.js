const crypto = require('crypto');
const https = require('https');

const apiKey = 'organizations/d2b72064-0966-4694-a903-ccab630812d8/apiKeys/a8aeed7e-4856-4ffd-b1bb-ab6281976f87';
const apiSecret = 'bvj8Tp6Zgl5Jij4VgXRHq0GY1LeIDpLxmO5NjDbzxcd5xMPJtmMUfisCUeAoXEfveFVnpzwxvhSSZmraGSEF+A==';

async function testAuth(method, decodeSecret, encodeBase64) {
  return new Promise((resolve) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const requestPath = '/api/v3/brokerage/accounts';
    const sigInput = timestamp + 'GET' + requestPath;
    
    let decodedSecret;
    if (decodeSecret) {
      decodedSecret = Buffer.from(apiSecret, 'base64');
    } else {
      decodedSecret = Buffer.from(apiSecret);
    }
    
    const signature = crypto.createHmac('sha256', decodedSecret).update(sigInput).digest(encodeBase64 ? 'base64' : 'hex');

    const options = {
      hostname: 'api.coinbase.com',
      port: 443,
      path: requestPath,
      method: 'GET',
      headers: {
        'CB-ACCESS-KEY': apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'User-Agent': 'NodeJS',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        resolve({
          name: method,
          status: res.statusCode,
          body: data
        });
      });
    });

    req.on('error', (e) => {
      resolve({ name: method, error: e.message });
    });
    req.end();
  });
}

async function run() {
  console.log(await testAuth('Base64 Decode -> Base64 Encode', true, true));
  console.log(await testAuth('Raw String -> Hex Encode', false, false));
  console.log(await testAuth('Raw String -> Base64 Encode', false, true));
  console.log(await testAuth('Base64 Decode -> Hex Encode', true, false));
}

run();
