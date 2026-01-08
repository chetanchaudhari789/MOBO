import { test, expect } from '@playwright/test';

const BUYER_MOBILE = '9000000005';
const MEDIATOR_MOBILE = '9000000002';
const PASSWORD = 'ChangeMe_123!';

test('mediator can open verification modal for a newly created buyer order', async ({ page, request }) => {
  page.on('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      // ignore
    }
  });

  // Create a fresh order as buyer via API first
  const loginRes = await request.post('/api/auth/login', {
    data: { mobile: BUYER_MOBILE, password: PASSWORD },
  });
  expect(loginRes.ok()).toBeTruthy();
  const loginJson = (await loginRes.json()) as any;
  const buyerToken = loginJson?.tokens?.accessToken;
  const buyerId = loginJson?.user?.id;
  expect(buyerToken).toBeTruthy();
  expect(buyerId).toBeTruthy();

  const dealsRes = await request.get('/api/products', {
    headers: { Authorization: `Bearer ${buyerToken}` },
  });
  expect(dealsRes.ok()).toBeTruthy();
  const deals = (await dealsRes.json()) as any[];
  expect(Array.isArray(deals)).toBeTruthy();
  expect(deals.length).toBeGreaterThan(0);
  const deal = deals[0];

  let expectedExternalOrderId = `MED-E2E-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createRes = await request.post('/api/orders', {
    headers: { Authorization: `Bearer ${buyerToken}` },
    data: {
      userId: String(buyerId),
      items: [
        {
          productId: String(deal.id),
          title: String(deal.title ?? 'Deal'),
          image: String(deal.image ?? 'https://example.com/e2e.png'),
          priceAtPurchase: Number(deal.price ?? 0),
          commission: Number(deal.commission ?? 0),
          campaignId: String(deal.campaignId ?? ''),
          dealType: String(deal.dealType ?? 'Discount'),
          quantity: 1,
          platform: deal.platform ? String(deal.platform) : undefined,
          brandName: deal.brandName ? String(deal.brandName) : undefined,
        },
      ],
      externalOrderId: expectedExternalOrderId,
      screenshots: {
        order: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48dGV4dCB4PSIxMCIgeT0iNTAiPkUyRSBNZWRpYXRvciBQcm9vZjwvdGV4dD48L3N2Zz4=',
      },
    },
  });

  if (!createRes.ok()) {
    // Anti-fraud prevents multiple active orders for the same buyer+deal.
    // If an order already exists, re-use it instead of failing.
    const existingRes = await request.get(`/api/orders/user/${buyerId}`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(existingRes.ok()).toBeTruthy();
    const existing = (await existingRes.json()) as any[];
    expect(Array.isArray(existing)).toBeTruthy();
    expect(existing.length).toBeGreaterThan(0);
    const reusable = existing.find((o) => o?.screenshots?.order) ?? existing[0];
    expectedExternalOrderId = String(reusable?.externalOrderId || 'Not Provided');
  }

  // Now login as mediator in UI
  await page.goto('/');
  await page.getByRole('button', { name: /^Login$/ }).click();
  await page.getByPlaceholder('Mobile Number').fill(MEDIATOR_MOBILE);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^Login$/ }).click();
  await page.waitForLoadState('networkidle');

  // Ensure inbox is loaded and open verification for the buyer
  const buyerCard = page
    .locator('div')
    .filter({ hasText: 'Buyer:' })
    .filter({ hasText: 'E2E Shopper 2' })
    .first();
  await expect(buyerCard).toBeVisible({ timeout: 15000 });

  await buyerCard.getByRole('button', { name: /Verify Proofs/i }).click();

  await expect(page.getByText('Verification Station', { exact: true })).toBeVisible();
  await expect(page.getByText(expectedExternalOrderId, { exact: true })).toBeVisible();
});
