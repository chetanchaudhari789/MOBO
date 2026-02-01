import { test, expect } from '@playwright/test';

const BRAND_MOBILE = '9000000003';
const PASSWORD = 'ChangeMe_123!';

test('brand can open Order Intelligence', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 180_000 });

  // Splash -> Login
  await page.getByRole('button', { name: /Access Portal/i }).click();

  await page.getByPlaceholder('9000000000').fill(BRAND_MOBILE);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Portal/i }).click();

  await page.getByRole('button', { name: 'Order Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Order Intelligence' })).toBeVisible();
  await expect(page.getByPlaceholder('Search Orders...')).toBeVisible();
});
