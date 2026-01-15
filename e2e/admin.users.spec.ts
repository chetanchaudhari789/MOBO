import { test, expect } from '@playwright/test';

const ADMIN_ID = 'root';
const PASSWORD = 'ChangeMe_123!';

test('admin can view seeded users', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('root').fill(ADMIN_ID);
  await page.getByRole('textbox', { name: 'Security Key' }).fill(PASSWORD);
  await page.getByRole('button', { name: /Authenticate Session/i }).click();

  // Cold-start Next compilation can make the first post-login render slow.
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 45_000 });

  // Navigate to Users
  await page.getByRole('button', { name: 'Users' }).click({ timeout: 45_000 });

  // Assert seeded shopper exists
  await expect(page.getByText('E2E Shopper', { exact: true })).toBeVisible();
  await expect(page.getByText('9000000004', { exact: true })).toBeVisible();
});
