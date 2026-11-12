from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .deps import current_user, db
from .months import today

router = APIRouter(prefix="/api/goals")

MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"


def first_of(month: str | None) -> date | None:
    return date(int(month[:4]), int(month[5:7]), 1) if month else None


def view(row, now: date) -> dict:
    """A goal with what's in it and, when it has a date, how much a month still gets it there."""
    saved, target = row["saved_cents"], row["target_cents"]
    left = max(0, target - saved)
    out = {
        "id": row["id"], "name": row["name"], "target_cents": target, "saved_cents": saved,
        "left_cents": left, "reached": saved >= target,
        "by_month": row["by_month"].strftime("%Y-%m") if row["by_month"] else None,
        "months_left": None, "per_month_cents": None, "last_move": row["last_move"],
    }
    if row["by_month"] and left:
        # this month counts: putting money aside today still makes it
        months = (row["by_month"].year - now.year) * 12 + row["by_month"].month - now.month + 1
        out["months_left"] = max(0, months)
        if months > 0:
            out["per_month_cents"] = -(-left // months)  # rounded up, so it really gets there
    return out


def goal_rows(conn, user_id: int, goal_id: int | None = None):
    return conn.execute(
        "SELECT g.id, g.name, g.target_cents, g.by_month, "
        "coalesce(sum(m.amount_cents), 0)::bigint AS saved_cents, max(m.day) AS last_move "
        "FROM goals g LEFT JOIN goal_moves m ON m.goal_id = g.id "
        "WHERE g.user_id = %s AND (%s::bigint IS NULL OR g.id = %s) "
        "GROUP BY g.id ORDER BY g.created_at, g.id", (user_id, goal_id, goal_id)).fetchall()


def one(conn, user_id: int, goal_id: int):
    rows = goal_rows(conn, user_id, goal_id)
    if not rows:
        raise HTTPException(404, "No such goal.")
    return rows[0]


class NewGoal(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    target_cents: int = Field(gt=0, lt=100_000_000_000, strict=True)
    by_month: str | None = Field(default=None, pattern=MONTH)


class GoalChange(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    target_cents: int | None = Field(default=None, gt=0, lt=100_000_000_000, strict=True)
    by_month: str | None = Field(default=None, pattern=MONTH)


class Move(BaseModel):
    # positive puts money in, negative takes it out
    amount_cents: int = Field(gt=-100_000_000_000, lt=100_000_000_000, strict=True)


def clean_name(name: str | None) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(422, "A goal needs a name.")
    return name


def check_month(month: str | None):
    now = today()
    if month and first_of(month) < date(now.year, now.month, 1):
        raise HTTPException(422, "That month is already over.")


@router.get("")
def list_goals(user=Depends(current_user), conn=Depends(db, scope="function")):
    now = today()
    return [view(r, now) for r in goal_rows(conn, user["id"])]


@router.post("", status_code=201)
def add_goal(body: NewGoal, user=Depends(current_user), conn=Depends(db, scope="function")):
    name = clean_name(body.name)
    check_month(body.by_month)
    count = conn.execute("SELECT count(*) AS n FROM goals WHERE user_id = %s", (user["id"],)).fetchone()["n"]
    if count >= 20:
        raise HTTPException(422, "Twenty goals is the limit. Finish or delete one first.")
    gid = conn.execute(
        "INSERT INTO goals (user_id, name, target_cents, by_month) VALUES (%s, %s, %s, %s) RETURNING id",
        (user["id"], name, body.target_cents, first_of(body.by_month))).fetchone()["id"]
    return view(one(conn, user["id"], gid), today())


@router.patch("/{goal_id}")
def change_goal(goal_id: int, body: GoalChange, user=Depends(current_user), conn=Depends(db, scope="function")):
    one(conn, user["id"], goal_id)
    sent = body.model_dump(exclude_unset=True)
    if "name" in sent:
        sent["name"] = clean_name(sent["name"])
    if "target_cents" in sent and sent["target_cents"] is None:
        raise HTTPException(422, "A goal needs an amount.")
    if "by_month" in sent:
        check_month(sent["by_month"])
        sent["by_month"] = first_of(sent["by_month"])
    if sent:
        columns = ", ".join(f"{k} = %({k})s" for k in sent)
        conn.execute(f"UPDATE goals SET {columns} WHERE id = %(id)s", {**sent, "id": goal_id})
    return view(one(conn, user["id"], goal_id), today())


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: int, user=Depends(current_user), conn=Depends(db, scope="function")):
    one(conn, user["id"], goal_id)
    conn.execute("DELETE FROM goals WHERE id = %s", (goal_id,))


@router.post("/{goal_id}/moves", status_code=201)
def add_move(goal_id: int, body: Move, user=Depends(current_user), conn=Depends(db, scope="function")):
    if body.amount_cents == 0:
        raise HTTPException(422, "Put in or take out some amount.")
    # locked, so two taps at once can't both take out the last of it
    if not conn.execute("SELECT id FROM goals WHERE id = %s AND user_id = %s FOR UPDATE",
                        (goal_id, user["id"])).fetchone():
        raise HTTPException(404, "No such goal.")
    saved = one(conn, user["id"], goal_id)["saved_cents"]
    if saved + body.amount_cents < 0:
        raise HTTPException(422, "There isn't that much in it.")
    conn.execute("INSERT INTO goal_moves (goal_id, user_id, amount_cents, day) VALUES (%s, %s, %s, %s)",
                 (goal_id, user["id"], body.amount_cents, today()))
    return view(one(conn, user["id"], goal_id), today())


@router.get("/{goal_id}/moves")
def list_moves(goal_id: int, user=Depends(current_user), conn=Depends(db, scope="function")):
    one(conn, user["id"], goal_id)
    return conn.execute("SELECT id, amount_cents, day FROM goal_moves WHERE goal_id = %s ORDER BY day DESC, id DESC",
                        (goal_id,)).fetchall()
