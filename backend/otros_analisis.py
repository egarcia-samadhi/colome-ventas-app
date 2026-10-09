"""Otros Análisis -> Desglose por grupo (2026-10-08, pedido explícito de
Ezequiel): "llevemos a un desglose de ventas a otros análisis... enviemos
ahí el desglose del 100% de las ventas que cruzan con AFIP". A diferencia
de Panel de Ventas (que filtra `d_grupo == "VINOS **"`, el universo oficial
de "Ventas" para la empresa -- ver ig_ventas.py), acá se muestra el 100%
de las líneas (VINOS + INSUMOS + SERVICIOS) que concilian con AFIP, para
que se vea explícitamente qué queda afuera de "Ventas" y por qué el total
facturado no coincide con el Panel de Ventas."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request

from ig_ventas import desglose_por_grupo

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
