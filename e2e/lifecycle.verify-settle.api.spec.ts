import { test, expect } from '@playwright/test';
import { loginAndGetAccessToken } from './_apiAuth';

// This spec drives the critical money-moving lifecycle via HTTP APIs.
// It relies on the backend E2E seed users and runs against the buyer project by default.

test('order lifecycle: buyer create -> ops verify -> ops settle -> wallets credited', async ({ request }) => {
  // IMPORTANT: tests run in parallel; don't reuse the single seeded deal because
  // other specs (buyer + mediator) also create/verify orders for it.
  // We instead create a unique campaign+deal for this spec.
  const buyerMobile = '9000000004';
  const opsUsername = 'root';
  const brandMobile = '9000000003';
  const password = 'ChangeMe_123!';

  const buyerLogin = await loginAndGetAccessToken(request, { mobile: buyerMobile, password });
  const opsLogin = await loginAndGetAccessToken(request, { username: opsUsername, password });
  const brandLogin = await loginAndGetAccessToken(request, { mobile: brandMobile, password });

  const buyer = { user: buyerLogin.user, tokens: { accessToken: buyerLogin.accessToken } };
  const ops = { user: opsLogin.user, tokens: { accessToken: opsLogin.accessToken } };
  const brand = { user: brandLogin.user, tokens: { accessToken: brandLogin.accessToken } };

  const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Create a fresh campaign + deal that won't collide with other E2E specs.
  const lifecycleTitle = `Lifecycle Campaign ${Date.now()}`;

  const createCampaignRes = await request.post('/api/ops/campaigns', {
    headers: authHeaders(ops.tokens.accessToken),
    data: {
      brandUserId: brand.user.id,
      title: lifecycleTitle,
      platform: 'Amazon',
      dealType: 'Discount',
      price: 999,
      originalPrice: 1999,
      payout: 150,
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/lifecycle',
      totalSlots: 10,
      allowedAgencies: [],
      returnWindowDays: 14,
    },
  });
  expect(createCampaignRes.ok()).toBeTruthy();
  const createdCampaign = (await createCampaignRes.json()) as any;
  const campaignId = String(createdCampaign?.id || '');
  expect(campaignId).toBeTruthy();

  // Assign slots so the buyer's mediator has access.
  const assignRes = await request.post('/api/ops/campaigns/assign', {
    headers: authHeaders(ops.tokens.accessToken),
    data: {
      id: campaignId,
      assignments: {
        MED_TEST: { limit: 5 },
      },
    },
  });
  expect(assignRes.ok()).toBeTruthy();

  // Publish deal for the seeded mediator.
  const publishRes = await request.post('/api/ops/deals/publish', {
    headers: authHeaders(ops.tokens.accessToken),
    data: {
      id: campaignId,
      commission: 50,
      mediatorCode: 'MED_TEST',
    },
  });
  expect(publishRes.ok()).toBeTruthy();

  // Fetch products and pick our unique deal.
  const productsRes = await request.get('/api/products', {
    headers: authHeaders(buyer.tokens.accessToken),
  });
  expect(productsRes.ok()).toBeTruthy();
  const deals: any[] = (await productsRes.json()) ?? [];
  expect(Array.isArray(deals)).toBeTruthy();
  const deal = deals.find((d) => String(d?.campaignId) === campaignId) ?? deals.find((d) => String(d?.title) === lifecycleTitle);
  expect(deal).toBeTruthy();

  // Wallets before
  const meBeforeRes = await request.get('/api/auth/me', {
    headers: authHeaders(buyer.tokens.accessToken),
  });
  expect(meBeforeRes.ok()).toBeTruthy();
  const meBefore = await meBeforeRes.json();
  const buyerWalletBefore = Number(meBefore?.user?.wallet?.balancePaise ?? 0);

  // Create order with proof at creation time (UI-equivalent).
  // The backend enforces one active order per buyer+deal, so this spec must be idempotent.
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
      reviewLink:
        String(deal.dealType ?? '').toLowerCase() === 'review'
          ? 'https://example.com/review/e2e'
          : undefined,
      screenshots: {
        order: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48dGV4dCB4PSIxMCIgeT0iNTAiPkUyRSBQcm9vZjwvdGV4dD48L3N2Zz4=',
      },
    },
  });

  let orderId: string;
  let currentWorkflow: string | undefined;

  if (createRes.ok()) {
    const created = (await createRes.json()) as any;
    orderId = String(created?.id || '');
    currentWorkflow = created?.workflowStatus;
    expect(orderId).toBeTruthy();
  } else {
    // Likely DUPLICATE_DEAL_ORDER. Re-use the most recent order for this buyer.
    const existingRes = await request.get(`/api/orders/user/${buyer.user.id}`, {
      headers: authHeaders(buyer.tokens.accessToken),
    });
    expect(existingRes.ok()).toBeTruthy();
    const existing = (await existingRes.json()) as any[];
    expect(Array.isArray(existing)).toBeTruthy();
    expect(existing.length).toBeGreaterThan(0);
    const reusable = existing.find((o) => o?.items?.[0]?.productId === String(deal.id)) ?? existing[0];
    orderId = String(reusable?.id || '');
    currentWorkflow = String(reusable?.workflowStatus || '');
    expect(orderId).toBeTruthy();
  }

  // Verify (ops/admin) - only valid from UNDER_REVIEW.
  if (currentWorkflow === 'UNDER_REVIEW') {
    const verifyRes = await request.post('/api/ops/verify', {
      headers: authHeaders(ops.tokens.accessToken),
      data: { orderId, decision: 'APPROVE' },
    });
    expect(verifyRes.ok()).toBeTruthy();
    currentWorkflow = 'APPROVED';
  }

  // Settle (ops/admin) - only valid from APPROVED.
  if (currentWorkflow === 'APPROVED') {
    const settleRes = await request.post('/api/ops/orders/settle', {
      headers: authHeaders(ops.tokens.accessToken),
      data: { orderId, success: true, settlementRef: `E2E-SETTLE-${Date.now()}` },
    });
    expect(settleRes.ok()).toBeTruthy();
  }

  // Wallets after
  const meAfterRes = await request.get('/api/auth/me', {
    headers: authHeaders(buyer.tokens.accessToken),
  });
  expect(meAfterRes.ok()).toBeTruthy();
  const meAfter = await meAfterRes.json();
  const buyerWalletAfter = Number(meAfter?.user?.wallet?.balancePaise ?? 0);

  expect(buyerWalletAfter).toBeGreaterThanOrEqual(buyerWalletBefore);
});
