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
  request (barato, es un solo mes de días).

- Por Cliente rediseñado 2026-11-02 (pedido de Ariel Culasso vía Ezequiel):
  ranking de clientes (ya no agrupado fijo por Vendedor), rango de fechas
  LIBRE en vez de un solo mes, y columna "Descuento Comercial" agregada
  (ver `ventas_por_cliente` en ig_ventas.py).

- Por SKU y Por Vendedor, mismo rediseño (2026-11-02, 2 pedidos más de
  Ariel Culasso el mismo día): las 3 vistas de Otros Análisis pasan a
  `desde`/`hasta` libre -- `periodo` (YYYY-MM) queda SOLO como el valor
  default cuando no se manda rango (mes calendario anterior, igual que
  antes). Ver `ventas_por_sku`/`ventas_por_vendedor` en ig_ventas.py para
  el detalle de qué cambió en cada una.

- Composición "por factura" en ventana flotante, agregada 2026-11-02 y
  SACADA del todo 2026-11-03 (mismo día, Ezequiel reemplazó el criterio en
  las 3 vistas -- ver el punto siguiente): el drill-down de las 3 pasó a
  ser agregado (Marca/Producto o Cliente), no un listado de facturas
  reales.

- Drill-down por Marca/Producto (Por Cliente) y por Cliente (Por SKU/Por
  Vendedor), agregado 2026-11-03 (pedido explícito de Ezequiel, 3
  mensajes el mismo día -- "el drill-down, no tiene que ser por factura,
  tiene que ser por marca - producto" para Por Cliente; "por sku, tenemos
  que aplicar el mismo criterio. el drill down es por cliente, no por
  factura"; "por ultimo, por vendedor, no hagas la apertura por factura"
  -- confirmado que el reemplazo es el mismo desglose por Cliente que Por
  SKU). `/por-cliente/marca-producto` y `/por-sku/cliente` (este último
  reusado por Por Vendedor con un `vendedor` opcional). Ver
  `ventas_cliente_por_marca_producto`/`ventas_producto_por_cliente` en
  ig_ventas.py."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ig_ventas import (
    desglose_por_grupo, ventas_cliente_por_marca_producto,
    ventas_por_cliente, ventas_por_sku, ventas_por_vendedor, ventas_producto_por_cliente,
)

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
    desde: str | None = Query(None, description="YYYY-MM-DD, default: inicio del mes calendario anterior"),
    hasta: str | None = Query(None, description="YYYY-MM-DD inclusive, default: fin del mes calendario anterior"),
    user=Depends(require_reader),
):
    # Rango de fechas LIBRE (pedido de Ariel Culasso vía Ezequiel
    # 2026-11-02: "el periodo debería permitirme seleccionar un rango de
    # fech[as]") -- reemplaza el selector de un solo mes calendario que
    # tenían las 3 vistas desde el 2026-10-19. Por SKU/Por Vendedor NO se
    # tocan, siguen con `periodo` mensual (Ariel pidió esto solo para Por
    # Cliente).
    if desde and hasta:
        desde_d, hasta_d = date.fromisoformat(desde), date.fromisoformat(hasta)
    else:
        desde_d, hasta_d = _rango_mes(_periodo_default())
    rows = ventas_por_cliente(desde_d, hasta_d)
    return {"desde": desde_d.isoformat(), "hasta": hasta_d.isoformat(), "rows": rows}


@router.get("/por-sku")
async def por_sku(
    desde: str | None = Query(None, description="YYYY-MM-DD, default: inicio del mes calendario anterior"),
    hasta: str | None = Query(None, description="YYYY-MM-DD inclusive, default: fin del mes calendario anterior"),
    user=Depends(require_reader),
):
    if desde and hasta:
        desde_d, hasta_d = date.fromisoformat(desde), date.fromisoformat(hasta)
    else:
        desde_d, hasta_d = _rango_mes(_periodo_default())
    rows = ventas_por_sku(desde_d, hasta_d)
    return {"desde": desde_d.isoformat(), "hasta": hasta_d.isoformat(), "rows": rows}


@router.get("/por-vendedor")
async def por_vendedor(
    desde: str | None = Query(None, description="YYYY-MM-DD, default: inicio del mes calendario anterior"),
    hasta: str | None = Query(None, description="YYYY-MM-DD inclusive, default: fin del mes calendario anterior"),
    user=Depends(require_reader),
):
    if desde and hasta:
        desde_d, hasta_d = date.fromisoformat(desde), date.fromisoformat(hasta)
    else:
        desde_d, hasta_d = _rango_mes(_periodo_default())
    rows = ventas_por_vendedor(desde_d, hasta_d)
    return {"desde": desde_d.isoformat(), "hasta": hasta_d.isoformat(), "rows": rows}


@router.get("/por-cliente/marca-producto")
async def por_cliente_marca_producto(
    desde: str = Query(..., description="YYYY-MM-DD"),
    hasta: str = Query(..., description="YYYY-MM-DD inclusive"),
    cliente: str = Query(...),
    user=Depends(require_reader),
):
    # Drill-down de Por Cliente (2026-11-03, pedido explícito de Ezequiel:
    # "el drill-down, no tiene que ser por factura, tiene que ser por
    # marca - producto") -- reemplaza el popup de composición por factura
    # que tenía Por Cliente.
    desde_d, hasta_d = date.fromisoformat(desde), date.fromisoformat(hasta)
    rows = ventas_cliente_por_marca_producto(desde_d, hasta_d, cliente)
    return {"rows": rows}


@router.get("/por-sku/cliente")
async def por_sku_cliente(
    desde: str = Query(..., description="YYYY-MM-DD"),
    hasta: str = Query(..., description="YYYY-MM-DD inclusive"),
    c_articulo: str = Query(...),
    vendedor: str | None = Query(None, description="Opcional -- Por Vendedor pasa la celda vendedor×artículo clickeada"),
    user=Depends(require_reader),
):
    # Drill-down de Por SKU (2026-11-03, pedido explícito de Ezequiel: "por
    # sku, tenemos que aplicar el mismo criterio. el drill down es por
    # cliente, no por factura") y de Por Vendedor, mismo día ("por ultimo,
    # por vendedor, no hagas la apertura por factura" -- mismo desglose,
    # con `vendedor` para acotar a la celda vendedor×artículo clickeada).
    desde_d, hasta_d = date.fromisoformat(desde), date.fromisoformat(hasta)
    rows = ventas_producto_por_cliente(desde_d, hasta_d, c_articulo, vendedor=vendedor)
    return {"rows": rows}
