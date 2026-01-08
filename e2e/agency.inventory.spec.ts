import { test, expect } from '@playwright/test';

const AGENCY_MOBILE = '9000000001';
const PASSWORD = 'ChangeMe_123!';

test('agency can open Inventory tab', async ({ page }) => {
  await page.goto('/');

  // Splash -> Login
  await page.getByRole('button', { name: /Enter Portal/i }).click();

  await page.getByPlaceholder('9000000000').fill(AGENCY_MOBILE);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Ops/i }).click();

  await page.getByRole('button', { name: 'Inventory' }).click();
  await expect(page.getByText('Offered by Brands', { exact: false })).toBeVisible();
});
