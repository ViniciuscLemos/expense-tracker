from fastapi import APIRouter, Depends, Query

from .deps import current_user, db
from .months import label, month_range, shift, today

router = APIRouter(prefix="/api")


def totals(conn, user_id: int, start, end) -> dict:
    row = conn.execute(
        "SELECT coalesce(sum(amount_cents) FILTER (WHERE kind = 'income'), 0) AS income, "
        "coalesce(sum(amount_cents) FILTER (WHERE kind = 'expense'), 0) AS expenses "
        "FROM entries WHERE user_id = %s AND day >= %s AND day < %s", (user_id, start, end)).fetchone()
    return {"income": row["income"], "expenses": row["expenses"], "balance": row["income"] - row["expenses"]}


@router.get("/dashboard")
def dashboard(month: str = Query(pattern=r"^\d{4}-\d{2}$"), user=Depends(current_user), conn=Depends(db)):
    """Everything the month's page shows, in one request: the totals and last month's, the
    categories against their budgets, every day of the month and the last six months."""
    uid = user["id"]
    start, end = month_range(month)
    now = today()

    current = totals(conn, uid, start, end)
    previous = totals(conn, uid, shift(start, -1), start)

    # days that count for "per day": all of them in a past month, up to today in this one
    if now >= end:
        days_so_far = (end - start).days
    elif now >= start:
        days_so_far = (now - start).days + 1
    else:
        days_so_far = 0

    categories = conn.execute(
        "SELECT c.id, c.name, c.color, c.budget_cents, coalesce(sum(e.amount_cents), 0) AS spent, count(e.id) AS entries "
        "FROM categories c LEFT JOIN entries e ON e.category_id = c.id AND e.day >= %s AND e.day < %s "
        "WHERE c.user_id = %s AND c.kind = 'expense' "
        "GROUP BY c.id HAVING coalesce(sum(e.amount_cents), 0) > 0 OR c.budget_cents IS NOT NULL "
        "ORDER BY spent DESC, c.name", (start, end, uid)).fetchall()

    # one row per day of the month, the ones without entries included, for the calendar
    days = conn.execute(
        "SELECT d::date AS day, "
        "coalesce(sum(e.amount_cents) FILTER (WHERE e.kind = 'expense'), 0) AS spent, "
        "coalesce(sum(e.amount_cents) FILTER (WHERE e.kind = 'income'), 0) AS earned "
        "FROM generate_series(%s::date, %s::date - 1, interval '1 day') d "
        "LEFT JOIN entries e ON e.user_id = %s AND e.day = d::date "
        "GROUP BY d ORDER BY d", (start, end, uid)).fetchall()

    six = shift(start, -5)
    months = conn.execute(
        "SELECT to_char(m, 'YYYY-MM') AS month, "
        "coalesce(sum(e.amount_cents) FILTER (WHERE e.kind = 'income'), 0) AS income, "
        "coalesce(sum(e.amount_cents) FILTER (WHERE e.kind = 'expense'), 0) AS expenses "
        "FROM generate_series(%s::date, %s::date, interval '1 month') m "
        "LEFT JOIN entries e ON e.user_id = %s AND e.day >= m AND e.day < m + interval '1 month' "
        "GROUP BY m ORDER BY m", (six, start, uid)).fetchall()

    biggest = conn.execute(
        "SELECT e.id, e.description, e.amount_cents, e.day, c.name AS category, c.color "
        "FROM entries e JOIN categories c ON c.id = e.category_id "
        "WHERE e.user_id = %s AND e.kind = 'expense' AND e.day >= %s AND e.day < %s "
        "ORDER BY e.amount_cents DESC, e.day DESC LIMIT 3", (uid, start, end)).fetchall()

    return {
        "month": label(start),
        "today": now,
        **current,
        "previous": previous,
        "per_day": current["expenses"] // days_so_far if days_so_far else None,
        "categories": categories,
        "days": days,
        "months": months,
        "biggest": biggest,
    }
