// POST { token, check? }  ->  safe summary of one renter request for the pay page (no email / phone / ids)
const { sb, parsePaynow, isPaidStatus, markPaid, UUID } = require('./_lib');

const COLS = 'id,first_name,neighborhood,budget,bedrooms,timeline,property_tier,fee_amount,request_status,payment_status,expires_at,poll_url,paynow_reference';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { token, check } = req.body || {};
    if (!token || !UUID.test(token)) return res.status(404).json({ error: 'not_found' });
    const q = () => sb('renter_requests?pay_token=eq.' + token + '&select=' + COLS);
    let rows = await q();
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    let r = rows[0], paynowStatus = null;

    // Backup for a missed notification: ask Paynow directly
    if (check && r.payment_status !== 'paid' && r.poll_url) {
      try {
        const host = new URL(r.poll_url).hostname;
        if (host === 'paynow.co.zw' || host.endsWith('.paynow.co.zw')) {
          const p = parsePaynow(await (await fetch(r.poll_url, { method: 'POST' })).text());
          if (p.valid) {
            paynowStatus = (p.obj.status || '').toLowerCase();
            if (isPaidStatus(paynowStatus)) { await markPaid(p.obj.reference || r.paynow_reference, p.obj.paynowreference, Number(p.obj.amount || r.fee_amount)); rows = await q(); r = rows[0]; }
          }
        }
      } catch (e) { /* ignore, the page will ask again */ }
    }

    const secs = r.expires_at ? Math.floor((new Date(r.expires_at).getTime() - Date.now()) / 1000) : 0;
    let state = 'payable';
    if (r.payment_status === 'paid') state = 'paid';
    else if (r.request_status === 'declined') state = 'declined';
    else if (r.request_status === 'pending') state = 'pending';
    else if (secs <= 0) state = 'expired';

    return res.status(200).json({
      state, first_name: r.first_name, neighborhood: r.neighborhood, budget: r.budget, bedrooms: r.bedrooms, timeline: r.timeline,
      property_tier: r.property_tier, fee_amount: Number(r.fee_amount), seconds_left: Math.max(0, secs), paynow_status: paynowStatus
    });
  } catch (err) {
    console.error('get-request', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
