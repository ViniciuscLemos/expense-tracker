import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// automatic accessibility check (contrast, labels, names...) in light and dark mode, on the
// login page and on a full month of the demo account

async function audit(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('the login page', async ({ page }) => {
      await page.goto('./');
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });

    test('a month with entries, and the categories', async ({ page }) => {
      await page.goto('./');
      await page.getByRole('button', { name: "Open Marina's notebook" }).click();
      await page.getByRole('button', { name: 'Previous month' }).click();
      await expect(page.locator('.ledger-days')).toBeVisible();
      await expect(page.locator('.calendar')).toBeVisible();
      expect(await audit(page)).toEqual([]);

      await page.getByRole('button', { name: 'year', exact: true }).click();
      await expect(page.locator('.twelve')).toBeVisible();
      expect(await audit(page)).toEqual([]);

      await page.getByRole('button', { name: 'goals', exact: true }).click();
      await expect(page.locator('.goal').first()).toBeVisible();
      expect(await audit(page)).toEqual([]);

      await page.getByRole('button', { name: 'categories' }).click();
      await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });
  });
}
