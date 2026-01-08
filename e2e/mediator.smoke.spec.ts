import { test, expect } from '@playwright/test';

const MEDIATOR_MOBILE = '9000000002';
const PASSWORD = 'ChangeMe_123!';

test('mediator can login and open Market', async ({ page }) => {
  await page.goto('/');

  // Splash -> Login
  await page.getByRole('button', { name: /^Login$/ }).click();

  await page.getByPlaceholder('Mobile Number').fill(MEDIATOR_MOBILE);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^Login$/ }).click();

  await page.waitForLoadState('networkidle');

  // Landing assertions (avoid brittle user-name text; wait for a stable navigation entry)
  await expect(page.getByRole('button', { name: 'Market' })).toBeVisible({ timeout: 15000 });

  // Navigate one core section
  await page.getByRole('button', { name: 'Market' }).click();
  await expect(page.getByText('Inventory Deck')).toBeVisible();
});
