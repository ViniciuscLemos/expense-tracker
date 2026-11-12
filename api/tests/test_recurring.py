from datetime import date

from app.months import shift, today
from app.recurring import after, on_day, post_due

from .conftest import add, category


def months_ago(n: int, day: int) -> date:
    return on_day(shift(today().replace(day=1), -n), day)


def entries(client, **params):
    return client.get("/api/entries", params=params).json()["entries"]


def test_the_day_falls_back_in_shorter_months():
    assert on_day(date(2026, 2, 1), 31) == date(2026, 2, 28)
    assert on_day(date(2028, 2, 1), 30) == date(2028, 2, 29)
    assert after(date(2026, 1, 31), 31) == date(2026, 2, 28)
    # and goes back to the 31st when the month has one
    assert after(date(2026, 2, 28), 31) == date(2026, 3, 31)


def test_writes_down_the_months_nobody_opened_the_app(ana):
    rent = ana.post("/api/recurring", json={
        "kind": "expense", "category_id": category(ana, "Housing")["id"], "amount_cents": 150000,
        "description": "Rent", "first_day": months_ago(3, 5).isoformat()}).json()
    written = [e for e in entries(ana) if e["recurring_id"] == rent["id"]]
    # three months ago, two, one, and this month if the 5th has already come
    assert len(written) == (4 if today().day >= 5 else 3)
    assert all(e["description"] == "Rent" and e["amount_cents"] == 150000 for e in written)
    assert date.fromisoformat(rent["next_day"]) > today()


def test_asking_twice_writes_once(app, ana):
    ana.post("/api/recurring", json={
        "kind": "income", "category_id": category(ana, "Salary", "income")["id"], "amount_cents": 420000,
        "description": "Salary", "first_day": months_ago(1, 1).isoformat()})
    before = len(entries(ana))
    with app.state.pool.connection() as conn:
        assert post_due(conn, 1) == 0
    ana.get("/api/dashboard", params={"month": today().strftime("%Y-%m")})
    assert len(entries(ana)) == before


def test_a_deleted_one_doesnt_come_back_and_changes_only_touch_what_comes(ana):
    internet = ana.post("/api/recurring", json={
        "kind": "expense", "category_id": category(ana, "Housing")["id"], "amount_cents": 9990,
        "description": "Internet", "first_day": months_ago(1, 1).isoformat()}).json()
    first = next(e for e in entries(ana) if e["day"] == months_ago(1, 1).isoformat())
    ana.delete(f"/api/entries/{first['id']}")
    assert all(e["day"] != first["day"] for e in entries(ana))

    ana.patch(f"/api/recurring/{internet['id']}", json={"amount_cents": 11990})
    assert all(e["amount_cents"] == 9990 for e in entries(ana) if e["recurring_id"] == internet["id"])


def test_paused_ones_dont_catch_up_when_turned_back_on(app, ana):
    gym = ana.post("/api/recurring", json={
        "kind": "expense", "category_id": category(ana, "Health")["id"], "amount_cents": 11990,
        "description": "Gym", "first_day": shift(today().replace(day=1), 1).isoformat()}).json()
    ana.patch(f"/api/recurring/{gym['id']}", json={"active": False})
    # pretend it was paused for months
    with app.state.pool.connection() as conn:
        conn.execute("UPDATE recurring SET next_day = %s WHERE id = %s", (months_ago(4, 1), gym["id"]))
    back = ana.patch(f"/api/recurring/{gym['id']}", json={"active": True}).json()
    assert date.fromisoformat(back["next_day"]) >= today()
    assert not [e for e in entries(ana) if e["recurring_id"] == gym["id"]]


def test_stopping_keeps_what_was_written(ana):
    rent = ana.post("/api/recurring", json={
        "kind": "expense", "category_id": category(ana, "Housing")["id"], "amount_cents": 150000,
        "description": "Rent", "first_day": months_ago(2, 1).isoformat()}).json()
    count = len(entries(ana))
    assert ana.delete(f"/api/recurring/{rent['id']}").status_code == 204
    left = entries(ana)
    assert len(left) == count and all(e["recurring_id"] is None for e in left)
    assert ana.get("/api/recurring").json() == []


def test_the_category_rules_apply_here_too(ana):
    body = {"kind": "expense", "category_id": category(ana, "Salary", "income")["id"], "amount_cents": 100,
            "description": "x", "first_day": today().isoformat()}
    assert ana.post("/api/recurring", json=body).status_code == 422


def test_a_bill_written_by_hand_every_month_is_suggested(ana):
    first = today().replace(day=1)
    for n, cents in [(3, 5590), (2, 5590), (1, 5990)]:
        month = shift(first, -n)
        add(ana, f"Netflix.com {month.month:02d}/26", cents, month.replace(day=8).isoformat(), cat="Fun")
    # twice isn't a pattern, and an amount all over the place isn't a bill
    for n in (2, 1):
        add(ana, "Pharmacy", 2000, shift(first, -n).replace(day=3).isoformat(), cat="Health")
    for n, cents in [(3, 10000), (2, 40000), (1, 9000)]:
        add(ana, "Market", cents, shift(first, -n).replace(day=5).isoformat())

    found = ana.get("/api/recurring/suggestions").json()
    assert [s["description"] for s in found] == ["Netflix.com"]
    netflix = found[0]
    assert netflix["months"] == 3 and netflix["day_of_month"] == 8 and netflix["amount_cents"] == 5990
    assert netflix["first_day"] == first.replace(day=8).isoformat()

    # said no to: it doesn't come back
    assert ana.post("/api/recurring/suggestions/dismiss", json={"key": netflix["key"]}).status_code == 204
    assert ana.get("/api/recurring/suggestions").json() == []


def test_a_bill_already_recurring_is_not_suggested(ana):
    first = today().replace(day=1)
    for n in (3, 2, 1):
        add(ana, "Gym", 9900, shift(first, -n).replace(day=10).isoformat(), cat="Health")
    assert len(ana.get("/api/recurring/suggestions").json()) == 1
    ana.post("/api/recurring", json={"kind": "expense", "category_id": category(ana, "Health")["id"],
                                     "amount_cents": 9900, "description": "GYM", "first_day": first.replace(day=10).isoformat()})
    assert ana.get("/api/recurring/suggestions").json() == []
