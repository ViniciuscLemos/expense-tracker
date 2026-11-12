import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, categories, dashboard, demo, entries, goals, recurring, year
from .db import make_pool, migrate

UNSAFE = {"POST", "PATCH", "PUT", "DELETE"}


def create_app(database_url: str | None = None, demo_mode: bool | None = None, site: Path | None = None) -> FastAPI:
    pool = make_pool(database_url or os.environ["DATABASE_URL"])

    @asynccontextmanager
    async def lifespan(_app):
        yield
        pool.close()

    app = FastAPI(title="Expense Tracker API", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)
    app.state.pool = pool
    app.state.attempts = auth.Attempts()
    migrate(app.state.pool)

    app.state.demo = demo_mode if demo_mode is not None else os.environ.get("DEMO") == "true"
    if app.state.demo:
        demo.reset(app.state.pool)

    @app.middleware("http")
    async def same_site_only(request: Request, call_next):
        # Anything that changes data must come from this site's own JavaScript: a form on
        # another site can't set this header, and a fetch from another site that tries gets
        # stopped by the browser (there's no CORS here), so no CSRF.
        if request.method in UNSAFE and request.url.path.startswith("/api/") \
                and request.headers.get("x-requested-with") != "fetch":
            return JSONResponse({"detail": "Missing X-Requested-With: fetch."}, status_code=403)
        return await call_next(request)

    for module in (auth, categories, entries, recurring, dashboard, year, goals):
        app.include_router(module.router)

    @app.get("/api/health")
    def health():
        with app.state.pool.connection() as conn:
            conn.execute("SELECT 1")
        return {"ok": True}

    @app.get("/api/config")
    def config():
        return {"demo": {"email": demo.EMAIL, "password": demo.PASSWORD} if app.state.demo else None}

    # the React build, when there is one: the page and the API on the same address
    site = site or Path(os.environ.get("SITE_DIR", Path(__file__).resolve().parents[2] / "dist"))
    if (site / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=site / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def page(path: str):
            file = (site / path).resolve()
            if path and file.is_file() and site.resolve() in file.parents:
                return FileResponse(file)
            return FileResponse(site / "index.html")

    return app
