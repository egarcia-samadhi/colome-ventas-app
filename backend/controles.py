"""Panel de Controles -- pedido explícito de Ezequiel 2026-10-08: "igual que
en chakana-ventas necesito que en la hoja de controles se informe, si el
control de afip no da, y si hay jurisdicciones sin clasificar". Mismo patrón
que `Proviva - Ventas Chakana/backend/app/controles.py` (ver ahí la versión
completa con 8 controles) pero acotado a los 2 únicos chequeos que hoy
aplican a Colomé -- el resto de los controles de Chakana (Litros, Canal,
Productos, Países, Salidas de Inventario) dependen de tablas de Datos
Maestros que Colomé todavía no tiene.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request

from afip import calcular_cruce
from database import get_db
from ig_ventas import neto_por_jurisdiccion
from jurisdiccion import _mapa_jurisdiccion

router = APIRouter(prefix="/api/controles", tags=["controles"])


def require_admin(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return session


def _rango_a_chequear() -> tuple[date, date]:
    """Mismo rango que ya usa el Cruce AFIP (todos los períodos cargados en
    Info AFIP) -- reutiliza lo que ya está cacheado en disco en vez de pedir
    un rango nuevo. Si todavía no hay nada cargado en Info AFIP, cae a los 3
    últimos meses calendario completos (mismo criterio usado como default en
    otras hojas)."""
    conn = get_db()
    row = conn.execute(
        "SELECT MIN(periodo) AS primero, MAX(periodo) AS ultimo FROM afip_comprobantes"
    ).fetchone()
    conn.close()
    if row and row["primero"] and row["ultimo"]:
        anio, mes = int(row["primero"][:4]), int(row["primero"][5:7])
        desde = date(anio, mes, 1)
        anio, mes = int(row["ultimo"][:4]), int(row["ultimo"][5:7])
        hasta_excl = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
        return desde, hasta_excl - timedelta(days=1)

    hoy = date.today()
    anio, mes = (hoy.year, hoy.month - 3) if hoy.month > 3 else (hoy.year - 1, hoy.month + 9)
    desde = date(anio, mes, 1)
    anio, mes = (hoy.year, hoy.month - 1) if hoy.month > 1 else (hoy.year - 1, 12)
    hasta_excl = date(anio, mes + 1, 1) if mes < 12 else date(anio + 1, 1, 1)
    return desde, hasta_excl - timedelta(days=1)


@router.get("")
async def controles(admin=Depends(require_admin)):
    desde, hasta_incl = _rango_a_chequear()

    # Control 1: Cruce AFIP -- mismo criterio "ok" que la sub-pestaña Cruce
    # AFIP de Ctrl AFIP (tolerancia $1 por moneda), acá resumido a un solo
    # semáforo con el detalle de qué moneda no cierra.
    cruce = calcular_cruce()
    cruce_ok = cruce["tiene_datos_afip"] and all(d["ok"] for d in cruce["detalle"])

    # Control 2: Jurisdicciones sin clasificar -- cualquier n_provincia de
    # ig_ventas que todavía no está en jurisdiccion_mapa (Datos Maestros)
    # cae en "Sin clasificar" en vez de perderse o mostrarse crudo (pedido
    # explícito de Ezequiel 2026-10-08).
    mapa = _mapa_jurisdiccion()
    rows_crudas = neto_por_jurisdiccion(desde, hasta_incl)
    sin_clasificar: dict[str, int] = {}
    for r in rows_crudas:
        if r["jurisdiccion"] not in mapa:
            sin_clasificar[r["jurisdiccion"]] = sin_clasificar.get(r["jurisdiccion"], 0) + r.get("filas", 0)

    controles_lista = [
        {
            "id": "cruce_afip",
            "label": "Cruce AFIP",
            "descripcion": f"Compara, por moneda, toda la Info AFIP cargada ({desde.isoformat()} a {hasta_incl.isoformat()}) contra ig_ventas en vivo -- una diferencia real indica un comprobante no informado a AFIP, o Info AFIP de ese período sin cargar. Ver sub-pestaña \"Cruce AFIP\" en Ctrl AFIP para el detalle por período.",
            "ok": cruce_ok,
            "detalle": (
                "Todavía no hay Info AFIP cargada"
                if not cruce["tiene_datos_afip"]
                else "Al día" if cruce_ok
                else "; ".join(
                    f'{d["moneda"]} dif. {d["diferencia"]:,.2f}' for d in cruce["detalle"] if not d["ok"]
                )
            ),
        },
        {
            "id": "jurisdiccion_sin_clasificar",
            "label": "Jurisdicciones sin clasificar",
            "descripcion": f"Busca valores de provincia/país del comprobante ({desde.isoformat()} a {hasta_incl.isoformat()}) que no están cargados en Datos Maestros → Jurisdicción -- esas ventas caen en \"Sin clasificar\" en el reporte Ventas por Jurisdicción en vez de en su provincia o en \"Exterior\".",
            "ok": not sin_clasificar,
            "cantidad": len(sin_clasificar),
            "items": [
                {"valor": v, "filas": c}
                for v, c in sorted(sin_clasificar.items(), key=lambda x: -x[1])[:15]
            ],
        },
    ]

    return {
        "desde": desde.isoformat(),
        "hasta": hasta_incl.isoformat(),
        "controles": controles_lista,
    }
