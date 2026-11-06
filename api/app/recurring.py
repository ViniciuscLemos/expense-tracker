from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .deps import current_user, db
from .entries import check_category
from .months import shift, today

router = APIRouter(prefix="/api/recurring")

FIELDS = "id, kind, category_id, amount_cents, description, day_of_month, next_day, active"


def on_day(first_of_month: date, day_of_month: int) -> date:
    """The day in that month, or its last day when the month is shorter (31 in February)."""
    last = (shift(first_of_month, 1) - first_of_month).days
    return first_of_month.replace(day=min(day_of_month, last))


def after(day: date, day_of_month: int) -> date:
    return on_day(shift(day.replace(day=1), 1), day_of_month)


def post_due(conn, user_id: int, until: date | None = None) -> int:
    """Writes down every recurring entry that's due, catching up on months nobody opened
    the app. FOR UPDATE: the page asks for the list and the month at the same time, and
    without the lock both requests would write the same rent."""
    until = until or today()
    rows = conn.execute(
        "SELECT id, kind, category_id, amount_cents, description, day_of_month, next_day FROM recurring "
        "WHERE user_id = %s AND active AND next_day <= %s ORDER BY id FOR UPDATE",
        (user_id, until)).fetchall()
    written = 0
    for r in rows:
        day = r["next_day"]
        while day <= until:
            conn.execute(
                "INSERT INTO entries (user_id, kind, category_id, amount_cents, description, day, recurring_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (user_id, r["kind"], r["category_id"], r["amount_cents"], r["description"], day, r["id"]))
            written += 1
            day = after(day, r["day_of_month"])
        conn.execute("UPDATE recurring SET next_day = %s WHERE id = %s", (day, r["id"]))
    return written


class NewRecurring(BaseModel):
    kind: Literal["expense", "income"]
    category_id: int
    amount_cents: int = Field(gt=0, lt=100_000_000_000, strict=True)
    description: str = Field(min_length=1, max_length=120)
    # the first time it happens; from then on, the same day every month
    first_day: date


class RecurringChange(BaseModel):
    amount_cents: int | None = Field(default=None, gt=0, lt=100_000_000_000, strict=True)
    description: str | None = Field(default=None, min_length=1, max_length=120)
    active: bool | None = None


def owned(conn, user_id: int, recurring_id: int) -> dict:
    row = conn.execute(f"SELECT {FIELDS} FROM recurring WHERE id = %s AND user_id = %s",
                       (recurring_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, "No such recurring entry.")
    return row


@router.get("")
def list_recurring(user=Depends(current_user), conn=Depends(db, scope="function")):
    post_due(conn, user["id"])
    return conn.execute(f"SELECT {FIELDS} FROM recurring WHERE user_id = %s ORDER BY active DESC, day_of_month, id",
                        (user["id"],)).fetchall()


@router.post("", status_code=201)
def add_recurring(body: NewRecurring, user=Depends(current_user), conn=Depends(db, scope="function")):
    check_category(conn, user["id"], body.category_id, body.kind)
    row = conn.execute(
        f"INSERT INTO recurring (user_id, kind, category_id, amount_cents, description, day_of_month, next_day) "
        f"VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING {FIELDS}",
        (user["id"], body.kind, body.category_id, body.amount_cents, body.description.strip(),
         body.first_day.day, body.first_day)).fetchone()
    # one that started today or before is written down right away
    post_due(conn, user["id"])
    return owned(conn, user["id"], row["id"])


@router.patch("/{recurring_id}")
def change_recurring(recurring_id: int, body: RecurringChange, user=Depends(current_user),
                     conn=Depends(db, scope="function")):
    """Changes the ones to come; what was already written down stays as it was."""
    current = owned(conn, user["id"], recurring_id)
    sent = body.model_dump(exclude_unset=True, exclude_none=True)
    if "description" in sent:
        sent["description"] = sent["description"].strip()
    if sent.get("active") and not current["active"]:
        # back on: from the next time it falls, not every month it was off
        first = on_day(today().replace(day=1), current["day_of_month"])
        sent["next_day"] = first if first >= today() else after(today(), current["day_of_month"])
    if not sent:
        return current
    columns = ", ".join(f"{c} = %({c})s" for c in sent)
    conn.execute(f"UPDATE recurring SET {columns} WHERE id = %(id)s", {**sent, "id": recurring_id})
    return owned(conn, user["id"], recurring_id)


@router.delete("/{recurring_id}", status_code=204)
def delete_recurring(recurring_id: int, user=Depends(current_user), conn=Depends(db, scope="function")):
    owned(conn, user["id"], recurring_id)
    conn.execute("DELETE FROM recurring WHERE id = %s", (recurring_id,))
