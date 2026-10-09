"""Datos Maestros -> Jurisdicción. Pedido explícito de Ezequiel 2026-10-07:
"la tabla debería llevar el campo [n_provincia de ig_ventas], a una
provincia si es una provincia Argentina. y al campo exterior, si es un
país" -- corregido el mismo día ("no, tiene que ser una base de datos fija
y editable por el usuario", NO auto-sincronizada desde ig_ventas): esta es
una tabla de catálogo fija, cargada con las 24 provincias argentinas como
semilla y editable a mano (admin) -- alta, edición y baja de filas. El
admin la completa con los valores de `n_provincia` que vea en Ventas por
Jurisdicción, clasificándolos como "Provincia" o "Exterior".
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from database import get_db

router = APIRouter(prefix="/api/datos-maestros", tags=["datos-maestros"])


def require_admin(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return session


def require_reader(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


@router.get("/jurisdiccion")
async def listar_jurisdiccion_mapa(user=Depends(require_reader)):
    conn = get_db()
    rows = conn.execute(
        "SELECT valor_api, tipo, concepto FROM jurisdiccion_mapa ORDER BY tipo, valor_api"
    ).fetchall()
    conn.close()
    return {"rows": [dict(r) for r in rows]}


@router.post("/jurisdiccion")
async def agregar_jurisdiccion_mapa(body: dict, admin=Depends(require_admin)):
    valor_api = (body.get("valor_api") or "").strip()
    tipo = (body.get("tipo") or "").strip()
    concepto = (body.get("concepto") or "").strip()
    if not valor_api or tipo not in ("Provincia", "Exterior") or not concepto:
        raise HTTPException(status_code=400, detail="valor_api y concepto no pueden estar vacíos, tipo debe ser 'Provincia' o 'Exterior'")
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO jurisdiccion_mapa (valor_api, tipo, concepto) VALUES (?, ?, ?)",
            (valor_api, tipo, concepto),
        )
        conn.commit()
    except Exception:
        conn.close()
        raise HTTPException(status_code=409, detail=f"'{valor_api}' ya existe en la tabla")
    conn.close()
    return {"ok": True}


@router.put("/jurisdiccion/{valor_api}")
async def editar_jurisdiccion_mapa(valor_api: str, body: dict, admin=Depends(require_admin)):
    tipo = (body.get("tipo") or "").strip()
    concepto = (body.get("concepto") or "").strip()
    if tipo not in ("Provincia", "Exterior") or not concepto:
        raise HTTPException(status_code=400, detail="tipo debe ser 'Provincia' o 'Exterior', concepto no puede estar vacío")
    conn = get_db()
    cur = conn.execute(
        "UPDATE jurisdiccion_mapa SET tipo = ?, concepto = ? WHERE valor_api = ?",
        (tipo, concepto, valor_api),
    )
    conn.commit()
    actualizado = cur.rowcount > 0
    conn.close()
    if not actualizado:
        raise HTTPException(status_code=404, detail=f"No existe el valor '{valor_api}' en el mapa de jurisdicción")
    return {"ok": True}


@router.delete("/jurisdiccion/{valor_api}")
async def borrar_jurisdiccion_mapa(valor_api: str, admin=Depends(require_admin)):
    conn = get_db()
    cur = conn.execute("DELETE FROM jurisdiccion_mapa WHERE valor_api = ?", (valor_api,))
    conn.commit()
    borrado = cur.rowcount > 0
    conn.close()
    if not borrado:
        raise HTTPException(status_code=404, detail=f"No existe el valor '{valor_api}' en el mapa de jurisdicción")
    return {"ok": True}
