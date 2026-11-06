"""The public demo account. On every start its entries are made again around today's date,
so whoever logs in sees a full month, and whatever the last visitor deleted is back."""

from datetime import date

from .auth import create_user
from .months import shift, today

EMAIL = "demo@expenses.test"
PASSWORD = "just-looking"
NAME = "Marina"

# day of the month, kind, description, category, cents
MONTH = [
    (1, "income", "Salary", "Salary", 420000),
    (2, "expense", "Rent", "Housing", 145000),
    (3, "expense", "Groceries at Pão de Açúcar", "Food", 38740),
    (4, "expense", "Monthly bus pass", "Transport", 8800),
    (5, "expense", "Electricity", "Housing", 14320),
    (6, "expense", "Lunch with Bia", "Food", 6890),
    (8, "expense", "Cinema", "Fun", 6400),
    (9, "expense", "Internet", "Housing", 9990),
    (10, "income", "Logo for the bakery", "Freelance", 80000),
    (11, "expense", "Pharmacy", "Health", 5290),
    (12, "expense", "iFood on a rainy night", "Food", 6150),
    (13, "expense", "Spanish course", "Education", 18900),
    (15, "expense", "Uber home", "Transport", 2340),
    (16, "expense", "Running shoes", "Shopping", 34990),
    (18, "expense", "Groceries", "Food", 21460),
    (19, "expense", "Gym", "Health", 11990),
    (21, "expense", "Show at Audio", "Fun", 18000),
    (23, "expense", "Market on the corner", "Food", 4870),
    (25, "expense", "Birthday present for mom", "Shopping", 15900),
    (27, "expense", "Pizza on Friday", "Food", 8900),
]
# the months before get the same entries a bit cheaper or pricier, so the six months differ
FACTORS = [1.08, 0.94, 1.15, 0.9, 1.02]
BUDGETS = {"Food": 90000, "Fun": 25000, "Shopping": 40000, "Transport": 15000}


def last_day(first: date) -> int:
    return (shift(first, 1) - first).days


def reset(pool):
    with pool.connection() as conn:
        conn.execute("DELETE FROM users WHERE lower(email) = %s", (EMAIL,))
        user_id = create_user(conn, NAME, EMAIL, PASSWORD)
        cats = {(r["kind"], r["name"]): r["id"] for r in
                conn.execute("SELECT id, kind, name FROM categories WHERE user_id = %s", (user_id,))}
        for name, cents in BUDGETS.items():
            conn.execute("UPDATE categories SET budget_cents = %s WHERE id = %s", (cents, cats[("expense", name)]))

        now = today()
        this_month = date(now.year, now.month, 1)
        rows = []
        for back, factor in enumerate([1.0, *FACTORS]):
            first = shift(this_month, -back)
            for day, kind, text, category, cents in MONTH:
                if back == 0 and day > now.day:
                    continue  # nothing in the future
                amount = cents if kind == "income" else round(cents * factor / 10) * 10
                rows.append((user_id, kind, cats[(kind, category)], amount, text,
                             date(first.year, first.month, min(day, last_day(first)))))
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO entries (user_id, kind, category_id, amount_cents, description, day) "
                            "VALUES (%s, %s, %s, %s, %s, %s)", rows)
