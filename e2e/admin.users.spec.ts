import { test, expect } from '@playwright/test';

const ADMIN_ID = 'root';
const PASSWORD = 'ChangeMe_123!';

test.describe.configure({ retries: 2 });

test('admin can view seeded users', async ({ page }) => {
  test.setTimeout(360_000);

  const login = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 180_000 });
      const usernameInput = page.getByLabel('Username');
      const passwordInput = page.getByLabel('Security Key');
      try {
        await usernameInput.waitFor({ timeout: 90_000 });
        await passwordInput.waitFor({ timeout: 90_000 });

        await usernameInput.fill(ADMIN_ID);
        await passwordInput.fill(PASSWORD);
        await page.getByRole('button', { name: /Authenticate Session/i }).click();

        await page.getByRole('button', { name: 'Overview' }).waitFor({ timeout: 120_000 });

        // Ensure sidebar is ready before proceeding.
        await page.getByRole('button', { name: 'Users' }).waitFor({ timeout: 120_000 });
        return true;
      } catch {
        // Retry on slow cold-start or failed login render.
      }
    }
    return false;
  };

  const ok = await login();
  expect(ok).toBeTruthy();

  // Navigate to Users (retry once if UI is still rendering).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.getByRole('button', { name: 'Users' }).click({ timeout: 60_000 });
      break;
    } catch {
      if (attempt === 1) throw new Error('Users navigation failed');
      await page.waitForTimeout(2000);
    }
  }

  // Assert seeded shopper exists
  await expect(page.getByText('E2E Shopper', { exact: true })).toBeVisible();
  await expect(page.getByText('9000000004', { exact: true })).toBeVisible();
});
