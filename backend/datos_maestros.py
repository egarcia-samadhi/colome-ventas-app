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


# SNAP -> Sales by Line of Business: clasifica centro_costo/categoria/
# canal_venta a una línea nombrada de "Direct-to-consumer Channel" -- ver
# snap.py y database.py (tabla snap_linea_negocio_mapa).
@router.get("/snap-linea-negocio")
async def listar_snap_linea_negocio(user=Depends(require_reader)):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, centro_costo, categoria, canal_venta, linea_negocio FROM snap_linea_negocio_mapa ORDER BY linea_negocio"
    ).fetchall()
    conn.close()
    return {"rows": [dict(r) for r in rows]}


@router.get("/snap-linea-negocio/sin-clasificar")
async def listar_snap_sin_clasificar(user=Depends(require_reader)):
    """Combinaciones DTC/Hospitalidad que hoy caen en "Otro DTC/Hospitalidad"
    por no matchear ninguna regla -- para que el admin agregue la que falta."""
    from datetime import date, timedelta
    from snap import combos_sin_clasificar
    hoy = date.today()
    anio, mes = (hoy.year, hoy.month - 1) if hoy.month > 1 else (hoy.year - 1, 12)
    desde = date(anio, mes, 1)
    hasta_excl = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    combos = combos_sin_clasificar(desde, hasta_excl - timedelta(days=1))
    return {"desde": desde.isoformat(), "hasta": (hasta_excl - timedelta(days=1)).isoformat(), "combos": combos}


def _validar_snap_body(body: dict) -> tuple[str | None, str | None, str | None, str]:
    centro_costo = (body.get("centro_costo") or "").strip() or None
    categoria = (body.get("categoria") or "").strip() or None
    canal_venta = (body.get("canal_venta") or "").strip() or None
    linea_negocio = (body.get("linea_negocio") or "").strip()
    if not linea_negocio:
        raise HTTPException(status_code=400, detail="linea_negocio no puede estar vacío")
    if not (centro_costo or categoria or canal_venta):
        raise HTTPException(status_code=400, detail="al menos un campo (centro_costo/categoria/canal_venta) tiene que estar completo")
    return centro_costo, categoria, canal_venta, linea_negocio


@router.post("/snap-linea-negocio")
async def agregar_snap_linea_negocio(body: dict, admin=Depends(require_admin)):
    centro_costo, categoria, canal_venta, linea_negocio = _validar_snap_body(body)
    conn = get_db()
    conn.execute(
        "INSERT INTO snap_linea_negocio_mapa (centro_costo, categoria, canal_venta, linea_negocio) VALUES (?, ?, ?, ?)",
        (centro_costo, categoria, canal_venta, linea_negocio),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.put("/snap-linea-negocio/{id}")
async def editar_snap_linea_negocio(id: int, body: dict, admin=Depends(require_admin)):
    centro_costo, categoria, canal_venta, linea_negocio = _validar_snap_body(body)
    conn = get_db()
    cur = conn.execute(
        "UPDATE snap_linea_negocio_mapa SET centro_costo=?, categoria=?, canal_venta=?, linea_negocio=? WHERE id=?",
        (centro_costo, categoria, canal_venta, linea_negocio, id),
    )
    conn.commit()
    actualizado = cur.rowcount > 0
    conn.close()
    if not actualizado:
        raise HTTPException(status_code=404, detail=f"No existe la regla id={id}")
    return {"ok": True}


@router.delete("/snap-linea-negocio/{id}")
async def borrar_snap_linea_negocio(id: int, admin=Depends(require_admin)):
    conn = get_db()
    cur = conn.execute("DELETE FROM snap_linea_negocio_mapa WHERE id=?", (id,))
    conn.commit()
    borrado = cur.rowcount > 0
    conn.close()
    if not borrado:
        raise HTTPException(status_code=404, detail=f"No existe la regla id={id}")
    return {"ok": True}


# Panel de Ventas -> filtro previo "Agrupante de Canal": pedido explícito de
# Ariel Culasso vía Ezequiel 2026-10-21 -- agrupar los 18 valores crudos de
# canal_venta en un filtro previo (Vinotecas, Distribuidores, etc.) SIN
# sacar el filtro de Canal existente (ver canal_agrupante_mapa en
# database.py y el uso en panel_ventas.py/controles.py).
def get_canal_agrupante_map() -> dict[str, str]:
    conn = get_db()
    rows = conn.execute("SELECT canal_venta, agrupante FROM canal_agrupante_mapa").fetchall()
    conn.close()
    return {r["canal_venta"]: r["agrupante"] for r in rows}


@router.get("/canal-agrupante")
async def listar_canal_agrupante(user=Depends(require_reader)):
    conn = get_db()
    rows = conn.execute(
        "SELECT canal_venta, agrupante FROM canal_agrupante_mapa ORDER BY agrupante, canal_venta"
    ).fetchall()
    conn.close()
    return {"rows": [dict(r) for r in rows]}


@router.post("/canal-agrupante")
async def agregar_canal_agrupante(body: dict, admin=Depends(require_admin)):
    canal_venta = (body.get("canal_venta") or "").strip()
    agrupante = (body.get("agrupante") or "").strip()
    if not canal_venta or not agrupante:
        raise HTTPException(status_code=400, detail="canal_venta y agrupante no pueden estar vacíos")
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO canal_agrupante_mapa (canal_venta, agrupante) VALUES (?, ?)",
            (canal_venta, agrupante),
        )
        conn.commit()
    except Exception:
        conn.close()
        raise HTTPException(status_code=409, detail=f"'{canal_venta}' ya existe en la tabla")
    conn.close()
    return {"ok": True}


@router.put("/canal-agrupante/{canal_venta}")
async def editar_canal_agrupante(canal_venta: str, body: dict, admin=Depends(require_admin)):
    agrupante = (body.get("agrupante") or "").strip()
    if not agrupante:
        raise HTTPException(status_code=400, detail="agrupante no puede estar vacío")
    conn = get_db()
    cur = conn.execute(
        "UPDATE canal_agrupante_mapa SET agrupante = ? WHERE canal_venta = ?",
        (agrupante, canal_venta),
    )
    conn.commit()
    actualizado = cur.rowcount > 0
    conn.close()
    if not actualizado:
        raise HTTPException(status_code=404, detail=f"No existe el canal '{canal_venta}' en el mapa de agrupantes")
    return {"ok": True}


@router.delete("/canal-agrupante/{canal_venta}")
async def borrar_canal_agrupante(canal_venta: str, admin=Depends(require_admin)):
    conn = get_db()
    cur = conn.execute("DELETE FROM canal_agrupante_mapa WHERE canal_venta = ?", (canal_venta,))
    conn.commit()
    borrado = cur.rowcount > 0
    conn.close()
    if not borrado:
        raise HTTPException(status_code=404, detail=f"No existe el canal '{canal_venta}' en el mapa de agrupantes")
    return {"ok": True}
