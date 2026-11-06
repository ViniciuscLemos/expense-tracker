from datetime import date

from app.months import shift, today
from app.recurring import after, on_day, post_due

from .conftest import category


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
