import base64
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .deps import current_user, db
from .months import month_range

router = APIRouter(prefix="/api/entries")

FIELDS = "e.id, e.kind, e.category_id, e.amount_cents, e.description, e.day, e.created_at, e.recurring_id"
PAGE = 50


class NewEntry(BaseModel):
    kind: Literal["expense", "income"]
    category_id: int
    amount_cents: int = Field(gt=0, lt=100_000_000_000, strict=True)
    description: str = Field(min_length=1, max_length=120)
    day: date
    # written while offline: the page makes up this key and sends the entry again until it
    # gets an answer, so a reply lost on a bad connection doesn't write it down twice
    client_key: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{8,60}$")


class EntryChange(BaseModel):
    kind: Literal["expense", "income"] | None = None
    category_id: int | None = None
    amount_cents: int | None = Field(default=None, gt=0, lt=100_000_000_000, strict=True)
    description: str | None = Field(default=None, min_length=1, max_length=120)
    day: date | None = None


def check_category(conn, user_id: int, category_id: int, kind: str):
    row = conn.execute("SELECT kind, archived FROM categories WHERE id = %s AND user_id = %s",
                       (category_id, user_id)).fetchone()
    if not row:
        raise HTTPException(422, "No such category.")
    if row["kind"] != kind:
        raise HTTPException(422, f"That category is for {row['kind']}s.")
    if row["archived"]:
        raise HTTPException(422, "That category is archived.")


def cursor_of(row: dict) -> str:
    return base64.urlsafe_b64encode(f"{row['day'].isoformat()}|{row['id']}".encode()).decode()


def read_cursor(text: str) -> tuple[date, int]:
    try:
        day, entry_id = base64.urlsafe_b64decode(text.encode()).decode().split("|")
        return date.fromisoformat(day), int(entry_id)
    except ValueError:
        raise HTTPException(422, "Bad cursor.")


@router.get("")
def list_entries(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    kind: Literal["expense", "income"] | None = None,
    category_id: int | None = None,
    q: str | None = Query(default=None, max_length=60),
    after: str | None = None,
    user=Depends(current_user),
    conn=Depends(db, scope="function"),
):
    """Newest first, 50 at a time. `after` is the `next` of the page before: the next page
    starts right after that (day, id), so it doesn't slow down or skip rows like OFFSET would
    when entries are added in between."""
    from .recurring import post_due  # here and not at the top: recurring uses this module
    post_due(conn, user["id"])
    where, params = ["e.user_id = %s"], [user["id"]]
    if month:
        start, end = month_range(month)
        where.append("e.day >= %s AND e.day < %s")
        params += [start, end]
    if kind:
        where.append("e.kind = %s")
        params.append(kind)
    if category_id:
        where.append("e.category_id = %s")
        params.append(category_id)
    if q and q.strip():
        where.append("(e.description ILIKE %s OR c.name ILIKE %s)")
        term = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        params += [term, term]
    if after:
        where.append("(e.day, e.id) < (%s, %s)")
        params += list(read_cursor(after))
    rows = conn.execute(
        f"SELECT {FIELDS} FROM entries e JOIN categories c ON c.id = e.category_id "
        f"WHERE {' AND '.join(where)} ORDER BY e.day DESC, e.id DESC LIMIT {PAGE + 1}", params).fetchall()
    return {"entries": rows[:PAGE], "next": cursor_of(rows[PAGE - 1]) if len(rows) > PAGE else None}


def get_entry(conn, user_id: int, entry_id: int) -> dict:
    row = conn.execute(f"SELECT {FIELDS} FROM entries e WHERE e.id = %s AND e.user_id = %s",
                       (entry_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, "No such entry.")
    return row


@router.post("", status_code=201)
def add_entry(body: NewEntry, user=Depends(current_user), conn=Depends(db, scope="function")):
    check_category(conn, user["id"], body.category_id, body.kind)
    source = f"offline:{body.client_key}" if body.client_key else None
    row = conn.execute(
        "INSERT INTO entries (user_id, kind, category_id, amount_cents, description, day, source_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (user_id, source_id) WHERE source_id IS NOT NULL DO NOTHING "
        "RETURNING id, kind, category_id, amount_cents, description, day, created_at, recurring_id",
        (user["id"], body.kind, body.category_id, body.amount_cents, body.description.strip(), body.day, source)).fetchone()
    if row is None:
        # this one arrived before and the answer got lost on the way: the same entry, not a second
        row = conn.execute(f"SELECT {FIELDS} FROM entries e WHERE e.user_id = %s AND e.source_id = %s",
                           (user["id"], source)).fetchone()
    return row


@router.patch("/{entry_id}")
def change_entry(entry_id: int, body: EntryChange, user=Depends(current_user), conn=Depends(db, scope="function")):
    entry = get_entry(conn, user["id"], entry_id)
    sent = body.model_dump(exclude_unset=True, exclude_none=True)
    if "description" in sent:
        sent["description"] = sent["description"].strip()
    merged = {**entry, **sent}
    if "kind" in sent or "category_id" in sent:
        check_category(conn, user["id"], merged["category_id"], merged["kind"])
    if not sent:
        return entry
    columns = ", ".join(f"{column} = %({column})s" for column in sent)
    return conn.execute(
        f"UPDATE entries SET {columns}, updated_at = now() WHERE id = %(id)s "
        "RETURNING id, kind, category_id, amount_cents, description, day, created_at, recurring_id",
        {**sent, "id": entry_id}).fetchone()


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, user=Depends(current_user), conn=Depends(db, scope="function")):
    get_entry(conn, user["id"], entry_id)
    conn.execute("DELETE FROM entries WHERE id = %s", (entry_id,))


class Imported(BaseModel):
    # the shape of the browser version's backup file
    id: str
    type: Literal["expense", "income"]
    description: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=40)
    amount: int = Field(gt=0, lt=100_000_000_000, strict=True)
    date: date


class Backup(BaseModel):
    entries: list[Imported] = Field(max_length=20_000)


@router.post("/import")
def import_backup(body: Backup, user=Depends(current_user), conn=Depends(db, scope="function")):
    """Takes the backup file of the version that saves in the browser. Categories are
    matched by name, and the ones that don't exist yet are created."""
    known = {(row["kind"], row["name"].lower()): row["id"] for row in
             conn.execute("SELECT id, kind, name FROM categories WHERE user_id = %s", (user["id"],))}
    rows = []
    for e in body.entries:
        key = (e.type, e.category.strip().lower())
        if key not in known:
            known[key] = conn.execute(
                "INSERT INTO categories (user_id, kind, name, color) VALUES (%s, %s, %s, '#8a8378') RETURNING id",
                (user["id"], e.type, e.category.strip())).fetchone()["id"]
        rows.append((user["id"], e.type, known[key], e.amount, e.description.strip(), e.date, e.id))
    before = conn.execute("SELECT count(*) AS n FROM entries WHERE user_id = %s", (user["id"],)).fetchone()["n"]
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO entries (user_id, kind, category_id, amount_cents, description, day, source_id) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", rows)
    after = conn.execute("SELECT count(*) AS n FROM entries WHERE user_id = %s", (user["id"],)).fetchone()["n"]
    return {"imported": after - before, "already_here": len(rows) - (after - before)}
