import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  // We expect the app to redirect to Shopify login or show an error if not embedded properly
  // But for a basic check, we can see if the server responds.
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(500);
});
