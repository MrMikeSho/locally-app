// Paynow calls this by itself after a payment. It checks the signature, marks the request paid and logs the income.
const { parsePaynow, isPaidStatus, markPaid } = require('./_lib');

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const p = parsePaynow(await rawBody(req));
    if (!p.valid) { console.error('Paynow webhook: bad signature'); return res.status(400).send('Invalid hash'); }
    if (isPaidStatus(p.obj.status) && p.obj.reference) {
      await markPaid(p.obj.reference, p.obj.paynowreference, Number(p.obj.amount || 0));
    }
    return res.status(200).send('OK');
  } catch (err) {
    console.error('paynow-webhook', err);
    return res.status(500).send('Server Error');   // Paynow will try again
  }
};
// Keep the raw body so the signature can be checked exactly as Paynow sent it
module.exports.config = { api: { bodyParser: false } };
