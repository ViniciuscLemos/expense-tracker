import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException

ZONE = ZoneInfo(os.environ.get("TZ_NAME", "America/Sao_Paulo"))


def today() -> date:
    return datetime.now(ZONE).date()


def month_range(month: str) -> tuple[date, date]:
    """"2026-10" -> (Oct 1, Nov 1): the end is the first day *after* the month, so the
    query is day >= start AND day < end and nothing on the 31st gets lost."""
    try:
        year, m = map(int, month.split("-"))
        start = date(year, m, 1)
    except ValueError:
        raise HTTPException(422, "Months look like 2026-10.")
    return start, shift(start, 1)


def shift(first_day: date, months: int) -> date:
    index = first_day.year * 12 + first_day.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def label(first_day: date) -> str:
    return first_day.strftime("%Y-%m")
