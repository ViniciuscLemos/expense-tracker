from .conftest import category, client_for, sign_up


def split(client, text, cents, day, name):
    response = client.post("/api/entries", json={"kind": "expense", "category_id": category(client, "Food")["id"],
                                                "amount_cents": cents, "description": text, "day": day, "split_with": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_what_is_owed_adds_up_both_ways(ana):
    dinner = split(ana, "Dinner", 12001, "2026-10-03", "Bia")
    assert dinner["split_with"] == "Bia"
    split(ana, "Market", 30000, "2026-10-10", "bia ")
    # the whole amount still counts in the month: it left this pocket
    assert ana.get("/api/dashboard?month=2026-10").json()["expenses"] == 42001

    # Bia paid the gas bill for both, then paid 100 back
    ana.post("/api/shared/moves", json={"with_name": "Bia", "kind": "they_paid", "amount_cents": 9001,
                                        "description": "Gas", "day": "2026-10-12"})
    moved = ana.post("/api/shared/moves", json={"with_name": "BIA", "kind": "they_paid_back", "amount_cents": 10000,
                                                "day": "2026-10-20"})
    assert moved.status_code == 201
    (bia,) = moved.json()["people"]
    # 6000 + 15000 - 4500 - 10000
    assert bia["owes_you_cents"] == 6500
    assert bia["name"] == "Bia"
    assert [l["description"] for l in bia["lines"]] == ["paid back", "Gas", "Market", "Dinner"]
    assert bia["lines"][1]["effect_cents"] == -4500

    # settling up with what's left brings it to zero
    ana.post("/api/shared/moves", json={"with_name": "Bia", "kind": "they_paid_back", "amount_cents": 6500, "day": "2026-10-25"})
    assert ana.get("/api/shared").json()["people"][0]["owes_you_cents"] == 0


def test_a_split_can_come_off_and_only_expenses_split(ana):
    taxi = split(ana, "Taxi", 5000, "2026-10-03", "Caio")
    salary = category(ana, "Salary", "income")["id"]
    income = {"kind": "income", "category_id": salary, "amount_cents": 100, "description": "x", "day": "2026-10-01", "split_with": "Caio"}
    assert ana.post("/api/entries", json=income).status_code == 422
    off = ana.patch(f"/api/entries/{taxi['id']}", json={"split_with": ""})
    assert off.status_code == 200 and off.json()["split_with"] is None
    assert ana.get("/api/shared").json()["people"] == []


def test_people_dont_see_each_others_shares(app, ana):
    rui = client_for(app)
    sign_up(rui, email="rui@example.com", name="Rui")
    split(ana, "Dinner", 8000, "2026-10-03", "Bia")
    move = ana.post("/api/shared/moves", json={"with_name": "Bia", "kind": "i_paid_back", "amount_cents": 1000, "day": "2026-10-04"}).json()
    assert rui.get("/api/shared").json()["people"] == []
    assert rui.delete(f"/api/shared/moves/{move['id']}").status_code == 404
    assert ana.delete(f"/api/shared/moves/{move['id']}").status_code == 204
    assert ana.get("/api/shared").json()["people"][0]["owes_you_cents"] == 4000
