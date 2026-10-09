import os

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from jose import jwt, JWTError

# Secret compartido con el portal (colome-web) para validar la cookie SSO --
# mismo mecanismo que chakana-ventas/chakana-web. Esta app NUNCA ve
# SECRET_KEY (interno del portal), solo SSO_SECRET_KEY.
SSO_SECRET_KEY = os.environ["SSO_SECRET_KEY"]
PORTAL_URL = os.environ["PORTAL_URL"]
SELF_URL = os.environ["SELF_URL"]

ALGORITHM = "HS256"
SSO_COOKIE_NAME = "sso_session"
APP_SLUG = "ventas"

BASE_DIR = os.path.dirname(__file__)
# Export estático de Next.js -- TODA la app vive acá ahora (Ventas incluida,
# 2026-10-07: dejó de ser un mock separado, ver src/app/page.tsx del
# frontend). "/" = out/index.html, cada hoja nueva = out/<ruta>/index.html,
# y public/ventas/* (datos+JS portados del mock) quedan en out/ventas/*.
NEXT_DIR = os.path.join(BASE_DIR, "static_next")

NEXT_ROUTES = {"otros-analisis", "ctrl-afip", "budget", "controles", "datos-maestros"}

app = FastAPI()
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def cache_static_assets(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/_next/static/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


def get_sso_session(request: Request) -> dict | None:
    """Sesion SSO valida y con acceso a esta app, o None -- esta app no tiene
    login ni usuarios propios, el portal (colome-web) decide quien entra."""
    token = request.cookies.get(SSO_COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(token, SSO_SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    role = (payload.get("apps") or {}).get(APP_SLUG)
    if not role:
        return None
    return {**payload, "role": role}


@app.get("/api/auth/me")
async def me(request: Request):
    session = get_sso_session(request)
    if not session:
        return JSONResponse({"detail": "not authenticated"}, status_code=401)
    return {"email": session["sub"], "name": session.get("name"), "role": session["role"]}


# Debe registrarse ANTES del catch-all de abajo (FastAPI matchea rutas en
# orden de registro -- el catch-all "/{path:path}" tomaría /api/afip/* si
# se incluyera despues).
from database import init_db
from afip import router as afip_router
from jurisdiccion import router as jurisdiccion_router
from datos_maestros import router as datos_maestros_router
from controles import router as controles_router
from panel_ventas import router as panel_ventas_router
from otros_analisis import router as otros_analisis_router

init_db()
app.include_router(afip_router)
app.include_router(jurisdiccion_router)
app.include_router(datos_maestros_router)
app.include_router(controles_router)
app.include_router(panel_ventas_router)
app.include_router(otros_analisis_router)


@app.get("/{path:path}")
async def serve(request: Request, path: str):
    if not get_sso_session(request):
        next_url = f"{SELF_URL}/{path}" if path else SELF_URL
        return RedirectResponse(f"{PORTAL_URL}/?next={next_url}")

    if path in ("", "index.html"):
        return FileResponse(os.path.join(NEXT_DIR, "index.html"))

    primer_segmento = path.split("/", 1)[0]
    if primer_segmento in NEXT_ROUTES:
        resto = path[len(primer_segmento):].lstrip("/")
        if resto in ("", "index.html"):
            return FileResponse(os.path.join(NEXT_DIR, primer_segmento, "index.html"))
        candidato = os.path.join(NEXT_DIR, primer_segmento, resto)
        if os.path.isfile(candidato):
            return FileResponse(candidato)
        return FileResponse(os.path.join(NEXT_DIR, primer_segmento, "index.html"))

    # cualquier otro archivo estatico del export (_next/*, ventas/*,
    # favicon.ico, etc -- todo lo que vino de public/ o del build de Next).
    candidato = os.path.join(NEXT_DIR, path)
    if os.path.isfile(candidato):
        return FileResponse(candidato)

    return FileResponse(os.path.join(NEXT_DIR, "index.html"))
