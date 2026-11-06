from .conftest import add, category


def test_add_edit_delete(ana):
    entry = add(ana, "  Groceries ", 21460, "2026-10-08")
    assert entry["description"] == "Groceries"

    changed = ana.patch(f"/api/entries/{entry['id']}", json={"amount_cents": 19990, "day": "2026-10-09"})
    assert changed.status_code == 200
    assert changed.json()["amount_cents"] == 19990
    assert changed.json()["day"] == "2026-10-09"

    assert ana.delete(f"/api/entries/{entry['id']}").status_code == 204
    assert ana.get("/api/entries").json()["entries"] == []


def test_amounts_are_whole_positive_cents(ana):
    food = category(ana, "Food")["id"]
    for bad in (0, -100, 12.5, "10"):
        body = {"kind": "expense", "category_id": food, "amount_cents": bad, "description": "x", "day": "2026-10-01"}
        assert ana.post("/api/entries", json=body).status_code == 422, bad


def test_the_category_has_to_match_the_kind(ana):
    salary = category(ana, "Salary", "income")["id"]
    body = {"kind": "expense", "category_id": salary, "amount_cents": 100, "description": "x", "day": "2026-10-01"}
    response = ana.post("/api/entries", json=body)
    assert response.status_code == 422
    assert "incomes" in response.json()["detail"]

    # turning an expense into income without moving it to an income category is refused too
    entry = add(ana, "Refund", 5000, "2026-10-03")
    assert ana.patch(f"/api/entries/{entry['id']}", json={"kind": "income"}).status_code == 422
    ok = ana.patch(f"/api/entries/{entry['id']}", json={"kind": "income", "category_id": salary})
    assert ok.status_code == 200


def test_filters_by_month_kind_category_and_text(ana):
    add(ana, "Rent", 150000, "2026-09-02", cat="Housing")
    add(ana, "Rent", 150000, "2026-10-02", cat="Housing")
    add(ana, "Pizza 100%", 8900, "2026-10-10")
    add(ana, "Salary", 420000, "2026-10-01", cat="Salary", kind="income")

    def descriptions(**params):
        return [e["description"] for e in ana.get("/api/entries", params=params).json()["entries"]]

    assert descriptions(month="2026-10") == ["Pizza 100%", "Rent", "Salary"]
    assert descriptions(month="2026-10", kind="income") == ["Salary"]
    assert descriptions(category_id=category(ana, "Housing")["id"]) == ["Rent", "Rent"]
    assert descriptions(q="rent", month="2026-09") == ["Rent"]
    # the search also finds by category name, and % is a plain character, not a wildcard
    assert descriptions(q="housing") == ["Rent", "Rent"]
    assert descriptions(q="%") == ["Pizza 100%"]


def test_pages_come_in_order_without_repeating(app, ana):
    food = category(ana, "Food")["id"]
    with app.state.pool.connection() as conn:
        conn.cursor().executemany(
            "INSERT INTO entries (user_id, kind, category_id, amount_cents, description, day) "
            "VALUES (1, 'expense', %s, 100, %s, %s)",
            [(food, f"coffee {i}", f"2026-10-{1 + i % 28:02d}") for i in range(120)])
    seen, after = [], None
    while True:
        page = ana.get("/api/entries", params={"after": after} if after else {}).json()
        seen += page["entries"]
        after = page["next"]
        if not after:
            break
    assert len(seen) == 120
    assert len({e["id"] for e in seen}) == 120
    assert [e["day"] for e in seen] == sorted((e["day"] for e in seen), reverse=True)


def test_categories_with_entries_move_them_before_going(ana):
    add(ana, "Bus", 440, "2026-10-04", cat="Transport")
    transport, other = category(ana, "Transport")["id"], category(ana, "Other")["id"]

    blocked = ana.delete(f"/api/categories/{transport}")
    assert blocked.status_code == 409
    assert "1 entry uses" in blocked.json()["detail"]

    # an income category isn't a place for an expense
    salary = category(ana, "Salary", "income")["id"]
    assert ana.delete(f"/api/categories/{transport}", params={"move_to": salary}).status_code == 422

    assert ana.delete(f"/api/categories/{transport}", params={"move_to": other}).status_code == 204
    assert ana.get("/api/entries").json()["entries"][0]["category_id"] == other


def test_archived_categories_take_no_new_entries(ana):
    fun = category(ana, "Fun")["id"]
    assert ana.patch(f"/api/categories/{fun}", json={"archived": True}).json()["archived"] is True
    body = {"kind": "expense", "category_id": fun, "amount_cents": 100, "description": "x", "day": "2026-10-01"}
    assert ana.post("/api/entries", json=body).status_code == 422


def test_category_names_are_unique_and_budgets_only_for_expenses(ana):
    assert ana.post("/api/categories", json={"kind": "expense", "name": "food", "color": "#112233"}).status_code == 409
    assert ana.post("/api/categories", json={"kind": "income", "name": "Gifts", "color": "#112233",
                                             "budget_cents": 1000}).status_code == 422
    pets = ana.post("/api/categories", json={"kind": "expense", "name": "Pets", "color": "#112233", "budget_cents": 20000})
    assert pets.status_code == 201
    cleared = ana.patch(f"/api/categories/{pets.json()['id']}", json={"budget_cents": None})
    assert cleared.json()["budget_cents"] is None


def test_importing_the_browser_backup_twice_adds_once(ana):
    backup = {"entries": [
        {"id": "a1", "type": "expense", "description": "Groceries", "category": "Food", "amount": 21460, "date": "2026-10-08"},
        {"id": "a2", "type": "expense", "description": "Vet", "category": "Pets", "amount": 15000, "date": "2026-10-09"},
        {"id": "a3", "type": "income", "description": "Salary", "category": "salary", "amount": 420000, "date": "2026-10-01"},
    ]}
    assert ana.post("/api/entries/import", json=backup).json() == {"imported": 3, "already_here": 0}
    assert ana.post("/api/entries/import", json=backup).json() == {"imported": 0, "already_here": 3}
    # "Pets" didn't exist and was made, "salary" went into the existing "Salary"
    assert category(ana, "Pets")
    assert len([c for c in ana.get("/api/categories").json() if c["name"].lower() == "salary"]) == 1
