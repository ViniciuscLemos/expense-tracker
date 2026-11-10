from app import demo

from .conftest import add, category, client_for


def test_the_month_in_one_request(ana):
    food = category(ana, "Food")["id"]
    ana.patch(f"/api/categories/{food}", json={"budget_cents": 50000})
    add(ana, "Salary", 400000, "2026-10-01", cat="Salary", kind="income")
    add(ana, "Rent", 150000, "2026-10-02", cat="Housing")
    add(ana, "Groceries", 30000, "2026-10-08")
    add(ana, "Pizza", 9000, "2026-10-31")
    add(ana, "Groceries", 20000, "2026-09-15")

    d = ana.get("/api/dashboard", params={"month": "2026-10"}).json()
    assert (d["income"], d["expenses"], d["balance"]) == (400000, 189000, 211000)
    assert d["previous"]["expenses"] == 20000
    # a month that's over divides by all its days
    assert d["per_day"] == 189000 // 31

    housing, food_row = d["categories"][0], d["categories"][1]
    assert (housing["name"], housing["spent"]) == ("Housing", 150000)
    assert (food_row["spent"], food_row["budget_cents"]) == (39000, 50000)

    assert len(d["days"]) == 31
    assert d["days"][-1] == {"day": "2026-10-31", "spent": 9000, "earned": 0}
    assert [m["month"] for m in d["months"]] == ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    assert d["months"][-2]["expenses"] == 20000
    assert [b["description"] for b in d["biggest"]] == ["Rent", "Groceries", "Pizza"]


def test_categories_with_a_budget_show_up_even_with_nothing_spent(ana):
    fun = category(ana, "Fun")["id"]
    ana.patch(f"/api/categories/{fun}", json={"budget_cents": 20000})
    d = ana.get("/api/dashboard", params={"month": "2026-10"}).json()
    assert [(c["name"], c["spent"]) for c in d["categories"]] == [("Fun", 0)]


def test_the_demo_account_has_six_months_and_comes_back_whole(app):
    def visit():
        visitor = client_for(app)
        assert visitor.post("/api/login", json={"email": demo.EMAIL, "password": demo.PASSWORD}).status_code == 200
        return visitor

    def count(client):
        total, after = 0, None
        while True:
            page = client.get("/api/entries", params={"after": after} if after else {}).json()
            total += len(page["entries"])
            if not (after := page["next"]):
                return total

    demo.reset(app.state.pool)
    visitor = visit()
    whole = count(visitor)
    newest = visitor.get("/api/entries").json()["entries"][0]
    visitor.delete(f"/api/entries/{newest['id']}")
    assert count(visitor) == whole - 1

    demo.reset(app.state.pool)
    again = visit()
    assert count(again) == whole
    months = again.get("/api/dashboard", params={"month": newest["day"][:7]}).json()["months"]
    assert len(months) == 6 and all(m["expenses"] > 0 for m in months)


def test_the_year_on_one_page(ana):
    add(ana, "Salary", 400000, "2026-01-05", cat="Salary", kind="income")
    add(ana, "Salary", 400000, "2026-02-05", cat="Salary", kind="income")
    add(ana, "Rent", 150000, "2026-01-02", cat="Housing")
    add(ana, "Rent", 150000, "2026-02-02", cat="Housing")
    add(ana, "Groceries", 30000, "2026-02-08")
    add(ana, "Last year", 99900, "2025-12-31")

    y = ana.get("/api/year/2026").json()
    assert (y["income"], y["expenses"], y["balance"]) == (800000, 330000, 470000)
    # 470000 of 800000 kept
    assert y["kept_percent"] == 59
    # all twelve months, the empty ones as zeros
    assert [m["month"] for m in y["months"]][:3] == ["2026-01", "2026-02", "2026-03"]
    assert len(y["months"]) == 12 and y["months"][5] == {"month": "2026-06", "income": 0, "expenses": 0}
    assert y["months_used"] == 2
    assert (y["priciest"], y["cheapest"]) == ("2026-02", "2026-01")
    housing = y["categories"][0]
    assert (housing["name"], housing["spent"], housing["entries"], housing["months"]) == ("Housing", 300000, 2, 2)


def test_an_empty_year_and_only_your_own(ana, app):
    y = ana.get("/api/year/2019").json()
    assert (y["income"], y["kept_percent"], y["priciest"], y["months_used"]) == (0, None, None, 0)
    assert ana.get("/api/year/1999").status_code == 422
