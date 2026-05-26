const https = require('https');
const querystring = require('querystring');

function stripePost(path, body) {
  return new Promise((resolve, reject) => {
    const data = querystring.stringify(body);
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
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

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

  let name, price, note, image, stripePriceId, qty;
  try { ({ name, price, note, image, stripePriceId, qty } = JSON.parse(event.body)); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid body' }) }; }

  const origin = event.headers.origin || 'https://goatlabs.bio';
  const quantity = Math.max(1, Math.min(10, parseInt(qty) || 1));

  let lineItem;

  if (stripePriceId) {
    // Use pre-created Stripe price — cleanest approach
    lineItem = {
      'line_items[0][price]': stripePriceId,
      'line_items[0][quantity]': quantity
    };
  } else {
    // Fallback: ad-hoc price
    const amountCents = Math.round(parseFloat(String(price).replace(/[^0-9.]/g, '')) * 100);
    lineItem = {
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': name,
      'line_items[0][price_data][product_data][description]': note || 'Research peptide',
      'line_items[0][price_data][unit_amount]': amountCents,
      'line_items[0][quantity]': quantity,
      ...(image ? { 'line_items[0][price_data][product_data][images][0]': image } : {})
    };
  }

  const result = await stripePost('/v1/checkout/sessions', {
    'payment_method_types[0]': 'card',
    ...lineItem,
    'mode': 'payment',
    'success_url': `${origin}/success.html?product=${encodeURIComponent(name)}`,
    'cancel_url': `${origin}/product.html?name=${encodeURIComponent(name)}`
  });

  if (result.status === 200) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ url: result.body.url }) };
  }
  return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Stripe error', details: result.body }) };
};
