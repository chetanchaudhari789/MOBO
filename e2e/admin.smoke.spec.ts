import { test, expect } from '@playwright/test';

<<<<<<< HEAD
const ADMIN_ID = 'root';
=======
const ADMIN_ID = 'admin';
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
const PASSWORD = 'ChangeMe_123!';

test('admin can authenticate and see sidebar', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('root').fill(ADMIN_ID);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /Authenticate Session/i }).click();

  await expect(page.getByText(/Mobo.*Admin/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
});
