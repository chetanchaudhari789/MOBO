import path from 'node:path';
import { test, expect } from '@playwright/test';

const SHOPPER_MOBILE = '9000000004';
const SHOPPER_PASSWORD = 'ChangeMe_123!';

test('buyer can submit a cashback claim (creates an order)', async ({ page }) => {
  page.once('dialog', (dialog) => {
    // Dialogs can appear late (e.g., during navigation/teardown).
    // Accept best-effort and swallow any "Test ended" / closed-page errors.
    try {
      dialog.accept().catch(() => undefined);
    } catch {
      // ignore
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();

  await page.getByPlaceholder('Mobile Number').fill(SHOPPER_MOBILE);
  await page.getByPlaceholder('Password').fill(SHOPPER_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Go to Orders
  await page.getByRole('button', { name: 'Orders' }).click();
  await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible();

  // Open claim modal
  await page.getByRole('button', { name: 'New order' }).click();
  await expect(page.getByRole('heading', { name: 'Claim Cashback' })).toBeVisible();

  // Wait for the claim modal/sheet to appear
  const claimModal = page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Claim Cashback' });
  await expect(claimModal).toBeVisible();

  // Select the seeded deal (Discount tab is default)
  // We rely on seed title containing "E2E".
  await claimModal.getByText('E2E', { exact: false }).first().click();

  // Upload proof
  const proofPath = path.resolve(process.cwd(), 'e2e', 'fixtures', 'proof.svg');
  const fileInput = page.locator('input[type="file"][accept="image/*"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles(proofPath);

  // Submit claim
  const submit = page.getByRole('button', { name: 'Submit Claim' });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Order list should no longer be empty.
  await expect(page.getByText('No orders yet', { exact: false })).toHaveCount(0);
});
