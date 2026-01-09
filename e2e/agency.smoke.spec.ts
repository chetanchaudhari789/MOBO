import { test, expect } from '@playwright/test';

const AGENCY_MOBILE = '9000000001';
const PASSWORD = 'ChangeMe_123!';

test('agency can login and view Team', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Splash -> Login
  await expect(page.getByRole('button', { name: /Enter Portal/i })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Enter Portal/i }).click();

  await page.getByPlaceholder('9000000000').fill(AGENCY_MOBILE);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Ops/i }).click();

  // Landing assertions (avoid brittle header text; wait for stable navigation)
  await expect(page.getByRole('button', { name: 'My Team' })).toBeVisible({ timeout: 15000 });

  // Navigate one core section
  await page.getByRole('button', { name: 'My Team' }).click();
  await expect(page.getByRole('button', { name: /Active Roster/i })).toBeVisible();

  // Connection flow entrypoint should be functional (real API call).
  await page.getByRole('button', { name: 'Connect Brands' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Brand' })).toBeVisible();
  await page.getByPlaceholder('BRD_XXXX').fill('BRD_TEST');
  await page.getByRole('button', { name: /Send Connection Request/i }).click();
  await expect(page.getByText(/Request sent to Brand BRD_TEST\.|Already connected or already pending for BRD_TEST\./i)).toBeVisible({ timeout: 15000 });
});
