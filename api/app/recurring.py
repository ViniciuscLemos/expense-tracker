import re
import statistics
from collections import defaultdict
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


def suggestion_key(kind: str, description: str) -> str:
    """'Netflix.com 11/26' and 'NETFLIX.COM 10/26' are the same bill: lower case, no digits,
    no punctuation, single spaces."""
    text = re.sub(r"[^a-zà-ÿ ]+", " ", description.lower())
    return f"{kind}:{' '.join(text.split())}"[:160]


@router.get("/suggestions")
def suggestions(user=Depends(current_user), conn=Depends(db, scope="function")):
    """Entries written by hand that look like they come every month: the same description in
    at least three of the last six months, about the same amount (within 15%) and not already
    a recurring entry or said no to. Each comes with what to set it up with."""
    uid = user["id"]
    now = today()
    since = shift(now.replace(day=1), -6)
    rows = conn.execute(
        "SELECT kind, category_id, amount_cents, description, day FROM entries "
        "WHERE user_id = %s AND recurring_id IS NULL AND day >= %s AND day <= %s ORDER BY day",
        (uid, since, now)).fetchall()
    known = {suggestion_key(r["kind"], r["description"]) for r in
             conn.execute("SELECT kind, description FROM recurring WHERE user_id = %s", (uid,))}
    known |= {r["key"] for r in conn.execute("SELECT key FROM recurring_dismissed WHERE user_id = %s", (uid,))}

    groups = defaultdict(list)
    for r in rows:
        key = suggestion_key(r["kind"], r["description"])
        if key.split(":", 1)[1] and key not in known:
            groups[key].append(r)
    out = []
    for key, items in groups.items():
        by_month = {}
        for r in items:
            by_month.setdefault(r["day"].strftime("%Y-%m"), r)  # one per month: the first
        if len(by_month) < 3:
            continue
        amounts = [r["amount_cents"] for r in by_month.values()]
        mean = statistics.mean(amounts)
        if max(abs(a - mean) for a in amounts) > 0.15 * mean:
            continue
        last = items[-1]
        day = round(statistics.median(r["day"].day for r in by_month.values()))
        # the next time it falls after the last one written, so nothing gets written twice
        first = on_day(shift(last["day"].replace(day=1), 1), day)
        out.append({
            "key": key, "kind": last["kind"], "category_id": last["category_id"],
            # "Netflix.com 11/26" becomes "Netflix.com": the date belongs to one month, not all of them
            "description": " ".join(w for w in last["description"].split() if not re.search(r"\d", w)) or last["description"],
            "amount_cents": last["amount_cents"],
            "day_of_month": day, "months": len(by_month), "first_day": first,
        })
    out.sort(key=lambda s: -s["amount_cents"])
    return out[:5]


class Dismiss(BaseModel):
    key: str = Field(min_length=1, max_length=160)


@router.post("/suggestions/dismiss", status_code=204)
def dismiss(body: Dismiss, user=Depends(current_user), conn=Depends(db, scope="function")):
    conn.execute("INSERT INTO recurring_dismissed (user_id, key) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                 (user["id"], body.key))


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
