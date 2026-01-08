import { test, expect } from '@playwright/test';

const ADMIN_ID = 'admin';
const PASSWORD = 'ChangeMe_123!';

test('admin can view seeded users', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('root').fill(ADMIN_ID);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /Authenticate Session/i }).click();

  // Navigate to Users
  await page.getByRole('button', { name: 'Users' }).click();

  // Assert seeded shopper exists
  await expect(page.getByText('E2E Shopper', { exact: true })).toBeVisible();
  await expect(page.getByText('9000000004', { exact: true })).toBeVisible();
});
