import { expect, test } from '@playwright/test';

// a fixed "today", so the month names and the sample data don't depend on when it runs
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await page.goto('./');
});

async function add(page, { type = 'Expense', description, amount, date }) {
  const form = page.locator('.entry-form');
  await form.getByRole('button', { name: type, exact: true }).click();
  await form.getByLabel('Description').fill(description);
  await form.getByLabel('Amount ($)').fill(amount);
  if (date) await form.getByLabel('Date').fill(date);
  await form.getByRole('button', { name: 'Add' }).click();
}

const summaryValue = (page, label) => page.locator('.summary .card', { hasText: label }).locator('strong');

test('adds an expense and shows it in the summary and the list', async ({ page }) => {
  await add(page, { description: 'Groceries', amount: '42.50' });
  await expect(summaryValue(page, 'Expenses')).toHaveText('$42.50');
  await expect(summaryValue(page, 'Month balance')).toHaveText('-$42.50');
  await expect(page.locator('.entry-list')).toContainText('Groceries');

  await add(page, { type: 'Income', description: 'Freelance job', amount: '100' });
  await expect(summaryValue(page, 'Income')).toHaveText('$100.00');
  await expect(summaryValue(page, 'Month balance')).toHaveText('$57.50');
});

test('says what is wrong with the form instead of adding', async ({ page }) => {
  await add(page, { description: 'Coffee', amount: 'abc' });
  await expect(page.getByText('Invalid amount. Example: 25.90')).toBeVisible();
  await expect(page.getByText('Nothing added in October 2026.')).toBeVisible();
});

test('deletes an entry and brings it back with undo', async ({ page }) => {
  await add(page, { description: 'Gym', amount: '30' });
  await page.getByRole('button', { name: 'Delete Gym' }).click();
  await expect(page.getByRole('status')).toContainText('Deleted "Gym"');
  await expect(page.locator('.entry-list')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.entry-list')).toContainText('Gym');
  await expect(summaryValue(page, 'Expenses')).toHaveText('$30.00');
});

test('edits an entry', async ({ page }) => {
  await add(page, { description: 'Taxi', amount: '12' });
  await page.getByRole('button', { name: 'Edit Taxi' }).click();
  await page.getByLabel('Amount ($)').fill('15');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(summaryValue(page, 'Expenses')).toHaveText('$15.00');
});

test('filters by type and searches', async ({ page }) => {
  await page.getByRole('button', { name: 'Load sample data' }).click();
  const list = page.locator('.entry-list');
  await expect(list).toContainText('Salary');

  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(list).not.toContainText('Salary');
  await expect(list).toContainText('Rent');

  await page.getByLabel('Search entries').fill('groceries');
  await expect(list.locator('li')).toHaveCount(2);

  await page.getByLabel('Search entries').fill('nothing like this');
  await expect(page.getByText('No entries match the filter.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(list).toContainText('Salary');
});

test('moves between months, and jumps to the month of a new entry', async ({ page }) => {
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.month-nav')).toContainText('September 2026');
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.locator('.month-nav')).toContainText('October 2026');

  await add(page, { description: 'Old bill', amount: '20', date: '2026-08-03' });
  await expect(page.locator('.month-nav')).toContainText('August 2026');
  await expect(page.locator('.entry-list')).toContainText('Old bill');
});

test('keeps the entries after a reload', async ({ page }) => {
  await add(page, { description: 'Books', amount: '25' });
  await page.reload();
  await expect(page.locator('.entry-list')).toContainText('Books');
  await expect(summaryValue(page, 'Expenses')).toHaveText('$25.00');
});

test('a backup brings the entries back in a clean browser', async ({ page }) => {
  await add(page, { description: 'Books', amount: '25' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = await (await download).path();

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText('Nothing added in October 2026')).toBeVisible();

  await page.locator('.backup input[type=file]').setInputFiles(file);
  await expect(page.locator('.backup')).toContainText('1 entry restored.');
  await expect(summaryValue(page, 'Expenses')).toHaveText('$25.00');

  await page.locator('.backup input[type=file]').setInputFiles(file);
  await expect(page.locator('.backup')).toContainText('already here');
});
