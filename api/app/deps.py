import hashlib

from fastapi import Depends, HTTPException, Request

COOKIE = "session"


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def db(request: Request):
    """One connection and one transaction per request: everything a request writes goes in
    together, or nothing does if it fails halfway. Used with scope="function", so the commit
    happens before the answer goes out: otherwise the browser could ask for /api/me with
    the new session cookie before the session was saved."""
    with request.app.state.pool.connection() as conn:
        yield conn


def current_user(request: Request, conn=Depends(db, scope="function")) -> dict:
    token = request.cookies.get(COOKIE)
    user = token and conn.execute(
        "SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = %s AND s.expires_at > now()", (token_hash(token),)).fetchone()
    if not user:
        raise HTTPException(401, "Log in first.")
    return user
