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

  let filename, content;
  try {
    ({ filename, content } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid body' }) };
  }

  if (!filename || !content) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'filename and content required' }) };
  }

  // Sanitize filename
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
  const TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'levgolovin/goatlabs';
  const filePath = `images/${safe}`;

  // Check if file already exists (need SHA to update)
  const existing = await githubRequest('GET', `/repos/${REPO}/contents/${filePath}`, null, TOKEN);
  const sha = existing.status === 200 ? existing.body.sha : undefined;

  const payload = {
    message: `Upload product image: ${safe}`,
    content,
    ...(sha ? { sha } : {})
  };

  const result = await githubRequest('PUT', `/repos/${REPO}/contents/${filePath}`, payload, TOKEN);

  if (result.status === 200 || result.status === 201) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ path: `/images/${safe}` }) };
  }
  return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Upload failed', details: result.body }) };
};
