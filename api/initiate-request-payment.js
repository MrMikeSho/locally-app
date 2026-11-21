// POST { token, selected_tier, method: 'ecocash' | 'paynow', ecocash_phone? }  ->  starts a Paynow payment
const { sb, paynowHash, parsePaynow, UUID, TIER_ORDER, FEES, LABELS } = require('./_lib');

const SITE = 'https://locally.co.zw';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { token, selected_tier, method, ecocash_phone } = req.body || {};
    if (!token || !UUID.test(token)) return res.status(404).json({ error: 'This payment link is not valid.' });
    if (!TIER_ORDER.includes(selected_tier)) return res.status(400).json({ error: 'Please choose a property size.' });
    if (method !== 'ecocash' && method !== 'paynow') return res.status(400).json({ error: 'Please choose a payment method.' });

    const rows = await sb('renter_requests?pay_token=eq.' + token + '&select=id,email,neighborhood,property_tier,request_status,payment_status,expires_at');
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'This payment link is not valid.' });
    if (r.payment_status === 'paid') return res.status(409).json({ error: 'This request is already paid.' });
    if (r.request_status !== 'accepted') return res.status(409).json({ error: 'This request has not been accepted yet.' });
    if (!r.expires_at || new Date(r.expires_at).getTime() <= Date.now()) return res.status(410).json({ error: 'This link has expired. Please ask your broker for a new one.' });
    // The fee comes from the SERVER, and the tier can only stay the same or go up
    if (TIER_ORDER.indexOf(selected_tier) < TIER_ORDER.indexOf(r.property_tier)) return res.status(400).json({ error: 'That size is lower than the one your broker approved.' });
    const fee = FEES[selected_tier].toFixed(2);

    let phone = '';
    if (method === 'ecocash') {
      phone = String(ecocash_phone || '').replace(/[\s()-]/g, '').replace(/^\+?263/, '0');
      if (!/^07[78]\d{7}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid EcoCash number, like 077 123 4567.' });
    }

    const reference = `REQ-${r.id}-${Date.now()}`;
    // Save the reference first so the Paynow notification can always find this request
    await sb('renter_requests?id=eq.' + r.id, { method: 'PATCH', body: { paynow_reference: reference, payment_method: method, property_tier: selected_tier, fee_amount: Number(fee) }, prefer: 'return=minimal' });

    // Field ORDER matters: it is the order the signature is built in
    const fields = {
      id: process.env.PAYNOW_INTEGRATION_ID, reference, amount: fee,
      additionalinfo: `Locally viewing fee (${LABELS[selected_tier]})`,
      returnurl: `${SITE}/?pay_request=${token}`, resulturl: `${SITE}/api/paynow-webhook`,
      authemail: process.env.PAYNOW_TEST_EMAIL || r.email || 'locally.zw@gmail.com'
    };
    if (method === 'ecocash') { fields.phone = phone; fields.method = 'ecocash'; }
    fields.status = 'Message';
    fields.hash = paynowHash(Object.values(fields), process.env.PAYNOW_INTEGRATION_KEY || '');

    const url = method === 'ecocash' ? 'https://www.paynow.co.zw/interface/remotetransaction' : 'https://www.paynow.co.zw/interface/initiatetransaction';
    const pr = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    const p = parsePaynow(await pr.text());
    if ((p.obj.status || '').toLowerCase() !== 'ok') {
      console.error('Paynow refused:', p.obj.error || p.obj);
      return res.status(502).json({ error: 'Payment could not be started. Please try again in a moment.' });
    }
    if (!p.valid) { console.error('Paynow reply signature invalid'); return res.status(502).json({ error: 'Payment could not be started. Please try again.' }); }

    if (p.obj.pollurl) await sb('renter_requests?id=eq.' + r.id, { method: 'PATCH', body: { poll_url: p.obj.pollurl }, prefer: 'return=minimal' });
    return res.status(200).json({ ok: true, mode: method === 'ecocash' ? 'ecocash_ussd' : 'redirect', browserUrl: p.obj.browserurl || null, instructions: p.obj.instructions || null, reference });
  } catch (err) {
    console.error('initiate-request-payment', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
