"""Ctrl AFIP -> Ventas por Jurisdicción. Replica la hoja de chakana-ventas
(backend/app/jurisdiccion.py), adaptada a la fuente de datos real de Colomé:
Chakana usa la provincia de IIBB del comprobante del ERP Bejerman
(`cabventa.cveprv_Codigo`); Colomé no tiene ese ERP -- usa `ig_ventas`
(Oracle ORDS), que no tiene un campo de jurisdicción de IIBB separado, así
que se usa `n_provincia` (provincia del comprobante) como equivalente más
cercano. Igual que Chakana, los importes se muestran en la MONEDA ORIGINAL
del comprobante (ARS/USD, sin convertir todo a USD) -- es un reporte fiscal,
no de negocio. ig_ventas no trae comprobantes en EUR (solo t_moneda 'B'/'X'),
así que a diferencia de Chakana no hay columna EUR.

Mismo join/bajada ya validado el 2026-10-07 para el Cruce AFIP (día por día
+ dedupe GLOBAL) -- ver ig_ventas.py.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Query

from database import get_db
from ig_ventas import neto_por_jurisdiccion

router = APIRouter(prefix="/api/ventas", tags=["jurisdiccion"])


def _mapa_jurisdiccion() -> dict[str, str]:
    """valor_api (tal cual viene de ig_ventas, ej. 'ALEMANIA') -> concepto
    (ej. 'Exterior', o el propio nombre de la provincia). Ver datos_maestros.py."""
    conn = get_db()
    rows = conn.execute("SELECT valor_api, concepto FROM jurisdiccion_mapa").fetchall()
    conn.close()
    return {r["valor_api"]: r["concepto"] for r in rows}


def _aplicar_mapa(rows: list[dict], mapa: dict[str, str]) -> list[dict]:
    """Colapsa cada fila cruda (periodo, jurisdiccion=n_provincia) a su
    concepto mapeado (ej. todos los paises -> 'Exterior'), sumando ars/usd
    de las filas que caen en el mismo concepto. Un valor sin mapear todavia
    en jurisdiccion_mapa cae en 'Sin clasificar' (pedido explicito de
    Ezequiel 2026-10-08) en vez de mostrarse crudo o perderse."""
    acc: dict[tuple[str, str], dict[str, float]] = {}
    for r in rows:
        concepto = mapa.get(r["jurisdiccion"], "Sin clasificar")
        k = (r["periodo"], concepto)
        d = acc.setdefault(k, {"ars": 0.0, "usd": 0.0, "filas": 0})
        d["ars"] += r.get("ars", 0.0)
        d["usd"] += r.get("usd", 0.0)
        d["filas"] += r.get("filas", 0)
    out = [
        {"periodo": p, "jurisdiccion": c, **{kk: (round(vv, 2) if kk != "filas" else vv) for kk, vv in v.items()}}
        for (p, c), v in acc.items()
    ]
    out.sort(key=lambda r: (r["periodo"], r["jurisdiccion"]))
    return out


def require_reader(request: Request):
    """Mismo mecanismo SSO que afip.py::require_reader (deferred import para
    evitar el ciclo de imports con app.py)."""
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


def _mes_siguiente(periodo: str) -> str:
    anio, mes = (int(x) for x in periodo.split("-"))
    if mes == 12:
        return f"{anio + 1}-01"
    return f"{anio}-{mes + 1:02d}"


def _rango_mes(periodo: str) -> tuple[date, date]:
    anio, mes = int(periodo[:4]), int(periodo[5:7])
    desde = date(anio, mes, 1)
    hasta_excl = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    return desde, hasta_excl - timedelta(days=1)


@router.get("/jurisdiccion")
async def ventas_por_jurisdiccion(
    periodo: str | None = Query(None, description="YYYY-MM, filtra un solo mes calendario"),
    user=Depends(require_reader),
):
    if not periodo:
        # Sin filtro: mes calendario anterior al actual (mismo criterio que
        # el frontend, que siempre pide un período puntual por defecto).
        hoy = date.today()
        anio, mes = (hoy.year, hoy.month - 1) if hoy.month > 1 else (hoy.year - 1, 12)
        periodo = f"{anio}-{mes:02d}"

    desde, hasta_incl = _rango_mes(periodo)
    rows = neto_por_jurisdiccion(desde, hasta_incl)
    mapa = _mapa_jurisdiccion()
    rows = _aplicar_mapa(rows, mapa)
    return {"desde": desde.isoformat(), "hasta": hasta_incl.isoformat(), "rows": rows}
