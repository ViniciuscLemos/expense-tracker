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

test('a goal: start it, put money in, take some out', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'goals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible();
  await page.getByLabel('For').fill('Bike');
  await page.getByLabel('How much, R$').fill('1.200,00');
  await page.getByRole('button', { name: 'Start it' }).click();

  const goal = page.locator('.goal', { hasText: 'Bike' });
  await expect(goal.locator('.goal-line')).toContainText('Nothing in it yet');
  await goal.getByLabel('Amount for Bike').fill('300');
  await goal.getByRole('button', { name: 'Put in' }).click();
  await expect(goal.locator('.goal-figures')).toContainText('R$ 300,00');
  await expect(goal.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');

  // more than is in it is refused
  await goal.getByLabel('Amount for Bike').fill('500');
  await goal.getByRole('button', { name: 'take out' }).click();
  await expect(goal.getByRole('alert')).toContainText("isn't that much");
  await goal.getByLabel('Amount for Bike').fill('100');
  await goal.getByRole('button', { name: 'take out' }).click();
  await expect(goal.locator('.goal-figures')).toContainText('R$ 200,00');

  await goal.getByRole('button', { name: 'delete' }).click();
  await goal.getByRole('button', { name: 'yes, delete' }).click();
  await expect(page.locator('.goal')).toHaveCount(0);
});

test('a bank statement comes in once, with categories guessed', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'categories', exact: true }).click();
  const csv = [
    'date,title,amount',
    `${new Date().toISOString().slice(0, 10)},Uber *Trip,23.45`,
    `${new Date().toISOString().slice(0, 10)},iFood *Pizza,61.90`,
    `${new Date().toISOString().slice(0, 10)},Pagamento recebido,-500.00`,
  ].join('\n');
  const file = { name: 'nubank.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };
  const section = page.locator('section.import', { hasText: 'From your bank' });

  await section.locator('input[type=file]').setInputFiles(file);
  await expect(section.locator('.bank-preview')).toContainText('2 expenses');
  await expect(section.locator('.bank-preview')).toContainText('1 line left out');
  await expect(section.locator('.bank-preview')).toContainText('Transport (1)');
  await section.getByRole('button', { name: 'Bring them in' }).click();
  await expect(section.getByRole('status')).toContainText('2 entries brought in');

  // the same file again brings nothing new
  await section.locator('input[type=file]').setInputFiles(file);
  await section.getByRole('button', { name: 'Bring them in' }).click();
  await expect(section.getByRole('status')).toContainText('already here');

  await page.getByRole('button', { name: 'month', exact: true }).click();
  await expect(page.locator('.ledger')).toContainText('iFood *Pizza');
});

test("last month's leftover can go into a goal", async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: "Open Marina's notebook" }).click();
  await page.getByRole('button', { name: 'goals', exact: true }).click();
  const leftover = page.locator('form.leftover');
  await expect(leftover).toContainText('ended');
  await leftover.getByLabel('Amount to put aside').fill('100');
  await leftover.getByLabel('Into which goal').selectOption({ label: 'Trip to Chile' });
  const before = await page.locator('.goal', { hasText: 'Trip to Chile' }).locator('.goal-figures').innerText();
  await leftover.getByRole('button', { name: 'Put it in' }).click();
  await expect(page.locator('.goal', { hasText: 'Trip to Chile' }).locator('.goal-figures')).not.toHaveText(before);
  await expect(leftover).toContainText('already went into goals');
});

test('a bill written by hand every month is offered to become automatic', async ({ page }) => {
  await signUp(page);
  const headers = { 'X-Requested-With': 'fetch' };
  const fun = (await (await page.request.get('./api/categories')).json()).find((c) => c.name === 'Fun' && c.kind === 'expense');
  const now = new Date();
  for (const back of [3, 2, 1]) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 8);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-08`;
    await page.request.post('./api/entries', { headers, data: { kind: 'expense', category_id: fun.id, amount_cents: 5590, description: `Spotify ${back}`, day } });
  }
  await page.getByRole('button', { name: 'categories', exact: true }).click();
  const found = page.locator('.found');
  await expect(found).toContainText('Spotify');
  await expect(found).toContainText('in 3 of the last 6 months');
  await found.getByRole('button', { name: 'make it automatic' }).click();
  await expect(page.locator('.found')).toHaveCount(0);
  await expect(page.locator('.recurring ul').first()).toContainText('Spotify');
});
