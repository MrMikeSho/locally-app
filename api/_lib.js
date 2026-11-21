// Shared helpers for the Locally payment API. Files that start with "_" are NOT public routes on Vercel.
const crypto = require('crypto');

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const TIER_ORDER = ['cottage_1_4', 'house_2_3', 'house_4_7'];
const FEES = { cottage_1_4: 5, house_2_3: 7, house_4_7: 10 };
const LABELS = { cottage_1_4: '1–4 Rooms Cottage', house_2_3: '2–3 Bed House', house_4_7: '4–7 Bed House' };

// Supabase REST call using the service role key (bypasses RLS, so this key must NEVER be in the website code)
async function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (SB_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SB_KEY;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(SB_URL + '/rest/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
  if (!r.ok) { const e = new Error((data && (data.message || data.error)) || 'Database error ' + r.status); e.status = r.status; throw e; }
  return data;
}

// Paynow signature: SHA-512 of all values (in order, hash excluded) + integration key, upper-case hex
function paynowHash(values, key) {
  return crypto.createHash('sha512').update(values.join('') + key, 'utf8').digest('hex').toUpperCase();
}
function parsePaynow(text) {
  const entries = [...new URLSearchParams(text).entries()];
  const obj = {}; entries.forEach(([k, v]) => { obj[k.toLowerCase()] = v; });
  const got = (obj.hash || '').toUpperCase();
  const want = paynowHash(entries.filter(([k]) => k.toLowerCase() !== 'hash').map(([, v]) => v), process.env.PAYNOW_INTEGRATION_KEY || '');
  let valid = false;
  if (got.length === want.length && got.length > 0) valid = crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  return { obj, valid };
}

const isPaidStatus = (s) => ['paid', 'awaiting delivery', 'delivered'].includes(String(s || '').toLowerCase());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mark the request paid and log the money in Cash Flow. Safe to run twice for the same payment.
async function markPaid(reference, paynowRef, amount) {
  const cols = 'id,first_name,last_name,neighborhood,property_tier';
  let rows = await sb('renter_requests?paynow_reference=eq.' + encodeURIComponent(reference) + '&select=' + cols);
  if (!rows.length) {                               // an earlier attempt for the same request
    const m = /^REQ-(\d+)-/.exec(reference || '');
    if (m) rows = await sb('renter_requests?id=eq.' + m[1] + '&select=' + cols);
  }
  const row = rows[0];
  if (row) await sb('renter_requests?id=eq.' + row.id, { method: 'PATCH', body: { payment_status: 'paid', fee_amount: amount }, prefer: 'return=minimal' });
  const who = row ? `${row.first_name || ''} ${row.last_name || ''}`.trim() + (row.neighborhood ? ` (${row.neighborhood})` : '') + ' • ' + (LABELS[row.property_tier] || '') : reference;
  await sb('transactions?on_conflict=reference', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
    body: { type: 'income', amount, category: 'Viewing Fee', note: `Auto (Paynow): ${who}`, reference: 'PN-' + (paynowRef || reference) }
  });
  return !!row;
}

module.exports = { sb, paynowHash, parsePaynow, isPaidStatus, markPaid, UUID, TIER_ORDER, FEES, LABELS };
