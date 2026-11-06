from fastapi.testclient import TestClient

from .conftest import client_for, sign_up


def test_signup_logs_in_and_brings_the_starter_categories(client):
    sign_up(client)
    assert client.get("/api/me").json()["email"] == "ana@example.com"
    names = {c["name"] for c in client.get("/api/categories").json()}
    assert {"Food", "Housing", "Salary"} <= names


def test_the_same_email_twice_is_refused_whatever_the_case(client):
    sign_up(client)
    response = client.post("/api/signup", json={"name": "Ana", "email": "ANA@example.com", "password": "another one!"})
    assert response.status_code == 409


def test_short_passwords_and_odd_emails_are_refused(client):
    assert client.post("/api/signup", json={"name": "A", "email": "a@b.co", "password": "short"}).status_code == 422
    assert client.post("/api/signup", json={"name": "A", "email": "not an email", "password": "long enough"}).status_code == 422


def test_login_logout(app, client):
    sign_up(client)
    other = client_for(app)
    assert other.get("/api/me").status_code == 401
    assert other.post("/api/login", json={"email": "Ana@Example.com", "password": "wrong"}).status_code == 401
    assert other.post("/api/login", json={"email": "ana@example.com", "password": "a long password"}).status_code == 200
    assert other.get("/api/me").status_code == 200
    assert other.post("/api/logout").status_code == 204
    assert other.get("/api/me").status_code == 401


def test_five_wrong_passwords_lock_the_email_for_a_while(app, client):
    sign_up(client)
    other = client_for(app)
    for _ in range(5):
        assert other.post("/api/login", json={"email": "ana@example.com", "password": "nope"}).status_code == 401
    locked = other.post("/api/login", json={"email": "ana@example.com", "password": "a long password"})
    assert locked.status_code == 429
    assert int(locked.headers["retry-after"]) > 0


def test_changes_without_the_header_are_refused(app, ana):
    # a plain form post from another site can't add that header
    bare = TestClient(app, cookies=ana.cookies)
    assert bare.post("/api/entries", json={}).status_code == 403
    # reading is fine
    assert bare.get("/api/me").status_code == 200


def test_people_only_see_their_own_things(app, ana):
    from .conftest import add
    entry = add(ana, "Rent", 150000, "2026-10-02", cat="Housing")
    bia = client_for(app)
    sign_up(bia, email="bia@example.com", name="Bia")
    assert bia.get("/api/entries").json()["entries"] == []
    assert bia.patch(f"/api/entries/{entry['id']}", json={"amount_cents": 1}).status_code == 404
    assert bia.delete(f"/api/entries/{entry['id']}").status_code == 404
    # and can't put an entry in someone else's category
    anas_food = next(c for c in ana.get("/api/categories").json() if c["name"] == "Food")
    response = bia.post("/api/entries", json={"kind": "expense", "category_id": anas_food["id"],
                                              "amount_cents": 100, "description": "x", "day": "2026-10-01"})
    assert response.status_code == 422


def test_the_database_name_can_be_swapped_keeping_the_login():
    from psycopg.conninfo import conninfo_to_dict
    from app.db import conninfo
    # a password with "=" in it, the way Neon sometimes makes them
    url = "postgresql://owner@host.neon.tech/neondb?sslmode=require&password=ab=cd%2Fe"
    assert conninfo_to_dict(conninfo(url, "expenses")) == {
        "host": "host.neon.tech", "user": "owner", "dbname": "expenses", "sslmode": "require", "password": "ab=cd/e"}
    assert conninfo_to_dict(conninfo("postgresql://postgres:pw@localhost:5432/x")) == {
        "host": "localhost", "port": "5432", "user": "postgres", "password": "pw", "dbname": "x"}
