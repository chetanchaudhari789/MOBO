// Smoke check: mediator creates a self-owned campaign (allowedAgencies=[mediatorCode])
// and publishes it. This validates the unpublished->published flow.
//
// Usage:
//   node scripts/publish-selfowned-smoke.mjs
// Optional env:
//   API_BASE (default http://127.0.0.1:8080/api)
//   MED_MOBILE (default 9000000002)
//   MED_PASSWORD (default ChangeMe_123!)
//   MED_CODE (default MED_TEST)

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080/api';
const MED_MOBILE = process.env.MED_MOBILE || '9000000002';
const MED_PASSWORD = process.env.MED_PASSWORD || 'ChangeMe_123!';
const MED_CODE = process.env.MED_CODE || 'MED_TEST';

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = json?.message || json?.error || text || `HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.body = json ?? text;
    throw err;
  }
  return json;
}

async function main() {
  const login = await fetchJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile: MED_MOBILE, password: MED_PASSWORD }),
  });

  const token = login?.tokens?.accessToken;
  if (typeof token !== 'string' || token.length < 20) {
    throw new Error('Login succeeded but accessToken is missing/invalid');
  }

  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  const campaign = await fetchJson(`${API_BASE}/ops/campaigns`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `Self-owned publish smoke ${Date.now()}`,
      platform: 'Amazon',
      dealType: 'Discount',
      price: 999,
      originalPrice: 1200,
      payout: 100,
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      totalSlots: 10,
      allowedAgencies: [MED_CODE],
      returnWindowDays: 14,
    }),
  });

  const campaignId = String(campaign?.id || '');
  if (!campaignId) throw new Error('Create campaign did not return an id');

  const publish = await fetchJson(`${API_BASE}/ops/deals/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: campaignId,
      commission: 50,
      mediatorCode: MED_CODE,
    }),
  });

  if (publish?.ok !== true) {
    throw new Error(`Publish returned ok=${String(publish?.ok)}`);
  }

  // Optional: confirm deal list contains something.
  const deals = await fetchJson(`${API_BASE}/ops/deals?mediatorCode=${encodeURIComponent(MED_CODE)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });

  const dealCount = Array.isArray(deals) ? deals.length : Array.isArray(deals?.items) ? deals.items.length : null;

  console.log('SMOKE_OK');
  console.log(`campaignId=${campaignId}`);
  if (dealCount !== null) console.log(`dealCount=${dealCount}`);
}

main().catch((err) => {
  console.error('SMOKE_FAIL');
  console.error(err?.message || String(err));
  if (err?.status) console.error(`status=${err.status}`);
  process.exitCode = 1;
});
