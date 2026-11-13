from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .deps import current_user, db

router = APIRouter(prefix="/api/shared")

# what each kind of move does to "what they owe me", from the amount typed
SIGN = {
    "they_paid": -0.5,       # they paid the whole thing for both: I owe half of it
    "they_paid_back": -1,    # they gave me money: they owe that much less
    "i_paid_back": 1,        # I gave them money: I owe that much less
}
WORDS = {"they_paid": "paid for both", "they_paid_back": "paid back", "i_paid_back": "you paid back"}


def half(cents: int) -> int:
    # an odd cent goes to whoever paid: R$ 45,01 for two is 22,50 each and a cent for the payer
    return cents // 2


class NewMove(BaseModel):
    with_name: str = Field(min_length=1, max_length=40)
    kind: Literal["they_paid", "they_paid_back", "i_paid_back"]
    amount_cents: int = Field(gt=0, lt=100_000_000_000, strict=True)
    description: str | None = Field(default=None, max_length=120)
    day: date


def people(conn, user_id: int) -> list[dict]:
    """Everyone this person shares with, with where it stands and the last few things that
    moved it. Names are matched without case (Bia, bia and BIA are one person),
    and shown the way they were first written."""
    lines = conn.execute(
        """
        SELECT lower(split_with) AS who, split_with AS name, 'split' AS kind, id, description, day,
               amount_cents, (amount_cents / 2)::bigint AS effect
        FROM entries WHERE user_id = %(u)s AND split_with IS NOT NULL
        UNION ALL
        SELECT lower(with_name), with_name, kind, id, description, day, abs(amount_cents), amount_cents
        FROM shared_moves WHERE user_id = %(u)s
        ORDER BY day DESC, id DESC
        """, {"u": user_id}).fetchall()
    found: dict[str, dict] = {}
    for line in lines:
        person = found.setdefault(line["who"], {"name": line["name"], "owes_you_cents": 0, "since": line["day"], "lines": []})
        person["owes_you_cents"] += line["effect"]
        person["since"] = line["day"]
        person["name"] = line["name"]  # going back in time: ends as it was first written
        if len(person["lines"]) < 8:
            person["lines"].append({
                "kind": line["kind"], "id": line["id"], "description": line["description"],
                "day": line["day"], "amount_cents": line["amount_cents"], "effect_cents": line["effect"],
            })
    # the ones with money still open first, then the most recent
    return sorted(found.values(), key=lambda p: (p["owes_you_cents"] == 0, -max(l["day"] for l in p["lines"]).toordinal()))


@router.get("")
def list_shared(user=Depends(current_user), conn=Depends(db, scope="function")):
    return {"people": people(conn, user["id"])}


@router.post("/moves", status_code=201)
def add_move(body: NewMove, user=Depends(current_user), conn=Depends(db, scope="function")):
    name = body.with_name.strip()
    if not name:
        raise HTTPException(422, "Who is it with?")
    amount = body.amount_cents
    effect = -half(amount) if body.kind == "they_paid" else int(SIGN[body.kind] * amount)
    description = (body.description or "").strip() or WORDS[body.kind]
    row = conn.execute(
        "INSERT INTO shared_moves (user_id, with_name, kind, amount_cents, description, day) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (user["id"], name, body.kind, effect, description, body.day)).fetchone()
    return {"id": row["id"], "people": people(conn, user["id"])}


@router.delete("/moves/{move_id}", status_code=204)
def delete_move(move_id: int, user=Depends(current_user), conn=Depends(db, scope="function")):
    if not conn.execute("DELETE FROM shared_moves WHERE id = %s AND user_id = %s RETURNING id",
                        (move_id, user["id"])).fetchone():
        raise HTTPException(404, "No such move.")
