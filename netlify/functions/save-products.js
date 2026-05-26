const https = require('https');

function githubRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'GOATlabs-Admin',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, x-admin-password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

  const password = event.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid body' }) }; }

  // Auth-check-only request from login form
  if (body.authCheck) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };

  const { products } = body;
  if (!Array.isArray(products)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'products must be array' }) };

  const TOKEN = process.env.GITHUB_TOKEN;
  const FILE = '_data/products.json';
  const REPO = 'levgolovin/goatlabs';

  const current = await githubRequest('GET', `/repos/${REPO}/contents/${FILE}`, null, TOKEN);
  if (current.status !== 200) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Could not read current file', details: current.body }) };
  }

  const content = Buffer.from(JSON.stringify({ products }, null, 2)).toString('base64');
  const result = await githubRequest('PUT', `/repos/${REPO}/contents/${FILE}`, {
    message: 'Update products via admin panel',
    content,
    sha: current.body.sha
  }, TOKEN);

  if (result.status === 200 || result.status === 201) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }
  return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'GitHub API error', details: result.body }) };
};
