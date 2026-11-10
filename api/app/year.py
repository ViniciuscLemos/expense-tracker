from datetime import date

from fastapi import APIRouter, Depends, Path

from .deps import current_user, db
from .recurring import post_due

router = APIRouter(prefix="/api")


@router.get("/year/{year}")
def year(year: int = Path(ge=2000, le=2100), user=Depends(current_user), conn=Depends(db, scope="function")):
    """The whole year on one page: the twelve months side by side, where the money went,
    how much of what came in was kept, and the months that stood out."""
    uid = user["id"]
    post_due(conn, uid)
    start, end = date(year, 1, 1), date(year + 1, 1, 1)

    # generate_series so the months with nothing written are there too, as zeros
    months = conn.execute(
        "SELECT to_char(m, 'YYYY-MM') AS month, "
        "coalesce(sum(e.amount_cents) FILTER (WHERE e.kind = 'income'), 0) AS income, "
        "coalesce(sum(e.amount_cents) FILTER (WHERE e.kind = 'expense'), 0) AS expenses "
        "FROM generate_series(%s::date, %s::date, interval '1 month') AS m "
        "LEFT JOIN entries e ON e.user_id = %s AND e.day >= m AND e.day < m + interval '1 month' "
        "GROUP BY m ORDER BY m", (start, date(year, 12, 1), uid)).fetchall()

    categories = conn.execute(
        "SELECT c.id, c.name, c.color, sum(e.amount_cents) AS spent, count(*) AS entries, "
        "count(DISTINCT date_trunc('month', e.day)) AS months "
        "FROM entries e JOIN categories c ON c.id = e.category_id "
        "WHERE e.user_id = %s AND e.kind = 'expense' AND e.day >= %s AND e.day < %s "
        "GROUP BY c.id ORDER BY spent DESC", (uid, start, end)).fetchall()

    income = sum(m["income"] for m in months)
    expenses = sum(m["expenses"] for m in months)
    used = [m for m in months if m["income"] or m["expenses"]]
    priciest = max(used, key=lambda m: m["expenses"], default=None)
    cheapest = min((m for m in used if m["expenses"]), key=lambda m: m["expenses"], default=None)

    return {
        "year": year,
        "income": income,
        "expenses": expenses,
        "balance": income - expenses,
        # share of what came in that was kept, in whole percent; null when nothing came in
        "kept_percent": round(100 * (income - expenses) / income) if income else None,
        "months": [dict(m) for m in months],
        "months_used": len(used),
        "categories": [dict(c) for c in categories],
        "priciest": priciest["month"] if priciest else None,
        "cheapest": cheapest["month"] if cheapest else None,
    }
