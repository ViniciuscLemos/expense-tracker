import re
import secrets
import time
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .deps import COOKIE, current_user, db, token_hash

router = APIRouter(prefix="/api")

SESSION_DAYS = 30
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# the categories every new account starts with; they can be renamed, recolored or archived
STARTER = [
    ("expense", "Food", "#c2703d"),
    ("expense", "Housing", "#4a6fa5"),
    ("expense", "Transport", "#5b8c85"),
    ("expense", "Fun", "#b5577a"),
    ("expense", "Health", "#c44536"),
    ("expense", "Education", "#7a6aa8"),
    ("expense", "Shopping", "#a68a3d"),
    ("expense", "Other", "#8a8378"),
    ("income", "Salary", "#3f7d58"),
    ("income", "Freelance", "#6a9a4f"),
    ("income", "Other", "#8a8378"),
]


class Signup(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(max_length=200)
    password: str = Field(min_length=8, max_length=200)


class Login(BaseModel):
    email: str
    password: str


class Attempts:
    """Wrong passwords per email. After 5 in 15 minutes that email waits, so nobody can
    try passwords one after the other. Kept in memory: one instance is all this runs on."""

    LIMIT, WINDOW = 5, 15 * 60

    def __init__(self):
        self.failures: dict[str, list[float]] = {}

    def blocked(self, email: str) -> int:
        recent = [t for t in self.failures.get(email, []) if time.monotonic() - t < self.WINDOW]
        self.failures[email] = recent
        return int(self.WINDOW - (time.monotonic() - recent[0])) + 1 if len(recent) >= self.LIMIT else 0

    def failed(self, email: str):
        self.failures.setdefault(email, []).append(time.monotonic())

    def passed(self, email: str):
        self.failures.pop(email, None)


def start_session(conn, user_id: int, request: Request, response: Response):
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
                 (token_hash(token), user_id, expires))
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="strict",
                        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https")


def create_user(conn, name: str, email: str, password: str) -> int:
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = conn.execute("INSERT INTO users (name, email, password_hash) VALUES (%s, %s, %s) RETURNING id",
                        (name.strip(), email.strip(), hashed)).fetchone()
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO categories (user_id, kind, name, color) VALUES (%s, %s, %s, %s)",
                        [(user["id"], kind, name, color) for kind, name, color in STARTER])
    return user["id"]


@router.post("/signup", status_code=201)
def signup(body: Signup, request: Request, response: Response, conn=Depends(db)):
    if not EMAIL.match(body.email.strip()):
        raise HTTPException(422, "That email doesn't look right.")
    if conn.execute("SELECT 1 FROM users WHERE lower(email) = lower(%s)", (body.email.strip(),)).fetchone():
        raise HTTPException(409, "There's already an account with this email.")
    user_id = create_user(conn, body.name, body.email, body.password)
    start_session(conn, user_id, request, response)
    return {"id": user_id, "name": body.name.strip(), "email": body.email.strip()}


@router.post("/login")
def login(body: Login, request: Request, response: Response, conn=Depends(db)):
    email = body.email.strip().lower()
    attempts: Attempts = request.app.state.attempts
    wait = attempts.blocked(email)
    if wait:
        raise HTTPException(429, f"Too many wrong passwords. Try again in {wait // 60 + 1} minutes.",
                            headers={"Retry-After": str(wait)})
    user = conn.execute("SELECT id, name, email, password_hash FROM users WHERE lower(email) = %s", (email,)).fetchone()
    # bcrypt runs even when the email doesn't exist, so the time taken doesn't say which emails do
    stored = user["password_hash"].encode() if user else app_dummy_hash()
    if not bcrypt.checkpw(body.password.encode(), stored) or not user:
        attempts.failed(email)
        raise HTTPException(401, "Wrong email or password.")
    attempts.passed(email)
    start_session(conn, user["id"], request, response)
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


_dummy = None


def app_dummy_hash() -> bytes:
    global _dummy
    if _dummy is None:
        _dummy = bcrypt.hashpw(b"not a real password", bcrypt.gensalt())
    return _dummy


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, conn=Depends(db)):
    token = request.cookies.get(COOKIE)
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash(token),))
    response.delete_cookie(COOKIE)


@router.get("/me")
def me(user=Depends(current_user)):
    return user
