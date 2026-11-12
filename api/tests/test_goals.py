from app.months import shift, today

from .conftest import client_for, sign_up


def month(n: int) -> str:
    """The month n months from now, like 2027-03."""
    return shift(today().replace(day=1), n).strftime("%Y-%m")


def test_a_goal_with_a_date_says_how_much_a_month(ana):
    goal = ana.post("/api/goals", json={"name": " Trip to Chile ", "target_cents": 600000, "by_month": month(5)}).json()
    assert goal["name"] == "Trip to Chile"
    # this month and the five after it: six months, R$ 1.000 each
    assert goal["months_left"] == 6
    assert goal["per_month_cents"] == 100000
    assert goal["saved_cents"] == 0 and not goal["reached"]

    goal = ana.post(f"/api/goals/{goal['id']}/moves", json={"amount_cents": 150000}).json()
    assert goal["saved_cents"] == 150000
    assert goal["left_cents"] == 450000
    assert goal["per_month_cents"] == 75000


def test_the_monthly_amount_rounds_up(ana):
    goal = ana.post("/api/goals", json={"name": "Laptop", "target_cents": 100000, "by_month": month(2)}).json()
    # R$ 1.000 over three months: R$ 333,34, never one cent short
    assert goal["per_month_cents"] == 33334


def test_without_a_date_there_is_no_monthly_amount(ana):
    goal = ana.post("/api/goals", json={"name": "Cushion", "target_cents": 1000000}).json()
    assert goal["by_month"] is None and goal["per_month_cents"] is None


def test_taking_out_and_reaching_it(ana):
    gid = ana.post("/api/goals", json={"name": "Bike", "target_cents": 50000}).json()["id"]
    ana.post(f"/api/goals/{gid}/moves", json={"amount_cents": 30000})
    assert ana.post(f"/api/goals/{gid}/moves", json={"amount_cents": -40000}).status_code == 422
    assert ana.post(f"/api/goals/{gid}/moves", json={"amount_cents": 0}).status_code == 422
    ana.post(f"/api/goals/{gid}/moves", json={"amount_cents": -10000})
    goal = ana.post(f"/api/goals/{gid}/moves", json={"amount_cents": 30000}).json()
    assert goal["saved_cents"] == 50000 and goal["reached"] and goal["left_cents"] == 0

    moves = ana.get(f"/api/goals/{gid}/moves").json()
    assert [m["amount_cents"] for m in moves] == [30000, -10000, 30000]


def test_a_month_already_over_is_refused(ana):
    assert ana.post("/api/goals", json={"name": "Old", "target_cents": 100, "by_month": month(-1)}).status_code == 422
    assert ana.post("/api/goals", json={"name": "Odd", "target_cents": 100, "by_month": "2027-13"}).status_code == 422
    assert ana.post("/api/goals", json={"name": "   ", "target_cents": 100}).status_code == 422


def test_changing_and_deleting(ana):
    gid = ana.post("/api/goals", json={"name": "Car", "target_cents": 100000}).json()["id"]
    ana.post(f"/api/goals/{gid}/moves", json={"amount_cents": 1000})
    goal = ana.patch(f"/api/goals/{gid}", json={"target_cents": 2000000, "by_month": month(9)}).json()
    assert goal["target_cents"] == 2000000 and goal["months_left"] == 10
    goal = ana.patch(f"/api/goals/{gid}", json={"by_month": None}).json()
    assert goal["by_month"] is None

    assert ana.delete(f"/api/goals/{gid}").status_code == 204
    assert ana.get("/api/goals").json() == []


def test_someone_elses_goal_is_out_of_reach(app, ana):
    gid = ana.post("/api/goals", json={"name": "Mine", "target_cents": 1000}).json()["id"]
    bia = client_for(app)
    sign_up(bia, email="bia@example.com", name="Bia")
    assert bia.get("/api/goals").json() == []
    assert bia.post(f"/api/goals/{gid}/moves", json={"amount_cents": 500}).status_code == 404
    assert bia.patch(f"/api/goals/{gid}", json={"name": "Hers"}).status_code == 404
    assert bia.delete(f"/api/goals/{gid}").status_code == 404
