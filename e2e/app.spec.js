import { expect, test } from '@playwright/test';

// every test makes its own account, so they don't see each other's entries
async function signUp(page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Make an account' }).click();
  await page.getByLabel('Your name').fill('Rui');
  await page.getByLabel('Email').fill(`rui-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel('Password').fill('a long password');
  await page.getByRole('button', { name: 'Make the account' }).click();
  await expect(page.getByText("Rui's expenses")).toBeVisible();
}

async function write(page, { kind = 'spent', what, amount, category }) {
  const line = page.locator('form.entry-line').first();
  await line.getByRole('button', { name: kind, exact: true }).click();
  await line.getByLabel('What').fill(what);
  await line.getByLabel('R$').fill(amount);
  if (category) await line.getByLabel('Category').selectOption({ label: category });
  await line.getByRole('button', { name: 'Write it down' }).click();
}

const figure = (page, label) => page.locator('.figures div', { hasText: label }).locator('dd');
const plain = (text) => text.replace(/\s/g, ' ');

test('a new account writes down an expense and an income', async ({ page }) => {
  await signUp(page);
  await expect(page.locator('.story')).toContainText('Nothing written down');

  await write(page, { what: 'Groceries', amount: '42,50', category: 'Food' });
  await expect(page.locator('.ledger-days')).toContainText('Groceries');
  await expect(figure(page, 'went out')).toHaveText(/42,50/);

  await write(page, { kind: 'got', what: 'Freelance job', amount: '100', category: 'Freelance' });
  await expect(figure(page, 'came in')).toHaveText(/100,00/);
  await expect(figure(page, 'left')).toHaveText(/57,50/);
  expect(plain(await page.locator('.story').innerText())).toContain('Of the R$ 100 that came in, R$ 58 is still here.');
});

test('says what is wrong instead of saving', async ({ page }) => {
  await signUp(page);
  await write(page, { what: 'Coffee', amount: 'abc' });
  await expect(page.getByText('The amount should look like 25,90 or 1.200')).toBeVisible();
  await expect(page.getByText('A blank page for')).toBeVisible();
});

test('edits, deletes and brings an entry back', async ({ page }) => {
  await signUp(page);
  await write(page, { what: 'Taxi', amount: '12' });
  await page.getByRole('button', { name: 'Edit Taxi' }).click();
  const editing = page.locator('form.entry-line.editing');
  await editing.getByLabel('R$').fill('15');
  await editing.getByRole('button', { name: 'Save' }).click();
  await expect(figure(page, 'went out')).toHaveText(/15,00/);

  await page.getByRole('button', { name: 'Delete Taxi' }).click();
  await expect(page.getByRole('status')).toContainText('Crossed out “Taxi”');
  await expect(page.getByText('A blank page for')).toBeVisible();
  await page.getByRole('button', { name: 'undo' }).click();
  await expect(page.locator('.ledger-days')).toContainText('Taxi');
  await expect(figure(page, 'went out')).toHaveText(/15,00/);
});

test('a budget that slips shows up in the story', async ({ page }) => {
  await signUp(page);
  await write(page, { what: 'Market', amount: '50', category: 'Food' });
  await page.getByRole('button', { name: 'categories' }).click();
  const budget = page.getByLabel('Monthly budget for Food');
  await budget.fill('40');
  await budget.press('Enter');
  await expect(budget).toHaveValue('40,00');

  await page.getByRole('button', { name: 'month' }).click();
  expect(plain(await page.locator('.story').innerText())).toContain('Food went R$ 10 over its budget.');
  await expect(page.locator('.budgets')).toContainText('R$ 10 over');
});

test('a category with entries moves them before it goes', async ({ page }) => {
  await signUp(page);
  await write(page, { what: 'Bus', amount: '4,40', category: 'Transport' });
  await page.getByRole('button', { name: 'categories' }).click();
  await page.getByRole('button', { name: 'Delete Transport' }).click();
  await page.getByLabel(/Move its/).selectOption({ label: 'Other' });
  await page.getByRole('button', { name: 'Move and delete' }).click();
  await expect(page.getByRole('button', { name: 'Delete Transport' })).toHaveCount(0);

  await page.getByRole('button', { name: 'month' }).click();
  await expect(page.locator('.ledger-days')).toContainText('Other');
});

test('every month: written once, shows up on its own and in the list', async ({ page }) => {
  await signUp(page);
  const line = page.locator('form.entry-line').first();
  await line.getByLabel('What').fill('Internet');
  await line.getByLabel('R$').fill('99,90');
  await line.getByLabel('Category').selectOption({ label: 'Housing' });
  await line.getByLabel('every month, on this day').check();
  await line.getByRole('button', { name: 'Write it down' }).click();
  await expect(page.locator('.ledger-days')).toContainText('every month');
  await expect(figure(page, 'went out')).toHaveText(/99,90/);

  await page.getByRole('button', { name: 'categories' }).click();
  const row = page.locator('.recurring-row', { hasText: 'Internet' });
  await expect(row).toContainText('next');
  await row.getByRole('button', { name: 'pause' }).click();
  await expect(row).toContainText('paused');
});

test("the demo opens Marina's six months", async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: "Open Marina's notebook" }).click();
  await expect(page.getByText("Marina's expenses")).toBeVisible();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.story')).toContainText('you spent');
  await expect(page.locator('.six-bars button')).toHaveCount(6);
  await page.getByRole('button', { name: 'log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});

test('a search can look in every month', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: "Open Marina's notebook" }).click();
  await page.getByLabel('Search entries').fill('rent');
  const scope = page.locator('.ledger-tools .scope');
  await expect(scope).toHaveText(/^only /);
  await expect(page.locator('.day-month')).toHaveCount(0);
  await scope.click();
  await expect(scope).toHaveText('every month');
  // one rent a month, and each day says which month it's in
  await expect.poll(() => page.locator('.day-month').count()).toBeGreaterThan(4);
});

test('the year on one page, and a month opens from it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: "Open Marina's notebook" }).click();
  await page.getByRole('button', { name: 'year', exact: true }).click();
  await expect(page.locator('.year .story')).toContainText('came in');
  await expect(page.locator('.twelve button')).toHaveCount(12);
  await expect(page.locator('.year-cat-list li').first()).toContainText('Housing');
  // the first month with something in it opens on the month page
  const first = page.locator('.twelve button:not(:disabled)').first();
  const name = (await first.getAttribute('aria-label')).split(':')[0];
  await first.click();
  await expect(page.locator('.month-nav h1')).toContainText(name);
  await expect(page.locator('.ledger')).toBeVisible();
});
