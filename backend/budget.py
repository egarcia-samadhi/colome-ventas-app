"""Budget -> lectura/edición real (agregado 2026-11-03, pedido explícito de
Ezequiel: "la hoja Budget no esta mostrando la tabla con el Budget actual
cargado. La idea es que se lea y edite desde ahí"). Antes el Budget (TOTAL
y por línea de negocio) vivía en 2 archivos JSON estáticos committeados al
repo (`budget_2026_2027.json`/`budget_linea_2026_2027.json`, fuente
Budget_Dinamico.xlsx de Ariel) -- `frontend/src/app/budget/page.tsx` era un
`<Placeholder>` sin pantalla real atrás.

**Mismo día, 2do pedido** (Ezequiel: "te quedaste corto con la vista del
budget, deberiamos cargar la hoja datos" -- la hoja "Datos" de
Budget_Dinamico.xlsx, 2.329 filas SKU×mes×Canal×Mercado, la granularidad
REAL detrás de los 2 JSON agregados). Verificado ANTES de cargarla (pedido
explícito: "verificá antes que no nos cambia el numero actual") que
agregar esa hoja por mes/línea reproduce EXACTO los 2 JSON ya cargados
(diferencia ≤ USD 0.01 por redondeo flotante, en los 12 meses) -- mismo
Mercado->línea que documenta snap.py.

**Diseño:** `budget_detalle` (sembrada desde `budget_detalle_2026_2027.json`,
ver database.py) pasa a ser la ÚNICA fuente editable -- "cada fila tenga un
boton de editar para cambiar los montos o cantidades". Total y Por Línea
NO son más tablas editables aparte: se calculan EN VIVO sumando
`budget_detalle`, para que nunca puedan desincronizarse de la fuente real
(mismo criterio de Ezequiel el 2026-11-02 sobre Sales Performance: "no
podemos usar fuentes distintas"). Las tablas `budget_mensual`/
`budget_linea_mensual` (del 1er pedido, mismo día) quedan en la DB sin
usarse -- nunca se borran, por si hace falta auditar el valor pre-detalle,
pero `get_budget_mensual()`/`get_budget_linea_mensual()` ya NO las leen.

`snap.py` (Panel de Ventas Budget TOTAL vía `_ly_mensual`, Sales
Performance Budget por línea vía `ventas_sbl`) sigue leyendo
`get_budget_mensual()`/`get_budget_linea_mensual()` de acá -- mismo nombre,
mismo shape de retorno, no hizo falta tocar nada de snap.py en este 2do
pedido tampoco.

Cache en memoria invalidado en cada escritura -- y como el Budget alimenta
filas YA CACHEADAS de SNAP (`ventas_sbl` incluye `usd_bud`/`lit_bud` por
línea, cacheadas en disco por `snap.py::SNAP_RANGE_CACHE`), toda escritura
acá también invalida ESE cache (`snap.limpiar_snap_cache()`)."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from database import get_db

router = APIRouter(prefix="/api/budget", tags=["budget"])

# Mismas 7 líneas que ya usa snap.py (DTC_LINEAS_FIJAS + los 2 agregados
# top, Domestic/Export).
LINEAS_VALIDAS = [
    "Employees", "E-commerce", "Colome Hotel", "Colome Visitor Center", "Cafayate Visitor Center",
    "Grupo Colome Domestic", "Grupo Colome Export",
]

# Clasificación Mercado -> línea de negocio -- MISMO criterio documentado en
# snap.py (ver docstring de `_budget_linea_mensual` ahí), portado acá
# porque ahora la línea se deriva EN VIVO de `budget_detalle.mercado` en
# vez de venir ya clasificada en un JSON aparte. "Employees" no tiene
# `Mercado` propio en la hoja real -- queda en 0 si no aparece en
# `budget_detalle` (ningún valor de Mercado mapea a Employees).
MERCADO_A_LINEA = {
    "Distrib. Bs. As.": "Grupo Colome Domestic",
    "Interior": "Grupo Colome Domestic",
    "Distrib. NOA": "Grupo Colome Domestic",
    "HCVC - Hotel": "Colome Hotel",
    "HCVC - VC Col": "Colome Visitor Center",
    "HCVC - VC Cafa": "Cafayate Visitor Center",
    "E-commerce": "E-commerce",
    "UE": "Grupo Colome Export", "Brasil": "Grupo Colome Export", "Reino Unido": "Grupo Colome Export",
    "USA": "Grupo Colome Export", "Suiza": "Grupo Colome Export", "Asia": "Grupo Colome Export",
    "Canadá": "Grupo Colome Export", "Resto L.A.": "Grupo Colome Export", "Caribe": "Grupo Colome Export",
    "México": "Grupo Colome Export",
}

# Mercado -> ZONA (2026-11-03, mismo día, pedido de Ezequiel de encolumnar
# Ventas por Región igual que "Sales by Market" del SNAP real): mismos 17
# valores crudos de `budget_detalle.mercado` que `MERCADO_A_LINEA` arriba,
# pero clasificados a zona (`region_agrupante_mapa`/`pais_zona_mapa`, ver
# datos_maestros.py) en vez de línea de negocio -- NO hay granularidad de
# Budget por país individual (confirmado: el Budget real agrupa en baldes
# gruesos UE/Asia/Caribe/Resto L.A., no Alemania/Francia sueltos), así que
# la tabla de Sales by Market usa el mismo nivel de zona que ya existe en
# Datos Maestros -> Agrupante de Región, no una granularidad que el Budget
# no puede poblar.
MERCADO_A_ZONA = {
    "Distrib. Bs. As.": "BUENOS AIRES",
    "Interior": "INTERIOR",
    "Distrib. NOA": "NOA",
    "HCVC - Hotel": "DTC",
    "HCVC - VC Col": "DTC",
    "HCVC - VC Cafa": "DTC",
    "E-commerce": "DTC",
    "USA": "UNITED STATES",
    "Canadá": "CANADA",
    "México": "CARIBBEAN",
    "Caribe": "CARIBBEAN",
    "Brasil": "LATIN AMERICA",
    "Resto L.A.": "LATIN AMERICA",
    "Suiza": "EUROPE",
    "UE": "EUROPE",
    "Reino Unido": "UK",
    "Asia": "ASIA",
}

_budget_cache: dict[str, list[float]] | None = None
_budget_linea_cache: dict[str, dict[str, list[float]]] | None = None
_budget_zona_cache: dict[str, dict[str, list[float]]] | None = None


def get_budget_mercado_mensual() -> dict[str, dict[str, list[float]]]:
    """{periodo: {zona: [usd, cajas]}} -- mismo criterio que
    `get_budget_linea_mensual()` pero clasificado por `MERCADO_A_ZONA` en
    vez de `MERCADO_A_LINEA`. Consumido por `snap.py::_agregado_mercado_budget()`
    (Budget de Sales by Market / Ventas por Región)."""
    global _budget_zona_cache
    if _budget_zona_cache is None:
        conn = get_db()
        rows = conn.execute("SELECT periodo, mercado, cajas, usd FROM budget_detalle").fetchall()
        conn.close()
        out: dict[str, dict[str, list[float]]] = {}
        for r in rows:
            zona = MERCADO_A_ZONA.get(r["mercado"])
            if zona is None:
                continue
            a = out.setdefault(r["periodo"], {}).setdefault(zona, [0.0, 0.0])
            a[0] += r["usd"]
            a[1] += r["cajas"]
        _budget_zona_cache = out
    return _budget_zona_cache


def _agregar_desde_detalle() -> tuple[dict[str, list[float]], dict[str, dict[str, list[float]]]]:
    conn = get_db()
    rows = conn.execute("SELECT periodo, mercado, cajas, usd FROM budget_detalle").fetchall()
    conn.close()
    total: dict[str, list[float]] = {}
    linea: dict[str, dict[str, list[float]]] = {}
    for r in rows:
        t = total.setdefault(r["periodo"], [0.0, 0.0])
        t[0] += r["usd"]
        t[1] += r["cajas"]
        l = MERCADO_A_LINEA.get(r["mercado"])
        if l is None:
            continue
        a = linea.setdefault(r["periodo"], {}).setdefault(l, [0.0, 0.0])
        a[0] += r["usd"]
        a[1] += r["cajas"]
    return total, linea


def get_budget_mensual() -> dict[str, list[float]]:
    """{periodo: [usd, cajas]} -- mismo shape que el JSON original, consumido
    por `snap.py::_ly_mensual()` (Budget TOTAL de Panel de Ventas). Ahora
    calculado EN VIVO sumando `budget_detalle` (ver docstring del módulo)."""
    global _budget_cache, _budget_linea_cache
    if _budget_cache is None:
        _budget_cache, _budget_linea_cache = _agregar_desde_detalle()
    return _budget_cache


def get_budget_linea_mensual() -> dict[str, dict[str, list[float]]]:
    """{periodo: {linea: [usd, cajas]}} -- mismo shape que el JSON original,
    consumido por `snap.py::_agregado_budget_linea()` (Budget por línea de
    Sales Performance). Ahora calculado EN VIVO sumando `budget_detalle`."""
    global _budget_cache, _budget_linea_cache
    if _budget_linea_cache is None:
        _budget_cache, _budget_linea_cache = _agregar_desde_detalle()
    return _budget_linea_cache


def _invalidar_cache() -> None:
    global _budget_cache, _budget_linea_cache, _budget_zona_cache
    _budget_cache = None
    _budget_linea_cache = None
    _budget_zona_cache = None
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
    misma fila (solo lectura, ver /detalle para la edición real)."""
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


