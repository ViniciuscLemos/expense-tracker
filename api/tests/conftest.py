import os
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

# a real Postgres: in CI a service container, on my machine a local one
URL = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@localhost:54329/expenses_test")


def fresh_database():
    base, name = URL.rsplit("/", 1)
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')


@pytest.fixture(scope="session")
def app():
    fresh_database()
    app = create_app(URL, demo_mode=False, site=Path("no-site-in-tests"))
    yield app
    app.state.pool.close()


@pytest.fixture(autouse=True)
def clean(app):
    with app.state.pool.connection() as conn:
        conn.execute("TRUNCATE users, sessions, categories, entries RESTART IDENTITY CASCADE")
    app.state.attempts.failures.clear()


def client_for(app) -> TestClient:
    return TestClient(app, headers={"X-Requested-With": "fetch"})


@pytest.fixture
def client(app):
    return client_for(app)


def sign_up(client, email="ana@example.com", name="Ana", password="a long password"):
    response = client.post("/api/signup", json={"name": name, "email": email, "password": password})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def ana(client):
    """A logged in client with Ana's account."""
    sign_up(client)
    return client


def category(client, name, kind="expense"):
    return next(c for c in client.get("/api/categories").json() if c["name"] == name and c["kind"] == kind)


def add(client, description, cents, day, cat="Food", kind="expense"):
    response = client.post("/api/entries", json={
        "kind": kind, "category_id": category(client, cat, kind)["id"],
        "amount_cents": cents, "description": description, "day": day})
    assert response.status_code == 201, response.text
    return response.json()
