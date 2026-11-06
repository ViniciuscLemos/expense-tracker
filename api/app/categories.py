from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from psycopg import errors
from pydantic import BaseModel, Field

from .deps import current_user, db

router = APIRouter(prefix="/api/categories")

COLOR = r"^#[0-9a-f]{6}$"
FIELDS = "id, kind, name, color, budget_cents, archived"


class NewCategory(BaseModel):
    kind: Literal["expense", "income"]
    name: str = Field(min_length=1, max_length=40)
    color: str = Field(pattern=COLOR)
    budget_cents: int | None = Field(default=None, gt=0, strict=True)


class CategoryChange(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    color: str | None = Field(default=None, pattern=COLOR)
    # null clears the budget, so "not sent" and "sent as null" mean different things here
    budget_cents: int | None = Field(default=None, gt=0, strict=True)
    archived: bool | None = None


def owned(conn, user_id: int, category_id: int) -> dict:
    row = conn.execute(f"SELECT {FIELDS} FROM categories WHERE id = %s AND user_id = %s",
                       (category_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, "No such category.")
    return row


@router.get("")
def list_categories(user=Depends(current_user), conn=Depends(db, scope="function")):
    return conn.execute(
        f"SELECT {FIELDS}, (SELECT count(*) FROM entries e WHERE e.category_id = c.id) AS entries "
        "FROM categories c WHERE user_id = %s ORDER BY kind, archived, lower(name)", (user["id"],)).fetchall()


@router.post("", status_code=201)
def add_category(body: NewCategory, user=Depends(current_user), conn=Depends(db, scope="function")):
    if body.kind == "income" and body.budget_cents:
        raise HTTPException(422, "Budgets are for expenses.")
    try:
        return conn.execute(
            f"INSERT INTO categories (user_id, kind, name, color, budget_cents) VALUES (%s, %s, %s, %s, %s) RETURNING {FIELDS}",
            (user["id"], body.kind, body.name.strip(), body.color, body.budget_cents)).fetchone()
    except errors.UniqueViolation:
        raise HTTPException(409, f'There\'s already a category called "{body.name.strip()}".')


@router.patch("/{category_id}")
def change_category(category_id: int, body: CategoryChange, user=Depends(current_user), conn=Depends(db, scope="function")):
    category = owned(conn, user["id"], category_id)
    sent = body.model_dump(exclude_unset=True)
    if "name" in sent:
        sent["name"] = sent["name"].strip()
    if sent.get("budget_cents") and category["kind"] == "income":
        raise HTTPException(422, "Budgets are for expenses.")
    if not sent:
        return category
    columns = ", ".join(f"{column} = %({column})s" for column in sent)
    try:
        return conn.execute(f"UPDATE categories SET {columns} WHERE id = %(id)s RETURNING {FIELDS}",
                            {**sent, "id": category_id}).fetchone()
    except errors.UniqueViolation:
        raise HTTPException(409, f'There\'s already a category called "{sent["name"]}".')


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, move_to: int | None = None, user=Depends(current_user), conn=Depends(db, scope="function")):
    """A category with entries can't just disappear. Either its entries move to another
    category of the same kind (move_to), or the answer says how many are in the way."""
    category = owned(conn, user["id"], category_id)
    used = conn.execute("SELECT count(*) AS n FROM entries WHERE category_id = %s", (category_id,)).fetchone()["n"]
    if used and move_to is None:
        raise HTTPException(409, f"{used} {'entry uses' if used == 1 else 'entries use'} this category. "
                                 "Move them to another one, or archive it instead.")
    if used:
        target = owned(conn, user["id"], move_to)
        if target["id"] == category_id or target["kind"] != category["kind"]:
            raise HTTPException(422, "Pick another category of the same kind.")
        conn.execute("UPDATE entries SET category_id = %s, updated_at = now() WHERE category_id = %s",
                     (move_to, category_id))
    conn.execute("DELETE FROM categories WHERE id = %s", (category_id,))
