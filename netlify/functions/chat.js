const https = require('https');

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

  let messages;
  try { ({ messages } = JSON.parse(event.body)); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid body' }) }; }

  const system = `You are the GOATlabs Peptide Advisor — a knowledgeable, professional assistant for a premium peptide research company. Help users understand peptides and find the right product for their goals.

Available products:
- BPC-157 | Recovery | $89.99 | 5mg vial — tissue repair, gut healing, inflammation
- TB-500 | Recovery | $94.99 | 5mg vial — systemic healing, flexibility, muscle regeneration
- Semaglutide | Metabolic | $129.99 | 2mg vial — appetite regulation, metabolic optimization
- Tirzepatide | Metabolic | $149.99 | 5mg vial — dual GIP/GLP-1 agonist, next-gen metabolic
- CJC-1295 | Performance | $74.99 | 2mg vial — growth hormone release, body composition
- Ipamorelin | Performance | $69.99 | 5mg vial — GH secretagogue, stack with CJC-1295
- Epithalon | Longevity | $84.99 | 10mg vial — telomere elongation, cellular rejuvenation
- Selank | Longevity | $79.99 | 5mg vial — anxiolytic, nootropic, stress modulation

Rules:
- Keep answers concise (2-4 sentences max)
- Always end with: "⚠️ For research purposes only."
- When recommending a product, bold its name
- Be warm, expert, and trustworthy`;

  try {
    const reply = await callOpenAI(system, messages);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ reply }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};

function callOpenAI(system, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 300,
      temperature: 0.7
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(buf);
          if (d.error) return reject(new Error(d.error.message));
          resolve(d.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
