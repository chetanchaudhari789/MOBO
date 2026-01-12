import { test, expect } from '@playwright/test';

const ADMIN_ID = 'root';
const PASSWORD = 'ChangeMe_123!';

test('admin can authenticate and see sidebar', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('root').fill(ADMIN_ID);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /Authenticate Session/i }).click();

  await expect(page.getByText(/Mobo.*Admin/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
});
