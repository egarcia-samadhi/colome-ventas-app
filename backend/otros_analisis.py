"""Otros Análisis.

- Desglose por grupo (2026-10-08, pedido explícito de Ezequiel): "llevemos
  un desglose de ventas a otros análisis... enviemos ahí el desglose del
  100% de las ventas que cruzan con AFIP". A diferencia de Panel de Ventas
  (que filtra `d_grupo == "VINOS **"`, el universo oficial de "Ventas" para
  la empresa -- ver ig_ventas.py), acá se muestra el 100% de las líneas
  (VINOS + INSUMOS + SERVICIOS) que concilian con AFIP.

- Por Cliente / Por SKU / Por Vendedor (2026-10-19, pedido explícito de
  Ezequiel): réplica de las hojas homónimas de Operaciones_de_Ventas.xlsx
  (cuadro mensual que se reporta a Colomé). A diferencia del desglose por
  grupo, estas 3 SÍ filtran `d_grupo == "VINOS **"` (es el universo real de
  "Ventas" del Excel original, confirmado 2026-10-08 en ig_ventas.py).
  Mismo patrón de un-solo-mes que Ctrl AFIP -> Ventas por Jurisdicción
  (jurisdiccion.py): sin cache de agregado histórico, se recalcula por
  request (barato, es un solo mes de días)."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ig_ventas import desglose_por_grupo, ventas_por_cliente, ventas_por_sku, ventas_por_vendedor

router = APIRouter(prefix="/api/otros-analisis", tags=["otros-analisis"])

DESDE_HISTORICO = date(2025, 9, 1)


def require_reader(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


@router.get("/desglose-grupo")
async def desglose_grupo(user=Depends(require_reader)):
    rows = desglose_por_grupo(DESDE_HISTORICO, date.today())
    return {"desde": DESDE_HISTORICO.isoformat(), "rows": rows}


def _rango_mes(periodo: str) -> tuple[date, date]:
    anio, mes = int(periodo[:4]), int(periodo[5:7])
    desde = date(anio, mes, 1)
    hasta_excl = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    return desde, hasta_excl - timedelta(days=1)


def _periodo_default() -> str:
    """Sin filtro: mes calendario anterior al actual (mismo criterio que
    jurisdiccion.py -- el mes en curso todavía está incompleto)."""
    hoy = date.today()
    anio, mes = (hoy.year, hoy.month - 1) if hoy.month > 1 else (hoy.year - 1, 12)
    return f"{anio}-{mes:02d}"


@router.get("/por-cliente")
async def por_cliente(
    periodo: str | None = Query(None, description="YYYY-MM, filtra un solo mes calendario"),
    user=Depends(require_reader),
):
    periodo = periodo or _periodo_default()
    desde, hasta_incl = _rango_mes(periodo)
    rows = ventas_por_cliente(desde, hasta_incl)
    return {"periodo": periodo, "rows": rows}


@router.get("/por-sku")
async def por_sku(
    periodo: str | None = Query(None, description="YYYY-MM, filtra un solo mes calendario"),
    user=Depends(require_reader),
):
    periodo = periodo or _periodo_default()
    desde, hasta_incl = _rango_mes(periodo)
    rows = ventas_por_sku(desde, hasta_incl)
    return {"periodo": periodo, "rows": rows}


@router.get("/por-vendedor")
async def por_vendedor(
    periodo: str | None = Query(None, description="YYYY-MM, filtra un solo mes calendario"),
    user=Depends(require_reader),
):
    periodo = periodo or _periodo_default()
    desde, hasta_incl = _rango_mes(periodo)
    rows = ventas_por_vendedor(desde, hasta_incl)
    return {"periodo": periodo, "rows": rows}
