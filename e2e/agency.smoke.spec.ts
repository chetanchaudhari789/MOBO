import { test, expect } from '@playwright/test';

const AGENCY_MOBILE = '9000000001';
const PASSWORD = 'ChangeMe_123!';

test('agency can login and view Team', async ({ page }) => {
  await page.goto('/');

  // Splash -> Login
  await page.getByRole('button', { name: /Enter Portal/i }).click();

  await page.getByPlaceholder('9000000000').fill(AGENCY_MOBILE);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Ops/i }).click();

  await page.waitForLoadState('networkidle');

  // Landing assertions (avoid brittle header text; wait for stable navigation)
  await expect(page.getByRole('button', { name: 'My Team' })).toBeVisible({ timeout: 15000 });

  // Navigate one core section
  await page.getByRole('button', { name: 'My Team' }).click();
  await expect(page.getByRole('button', { name: /Active Roster/i })).toBeVisible();
});
