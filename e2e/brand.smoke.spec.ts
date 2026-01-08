import { test, expect } from '@playwright/test';

const BRAND_MOBILE = '9000000003';
const PASSWORD = 'ChangeMe_123!';

test('brand can login and view Campaigns', async ({ page }) => {
  await page.goto('/');

  // Splash -> Login
  await page.getByRole('button', { name: /Access Portal/i }).click();

  await page.getByPlaceholder('9000000000').fill(BRAND_MOBILE);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Portal/i }).click();

  // Landing assertions
  await expect(page.getByText('Partner Portal', { exact: true })).toBeVisible();

  // Navigate one core section
  await page.getByRole('button', { name: 'Campaigns' }).click();
  await expect(page.getByText('Active Campaigns')).toBeVisible();
});
