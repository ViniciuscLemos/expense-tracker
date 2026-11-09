# Expense Tracker

![Tests](https://github.com/ViniciuscLemos/expense-tracker/actions/workflows/deploy.yml/badge.svg)

Write down what you spend and what comes in, and at the end of the month read how it went, in plain words: what you kept, which budget slipped, which days cost the most.

React on the page, a Python API (FastAPI) and Postgres behind it.

**Try it:** [expense-tracker-qm7l.onrender.com](https://expense-tracker-qm7l.onrender.com). The *Open Marina's notebook* button logs in as a made-up person with six months written down. It's a free instance, so the first visit after a while takes up to a minute.

![October in the demo account: the month told in a few sentences, the entries by day, the budgets, a calendar of the month](docs/screenshot.png)

It started as a React app that saved everything in the browser. That's fine until you want the same numbers on the phone and on the computer, so now there are accounts and a server, and the page was redone from scratch on top of them.

## The page

I wanted it to feel like the notebook people actually use for this, not like a dashboard. So there's cream paper, a blue pen, ruled lines and a red margin. The figures are in a mono font so the columns line up.

- **The month in sentences.** Instead of three boxes with numbers at the top, it says something like *"In October you spent R$ 4.092, about R$ 132 a day. That's R$ 530 more than September. Of the R$ 5.000 that came in, R$ 908 was kept. 3 budgets went over, Shopping by the most."* A month that's still going isn't compared with a whole one, because on the 5th it would always look cheaper.
- **Writing an entry is one line.** You pick *spent* or *got*, then type what, how much, the category and the day. The amount can be typed the Brazilian way (`1.234,56`) or the other way (`1,234.56`).
- **Every month, written once.** Rent, salary, the internet bill: tick *every month* when writing it and it gets written down on its own on that day, catching up on months nobody opened the app. A 31st lands on the last day of shorter months. Pausing or stopping keeps what was already there, and deleting one of the generated entries doesn't bring it back.
- **The entries are grouped by day,** with what went out and came in on each day. You can edit an entry in place. Deleting crosses it out with an "undo" for a few seconds, instead of asking "are you sure?" first.
- **Budgets per category.** In the month that's still going there's a small mark on each bar for where the spending should be by today. 60% of the food budget gone on the 10th looks wrong, and on the 25th it doesn't.
- **A calendar of the month,** each day darker the more went out. Clicking a day jumps to it in the list. The darkest shade goes to the second biggest day, otherwise rent day would make every other day look empty.
- **The biggest ones.** The three largest expenses of the month in the margin, and how much of everything that went out they were together. Usually it's rent and two surprises. Clicking one jumps to its day.
- **The last six months,** and clicking one opens it.
- You can filter by kind and category, search, and export the month to CSV, which opens straight in Excel.
- **A search can look in every month,** not only the one open: "when did I last pay the dentist?" With that on, each day in the list also says which month it's from. A search that finds nothing in this month offers to look in the others.
- Categories can be renamed, recolored, archived or deleted. A category that still has entries has to move them to another one before it can go.
- If you used the first version, its backup file can be brought in from the categories page. Bringing the same file twice doesn't repeat anything.
- There's a dark mode, it works on the phone, and it can be installed as an app.

<p>
  <img src="docs/search-every-month.png" alt="Searching 'rent' in every month: the rent of November, October, September and August, each day with its month" width="520">
  <img src="docs/biggest.png" alt="The biggest ones: rent, groceries and electricity, together 86% of what went out" width="300">
</p>

<p>
  <img src="docs/screenshot-mobile.png" alt="The same month on the phone" width="260">
  <img src="docs/screenshot-dark.png" alt="The month in dark mode" width="560">
</p>

## The API

It lives in `api/`, written in FastAPI with psycopg, and the SQL is written by hand.

- Accounts are email and password, hashed with bcrypt. The session cookie is HttpOnly and SameSite=Strict, and only a hash of its token is stored. After 5 wrong passwords in 15 minutes, that email has to wait a while.
- Anything that changes data needs an `X-Requested-With` header. A form on another site can't send it, and there's no CORS, so that covers CSRF.
- The database itself refuses an entry in a category that belongs to another person or is of the other kind. That's a composite foreign key, `(category_id, user_id, kind)`, so it doesn't depend on the Python code remembering to check.
- The list comes 50 entries at a time and pages by `(day, id)` instead of `OFFSET`. Page 40 is as fast as page 1, and nothing gets skipped when entries are added in between.
- `GET /api/dashboard?month=2026-10` brings everything the page needs in one request:
  - the totals, and last month's;
  - each category against its budget;
  - every day of the month (with `generate_series`, so the days with nothing are there too);
  - the last six months;
  - the three biggest expenses.
- Each request uses one connection and one transaction, and the commit happens *before* the answer goes out. Without that, the browser could ask "who am I?" with the new session cookie before the session was saved. The end-to-end tests caught this one.
- Recurring entries keep the *next date* to write, instead of checking "is there one this month?". That's what lets a deleted one stay deleted. The page asks for the list and the month at the same time, so the rows are read with `FOR UPDATE`, and the second request waits and finds nothing left to write.
- The interactive docs are at `/api/docs`.

## Tests

- **API:** 27 tests in pytest, run against a real Postgres.
- **Page:** unit tests in vitest for the money parsing, the calendar and the sentences.
- **End to end:** Playwright clicks through the built page with the real API and database behind it, on a desktop and on a phone size. Then axe checks accessibility, in light and dark mode.
- CI runs all of it, with Postgres in a service container.

## Running

You need Postgres running somewhere.

```bash
git clone https://github.com/ViniciuscLemos/expense-tracker
cd expense-tracker
npm install
pip install -r api/requirements-dev.txt

# the API on :8000 (DEMO=true adds the made-up Marina with six months of entries)
DATABASE_URL=postgresql://postgres@localhost:5432/expenses DEMO=true \
  python -m uvicorn --factory app.main:create_app --app-dir api --port 8000

# the page with hot reload on :5173, passing /api on to :8000
npm run dev
```

Tests:

```bash
npm test                                                  # page, unit
TEST_DATABASE_URL=postgresql://... pytest api             # API
npm run build && E2E_DATABASE_URL=postgresql://... npm run e2e   # end to end
```

## Putting it online

It runs on Render's free plan as one Docker service (`Dockerfile` + `render.yaml`): Node builds the page, then a small Python image serves the page and the API from the same address. The database is a free [Neon](https://neon.tech) Postgres. It shares the Neon project of my [link shortener](https://github.com/ViniciuscLemos/url-shortener): the blueprint borrows that service's `DATABASE_URL` and `DATABASE_NAME=expenses` swaps the database, so the password is never copied by hand. On its own, paste a connection string in `DATABASE_URL` instead.

The free instance sleeps after 15 minutes without visits, so the first visit after that takes a while.

## Some decisions

- Money is stored in cents (integers), in the database and in JavaScript. With floats you get things like `0.1 + 0.2 = 0.30000000000000004`.
- The page and the API share one address, so the cookie can be strict and nothing needs CORS.
- The service worker keeps the page itself for offline opening, but never the API's answers: they're someone's money, and they'd stay in the cache after logging out.

## Structure

```
api/
  app/main.py         the app: routers, the CSRF check, serving the built page
  app/auth.py         sign up, log in, sessions, the wrong password limit
  app/entries.py      entries: list with filters and paging, add, edit, delete, import
  app/categories.py   categories and budgets
  app/dashboard.py    the month in one request
  app/demo.py         Marina, the demo account
  migrations/         the SQL
  tests/
src/
  App.jsx             who's logged in, and which page
  components/         Login, Month, EntryLine, Ledger, Budgets, Calendar, SixMonths, Categories
  lib/finance.js      money, months, the calendar
  lib/story.js        the month in sentences
e2e/                  Playwright
```
