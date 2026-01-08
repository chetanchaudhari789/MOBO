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

  // Landing assertions
  await expect(page.getByText('MED_TEST', { exact: false })).toBeVisible();

  // Navigate one core section
  await page.getByRole('button', { name: 'Market' }).click();
  await expect(page.getByText('Inventory Deck')).toBeVisible();
});
