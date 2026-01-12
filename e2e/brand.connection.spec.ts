import { test, expect, type APIRequestContext } from '@playwright/test';

const BRAND_MOBILE = '9000000003';
const AGENCY_MOBILE = '9000000001';
const PASSWORD = 'ChangeMe_123!';

const BRAND_CODE = 'BRD_TEST';
const AGENCY_CODE = 'AG_TEST';

async function loginApi(request: APIRequestContext, mobile: string) {
  const res = await request.post('/api/auth/login', {
    data: { mobile, password: PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as any;
  const token = String(json?.tokens?.accessToken || '');
  expect(token).toBeTruthy();
  return { token, user: json.user };
}

test('brand can see and approve an agency connection request', async ({ page, request }) => {
  // Ensure a clean slate (idempotent test).
  const brandAuth = await loginApi(request, BRAND_MOBILE);

  const meRes = await request.get('/api/auth/me', {
    headers: { Authorization: `Bearer ${brandAuth.token}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const meJson = (await meRes.json()) as any;
  const me = meJson?.user ?? meJson;
  const brandId = String(me?.id || '');
  expect(brandId).toBeTruthy();

  // If already connected, remove so we can exercise the full request/approve flow.
  if (Array.isArray(me?.connectedAgencies) && me.connectedAgencies.includes(AGENCY_CODE)) {
    const removeRes = await request.post('/api/brand/agencies/remove', {
      headers: { Authorization: `Bearer ${brandAuth.token}` },
      data: { brandId, agencyCode: AGENCY_CODE },
    });
    expect(removeRes.ok()).toBeTruthy();
  }

  // If already pending, reject it so we can create a fresh request.
  const pending = Array.isArray(me?.pendingConnections) ? me.pendingConnections : [];
  const existing = pending.find((p: any) => String(p?.agencyCode) === AGENCY_CODE);
  if (existing) {
    const rejectRes = await request.post('/api/brand/requests/resolve', {
      headers: { Authorization: `Bearer ${brandAuth.token}` },
      data: { agencyCode: AGENCY_CODE, action: 'reject' },
    });
    expect(rejectRes.ok()).toBeTruthy();
  }

  // Create a request as the agency.
  const agencyAuth = await loginApi(request, AGENCY_MOBILE);
  const connectRes = await request.post('/api/ops/brands/connect', {
    headers: { Authorization: `Bearer ${agencyAuth.token}` },
    data: { brandCode: BRAND_CODE },
  });
  if (!connectRes.ok()) {
    const payload = (await connectRes.json().catch(() => null)) as any;
    expect(connectRes.status()).toBe(409);
    expect(payload?.error?.code).toBe('ALREADY_REQUESTED');
  }

  // Now verify in the brand UI.
  await page.goto('/');
  await page.getByRole('button', { name: /Access Portal/i }).click();
  await page.getByPlaceholder('9000000000').fill(BRAND_MOBILE);
  await page.getByPlaceholder('â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Portal/i }).click();

  await expect(page.getByText('Partner Portal', { exact: true })).toBeVisible({ timeout: 15000 });

  // Open requests (this also triggers refreshMe()).
  await page.getByRole('button', { name: 'Requests' }).click();

  const pendingCards = page
    .locator('div.bg-white.p-3')
    .filter({ hasText: 'Wants to connect with your brand.' })
    .filter({ hasText: 'E2E Agency' });

  await expect(pendingCards.first()).toBeVisible({ timeout: 15000 });
  await pendingCards.first().getByRole('button', { name: 'Approve' }).click();

  // Verify persistence by navigating away/back (Requests click triggers refreshMe()).
  await page.getByRole('button', { name: 'Agency Partners' }).click();
  await page.getByRole('button', { name: 'Requests' }).click();
  await expect(pendingCards).toHaveCount(0, { timeout: 15000 });

  // And the agency should appear in partners.
  await page.getByRole('button', { name: 'Agency Partners' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Agency' }).first()).toBeVisible({
    timeout: 15000,
  });
});
