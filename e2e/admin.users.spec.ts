import { test, expect } from '@playwright/test';

<<<<<<< HEAD
const ADMIN_ID = 'root';
=======
const ADMIN_ID = 'admin';
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
