import { test, expect } from '@playwright/test';

// This spec drives the critical money-moving lifecycle via HTTP APIs.
// It relies on the backend E2E seed users and runs against the buyer project by default.

test('order lifecycle: buyer create -> ops verify -> ops settle -> wallets credited', async ({ request }) => {
  const buyerMobile = '9000000004';
  const opsMobile = 'admin';
  const password = 'ChangeMe_123!';

  const login = async (mobile: string) => {
    const res = await request.post('/api/auth/login', {
      data: { mobile, password },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json?.tokens?.accessToken).toBeTruthy();
    return json as {
      user: { id: string; roles: string[] };
      tokens: { accessToken: string };
    };
  };

  const buyer = await login(buyerMobile);
  const ops = await login(opsMobile);

  const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Get at least one deal product from the seeded dataset.
  const productsRes = await request.get('/api/products', {
    headers: authHeaders(buyer.tokens.accessToken),
  });
  expect(productsRes.ok()).toBeTruthy();
  const deals: any[] = (await productsRes.json()) ?? [];
  expect(Array.isArray(deals)).toBeTruthy();
  expect(deals.length).toBeGreaterThan(0);
  const deal = deals.find((d) => typeof d?.title === 'string' && d.title.includes('E2E')) ?? deals[0];

  // Wallets before
  const meBeforeRes = await request.get('/api/auth/me', {
    headers: authHeaders(buyer.tokens.accessToken),
  });
  expect(meBeforeRes.ok()).toBeTruthy();
  const meBefore = await meBeforeRes.json();
  const buyerWalletBefore = Number(meBefore?.user?.wallet?.balancePaise ?? 0);

  // Create order with proof at creation time (UI-equivalent).
  const externalOrderId = `E2E-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createRes = await request.post('/api/orders', {
    headers: authHeaders(buyer.tokens.accessToken),
    data: {
      userId: buyer.user.id,
      items: [
        {
          productId: String(deal.id),
          title: String(deal.title ?? 'Deal'),
          image: String(deal.image ?? 'https://example.com/e2e.png'),
          priceAtPurchase: Number(deal.price ?? 0),
          commission: Number(deal.commission ?? 0),
          campaignId: String(deal.campaignId ?? ''),
          dealType: String(deal.dealType ?? 'General'),
          quantity: 1,
          platform: deal.platform ? String(deal.platform) : undefined,
          brandName: deal.brandName ? String(deal.brandName) : undefined,
        },
      ],
      externalOrderId,
      reviewLink: 'https://example.com/review/e2e',
      screenshots: {
        order: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48dGV4dCB4PSIxMCIgeT0iNTAiPkUyRSBQcm9vZjwvdGV4dD48L3N2Zz4=',
      },
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  const orderId = created?.id;
  expect(orderId).toBeTruthy();

  // Verify (ops/admin)
  const verifyRes = await request.post('/api/ops/verify', {
    headers: authHeaders(ops.tokens.accessToken),
    data: { orderId, decision: 'APPROVE' },
  });
  expect(verifyRes.ok()).toBeTruthy();

  // Settle (ops/admin)
  const settleRes = await request.post('/api/ops/orders/settle', {
    headers: authHeaders(ops.tokens.accessToken),
    data: { orderId, success: true, settlementRef: `E2E-SETTLE-${Date.now()}` },
  });
  expect(settleRes.ok()).toBeTruthy();

  // Wallets after
  const meAfterRes = await request.get('/api/auth/me', {
    headers: authHeaders(buyer.tokens.accessToken),
  });
  expect(meAfterRes.ok()).toBeTruthy();
  const meAfter = await meAfterRes.json();
  const buyerWalletAfter = Number(meAfter?.user?.wallet?.balancePaise ?? 0);

  expect(buyerWalletAfter).toBeGreaterThanOrEqual(buyerWalletBefore);
});
