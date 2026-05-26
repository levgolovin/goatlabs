const https = require('https');
const querystring = require('querystring');

// ── GitHub ────────────────────────────────────────────────────────────────────
function githubRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
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
    }, (res) => {
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

// ── Stripe ────────────────────────────────────────────────────────────────────
function stripePost(path, params, stripeKey) {
  return new Promise((resolve, reject) => {
    const data = querystring.stringify(params);
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function stripeGet(path, stripeKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function parsePriceCents(priceStr) {
  return Math.round(parseFloat(String(priceStr).replace(/[^0-9.]/g, '')) * 100);
}

// Sync one product to Stripe — creates or updates product + price
async function syncProductToStripe(product, existingStripeId, existingPriceId, existingPriceCents, stripeKey) {
  const amountCents = parsePriceCents(product.price);
  const imageParams = product.image && product.image.startsWith('/images/')
    ? { 'images[0]': `https://goatlabs.bio${product.image}` }
    : {};

  if (!existingStripeId) {
    // Create new Stripe product
    const prod = await stripePost('/v1/products', {
      name: product.name,
      description: product.desc ? product.desc.slice(0, 500) : '',
      ...imageParams
    }, stripeKey);
    if (prod.status !== 200) return { stripeProductId: null, stripePriceId: null };

    // Create price for this product
    const price = await stripePost('/v1/prices', {
      product: prod.body.id,
      unit_amount: amountCents,
      currency: 'usd'
    }, stripeKey);
    if (price.status !== 200) return { stripeProductId: prod.body.id, stripePriceId: null };

    return { stripeProductId: prod.body.id, stripePriceId: price.body.id };
  }

  // Update existing product name/description/image
  await stripePost(`/v1/products/${existingStripeId}`, {
    name: product.name,
    description: product.desc ? product.desc.slice(0, 500) : '',
    ...imageParams
  }, stripeKey);

  // If price changed, archive old price and create new one
  if (amountCents !== existingPriceCents && existingPriceId) {
    await stripePost(`/v1/prices/${existingPriceId}`, { active: 'false' }, stripeKey);
  }

  if (amountCents !== existingPriceCents || !existingPriceId) {
    const price = await stripePost('/v1/prices', {
      product: existingStripeId,
      unit_amount: amountCents,
      currency: 'usd'
    }, stripeKey);
    return { stripeProductId: existingStripeId, stripePriceId: price.status === 200 ? price.body.id : existingPriceId };
  }

  return { stripeProductId: existingStripeId, stripePriceId: existingPriceId };
}

// ── Handler ───────────────────────────────────────────────────────────────────
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

  if (body.authCheck) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };

  const { products } = body;
  if (!Array.isArray(products)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'products must be array' }) };

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
  const FILE = '_data/products.json';
  const REPO = 'levgolovin/goatlabs';

  // Get current file from GitHub
  const current = await githubRequest('GET', `/repos/${REPO}/contents/${FILE}`, null, GITHUB_TOKEN);
  if (current.status !== 200) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Could not read current file' }) };
  }

  // Parse existing products to preserve Stripe IDs
  let existingProducts = [];
  try {
    const decoded = Buffer.from(current.body.content, 'base64').toString('utf8');
    existingProducts = JSON.parse(decoded).products || [];
  } catch (e) {}

  // Sync each product to Stripe (if key is set)
  const syncedProducts = await Promise.all(products.map(async (p) => {
    if (!STRIPE_KEY) return p;

    // Find existing product — match by stripeProductId first, then by name
    const existing = existingProducts.find(e => e.stripeProductId && e.stripeProductId === p.stripeProductId)
      || existingProducts.find(e => e.name === p.name);

    const existingPriceCents = existing ? parsePriceCents(existing.price) : null;

    try {
      const { stripeProductId, stripePriceId } = await syncProductToStripe(
        p,
        existing?.stripeProductId || null,
        existing?.stripePriceId   || null,
        existingPriceCents,
        STRIPE_KEY
      );
      return { ...p, stripeProductId, stripePriceId };
    } catch (e) {
      // Don't fail the whole save if Stripe sync fails
      return { ...p, stripeProductId: existing?.stripeProductId, stripePriceId: existing?.stripePriceId };
    }
  }));

  // Save to GitHub
  const content = Buffer.from(JSON.stringify({ products: syncedProducts }, null, 2)).toString('base64');
  const result = await githubRequest('PUT', `/repos/${REPO}/contents/${FILE}`, {
    message: 'Update products via admin panel',
    content,
    sha: current.body.sha
  }, GITHUB_TOKEN);

  if (result.status === 200 || result.status === 201) {
    const stripeStatus = STRIPE_KEY ? 'synced' : 'no_stripe_key';
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, stripeStatus }) };
  }
  return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'GitHub API error' }) };
};
