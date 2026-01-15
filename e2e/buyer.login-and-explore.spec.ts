import { test, expect } from '@playwright/test';

const SHOPPER_MOBILE = '9000000004';
const SHOPPER_PASSWORD = 'ChangeMe_123!';

test('buyer can login and view deals in Explore', async ({ page }) => {
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.goto('/');

  // Splash -> Login
  await page.getByRole('button', { name: 'Get Started' }).click();

  await page.getByPlaceholder('Mobile Number').fill(SHOPPER_MOBILE);
  await page.getByPlaceholder('Password').fill(SHOPPER_PASSWORD);

  const loginResPromise = page.waitForResponse(
    (res) => res.url().includes('/api/auth/login') && res.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Sign In' }).click();
  const loginRes = await loginResPromise;
  expect(loginRes.ok(), `Login failed: ${loginRes.status()} ${loginRes.statusText()}`).toBeTruthy();

  // Wait for the post-login shell to render (bottom tab bar).
  await expect(page.getByRole('button', { name: 'Explore' })).toBeVisible();

  // Navigate to Explore via bottom nav
  await page.getByRole('button', { name: 'Explore' }).click();

  await expect(page.getByRole('heading', { name: 'Explore Deals' })).toBeVisible();

  // We seed at least one deal for E2E.
  await expect(page.getByRole('button', { name: /GET LOOT LINK/i }).first()).toBeVisible();
});
