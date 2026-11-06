import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


def conninfo(url: str, database: str | None = None) -> str:
    """Turns a postgres:// URL into libpq's key=value form, optionally with another database.

    On Render this service borrows the connection of the link shortener (same Neon project)
    and only swaps the database name, so the password is never copied by hand. That URL has
    the password as a query parameter, and Neon passwords can contain "=", which Node's
    parser takes but libpq refuses in a URI. Split by hand (at the first "=") it works."""
    parts = urlsplit(url)
    params = {}
    if parts.hostname:
        params["host"] = parts.hostname
    if parts.port:
        params["port"] = parts.port
    if parts.username:
        params["user"] = unquote(parts.username)
    if parts.password:
        params["password"] = unquote(parts.password)
    params["dbname"] = database or unquote(parts.path.lstrip("/")) or None
    for pair in filter(None, parts.query.split("&")):
        key, _, value = pair.partition("=")
        params[unquote(key)] = unquote(value)
    return make_conninfo(**{k: v for k, v in params.items() if v is not None})


def make_pool(url: str, size: int = 5) -> ConnectionPool:
    url = conninfo(url, os.environ.get("DATABASE_NAME"))
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