@router.get("/detalle")
async def listar_budget_detalle(periodo: str | None = Query(None), user=Depends(require_reader)):
    conn = get_db()
    campos = "id, periodo, mes, sku, codigo, descripcion, canal, mercado, bloque, medida, cajas, usd, pesos, tc"
    if periodo:
        rows = conn.execute(
            f"SELECT {campos} FROM budget_detalle WHERE periodo = ? ORDER BY sku, canal, mercado",
            (periodo,),
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {campos} FROM budget_detalle ORDER BY periodo, sku, canal, mercado"
        ).fetchall()
    conn.close()
    return {"rows": [dict(r) for r in rows]}


@router.put("/detalle/{id}")
async def editar_budget_detalle(id: int, body: dict, admin=Depends(require_admin)):
    cajas, usd = body.get("cajas"), body.get("usd")
    if cajas is None or usd is None:
        raise HTTPException(status_code=400, detail="cajas y usd son obligatorios")
    conn = get_db()
    cur = conn.execute(
        "UPDATE budget_detalle SET cajas = ?, usd = ? WHERE id = ?",
        (float(cajas), float(usd), id),
    )
    conn.commit()
    actualizado = cur.rowcount > 0
    conn.close()
    if not actualizado:
        raise HTTPException(status_code=404, detail=f"No existe la fila id={id}")
    _invalidar_cache()
    return {"ok": True}
