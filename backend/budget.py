"""Budget -> lectura/edición real (agregado 2026-11-03, pedido explícito de
Ezequiel: "la hoja Budget no esta mostrando la tabla con el Budget actual
cargado. La idea es que se lea y edite desde ahí"). Antes el Budget (TOTAL
y por línea de negocio) vivía en 2 archivos JSON estáticos committeados al
repo (`budget_2026_2027.json`/`budget_linea_2026_2027.json`, fuente
Budget_Dinamico.xlsx de Ariel, ver snap.py) -- `frontend/src/app/budget/
page.tsx` era un `<Placeholder>` sin pantalla real atrás.

Se migran a 2 tablas en DB (`budget_mensual`/`budget_linea_mensual`,
sembradas desde esos mismos JSON la primera vez que corre `init_db()`, ver
database.py), editables desde acá -- mismo patrón CRUD que Datos Maestros
(admin edita, cualquier sesión lee). `snap.py` (Panel de Ventas Budget
TOTAL vía `_ly_mensual`, Sales Performance Budget por línea vía
`ventas_sbl`) pasa a leer `get_budget_mensual()`/`get_budget_linea_mensual()`
de acá en vez de los JSON directo -- mismo shape de retorno, no hizo falta
tocar el resto de snap.py.

Cache en memoria (mismo patrón que el resto del proyecto) invalidado en
cada escritura -- y como el Budget alimenta filas YA CACHEADAS de SNAP
(`ventas_sbl` incluye `usd_bud`/`lit_bud` por línea, cacheadas en disco por
`snap.py::SNAP_RANGE_CACHE`), toda escritura acá también invalida ESE
cache (`snap.limpiar_snap_cache()`) -- si no, Sales Performance seguiría
mostrando el Budget viejo para meses ya cerrados hasta que cambiara el mes
disponible."""
from fastapi import APIRouter, Depends, HTTPException, Request

from database import get_db

router = APIRouter(prefix="/api/budget", tags=["budget"])

# Mismas 7 líneas que ya usa snap.py (DTC_LINEAS_FIJAS + los 2 agregados
# top, Domestic/Export) -- el Budget por línea solo tiene sentido sobre
# este conjunto fijo, no sobre cualquier string.
LINEAS_VALIDAS = [
    "Employees", "E-commerce", "Colome Hotel", "Colome Visitor Center", "Cafayate Visitor Center",
    "Grupo Colome Domestic", "Grupo Colome Export",
]

_budget_cache: dict[str, list[float]] | None = None
_budget_linea_cache: dict[str, dict[str, list[float]]] | None = None


def get_budget_mensual() -> dict[str, list[float]]:
    """{periodo: [usd, cajas]} -- mismo shape que el JSON original, consumido
    por `snap.py::_ly_mensual()` (Budget TOTAL de Panel de Ventas)."""
    global _budget_cache
    if _budget_cache is None:
        conn = get_db()
        rows = conn.execute("SELECT periodo, usd, cajas FROM budget_mensual").fetchall()
        conn.close()
        _budget_cache = {r["periodo"]: [r["usd"], r["cajas"]] for r in rows}
    return _budget_cache


def get_budget_linea_mensual() -> dict[str, dict[str, list[float]]]:
    """{periodo: {linea: [usd, cajas]}} -- mismo shape que el JSON original,
    consumido por `snap.py::_agregado_budget_linea()` (Budget por línea de
    Sales Performance)."""
    global _budget_linea_cache
    if _budget_linea_cache is None:
        conn = get_db()
        rows = conn.execute("SELECT periodo, linea, usd, cajas FROM budget_linea_mensual").fetchall()
        conn.close()
        out: dict[str, dict[str, list[float]]] = {}
        for r in rows:
            out.setdefault(r["periodo"], {})[r["linea"]] = [r["usd"], r["cajas"]]
        _budget_linea_cache = out
    return _budget_linea_cache


def _invalidar_cache() -> None:
    global _budget_cache, _budget_linea_cache
    _budget_cache = None
    _budget_linea_cache = None
    from snap import limpiar_snap_cache
    limpiar_snap_cache()


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


@router.get("")
async def listar_budget(user=Depends(require_reader)):
    """1 fila por período del ejercicio -- Total + desglose por línea en la
    misma fila, para que el frontend arme 1 sola tabla editable."""
    total = get_budget_mensual()
    linea = get_budget_linea_mensual()
    periodos = sorted(set(total.keys()) | set(linea.keys()))
    return {
        "lineas": LINEAS_VALIDAS,
        "periodos": [
            {
                "periodo": p,
                "usd": total.get(p, [0.0, 0.0])[0],
                "cajas": total.get(p, [0.0, 0.0])[1],
                "por_linea": {l: linea.get(p, {}).get(l, [0.0, 0.0]) for l in LINEAS_VALIDAS},
            }
            for p in periodos
        ],
    }


@router.put("/{periodo}")
async def editar_budget_total(periodo: str, body: dict, admin=Depends(require_admin)):
    usd, cajas = body.get("usd"), body.get("cajas")
    if usd is None or cajas is None:
        raise HTTPException(status_code=400, detail="usd y cajas son obligatorios")
    conn = get_db()
    conn.execute(
        "INSERT INTO budget_mensual (periodo, usd, cajas) VALUES (?, ?, ?) "
        "ON CONFLICT(periodo) DO UPDATE SET usd=excluded.usd, cajas=excluded.cajas",
        (periodo, float(usd), float(cajas)),
    )
    conn.commit()
    conn.close()
    _invalidar_cache()
    return {"ok": True}


@router.put("/{periodo}/linea/{linea}")
async def editar_budget_linea(periodo: str, linea: str, body: dict, admin=Depends(require_admin)):
    if linea not in LINEAS_VALIDAS:
        raise HTTPException(status_code=400, detail=f"línea inválida, debe ser una de: {', '.join(LINEAS_VALIDAS)}")
    usd, cajas = body.get("usd"), body.get("cajas")
    if usd is None or cajas is None:
        raise HTTPException(status_code=400, detail="usd y cajas son obligatorios")
    conn = get_db()
    conn.execute(
        "INSERT INTO budget_linea_mensual (periodo, linea, usd, cajas) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(periodo, linea) DO UPDATE SET usd=excluded.usd, cajas=excluded.cajas",
        (periodo, linea, float(usd), float(cajas)),
    )
    conn.commit()
    conn.close()
    _invalidar_cache()
    return {"ok": True}
