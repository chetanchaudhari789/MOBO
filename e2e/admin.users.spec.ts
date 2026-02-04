import { test, expect } from '@playwright/test';

const ADMIN_ID = 'root';
const PASSWORD = 'ChangeMe_123!';

test.describe.configure({ retries: 2 });

test('admin can view seeded users', async ({ page, request }) => {
  test.setTimeout(360_000);

  const loginRes = await request.post('/api/auth/login', {
    data: { username: ADMIN_ID, password: PASSWORD },
  });
  expect(loginRes.ok()).toBeTruthy();
  const payload = await loginRes.json();
  const user = payload?.user;
  const tokens = payload?.tokens;
  expect(user).toBeTruthy();
  expect(tokens?.accessToken).toBeTruthy();

  await page.addInitScript(({ user, tokens }) => {
    localStorage.setItem('mobo_session', JSON.stringify(user));
    localStorage.setItem('mobo_tokens_v1', JSON.stringify(tokens));
  }, { user, tokens });

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.getByRole('button', { name: 'Users' }).waitFor({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Users' }).click({ timeout: 60_000 });

  // Assert seeded shopper exists
  await expect(page.getByText('E2E Shopper', { exact: true })).toBeVisible();
  await expect(page.getByText('9000000004', { exact: true })).toBeVisible();
});
