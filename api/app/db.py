import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


def with_database(url: str, name: str | None) -> str:
    """The same server and login with another database: on Render this service borrows the
    connection of the link shortener (same Neon project) and only swaps the database name,
    so the password is never copied by hand."""
    if not name:
        return url
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{name}"))


def make_pool(url: str, size: int = 5) -> ConnectionPool:
    url = with_database(url, os.environ.get("DATABASE_NAME"))
    return ConnectionPool(url, min_size=1, max_size=size, kwargs={"row_factory": dict_row}, open=True)


def migrate(pool: ConnectionPool) -> list[str]:
    """Runs the .sql files in migrations/ that haven't run yet, in name order."""
    ran = []
    with pool.connection() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, ran_at timestamptz NOT NULL DEFAULT now())")
        # two instances starting together wait for each other here instead of both migrating
        conn.execute("SELECT pg_advisory_xact_lock(7212)")
        done = {row["name"] for row in conn.execute("SELECT name FROM schema_migrations")}
        for file in sorted(MIGRATIONS.glob("*.sql")):
            if file.name not in done:
                conn.execute(file.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (file.name,))
                ran.append(file.name)
    return ran
