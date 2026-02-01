import { test, expect } from '@playwright/test';

const BRAND_MOBILE = '9000000003';
const PASSWORD = 'ChangeMe_123!';

test('brand can open Order Intelligence', async ({ page }) => {
  test.setTimeout(240_000);

  const login = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 180_000 });
      await page.getByRole('button', { name: /Access Portal/i }).waitFor({ timeout: 90_000 });
      await page.getByRole('button', { name: /Access Portal/i }).click();

      const mobileInput = page.getByLabel('Mobile');
      const passwordInput = page.getByLabel('Password');
      try {
        await mobileInput.waitFor({ timeout: 90_000 });
        await passwordInput.waitFor({ timeout: 90_000 });

        await mobileInput.fill(BRAND_MOBILE);
        await passwordInput.fill(PASSWORD);
        await page.getByRole('button', { name: /Login to Portal/i }).click();

        await page.getByRole('button', { name: 'Order Intelligence' }).waitFor({ timeout: 90_000 });
        return;
      } catch {
        // Retry on slow cold-start or failed login render.
      }
    }
  };

  await login();

  await page.getByRole('button', { name: 'Order Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Order Intelligence' })).toBeVisible();
  await expect(page.getByPlaceholder('Search Orders...')).toBeVisible();
});
