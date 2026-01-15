import { test, expect } from '@playwright/test';

const ADMIN_ID = 'root';
const PASSWORD = 'ChangeMe_123!';

test('admin can authenticate and see sidebar', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('root').fill(ADMIN_ID);
  await page.getByRole('textbox', { name: 'Security Key' }).fill(PASSWORD);
  await page.getByRole('button', { name: /Authenticate Session/i }).click();

  // Cold-start Next compilation can make the first post-login render slow.
  await expect(page.getByText(/Mobo.*Admin/i)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 45_000 });
});
