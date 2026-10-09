"""Panel de Ventas / Ventas por Región -- conectado en vivo a ig_ventas
(2026-10-08, pedido explícito de Ezequiel: "el próximo paso es empezar a
armar el panel de ventas a partir de las ventas por mes que ya cruzamos con
AFIP"). Reemplaza el dataset mock estático (`public/ventas/colome-facts.json`,
jul-ago 2026) que consumía el frontend portado del mock -- mismo esquema
dims/facts exacto, así que `app.js` (portado tal cual del mock) no necesita
cambios, solo cambia de dónde sale el JSON.

Alcance de esta conexión (confirmado con Ezequiel): Panel de Ventas Y Ventas
por Región pasan juntos (comparten el mismo dataset/filtros en el frontend,
separarlos hubiera significado duplicar la capa de datos sin necesidad).
Sales Performance (SNAP) sigue siendo mock -- usa `colome-data.json`, un
dataset distinto, no tocado acá.

Rango: desde que hay datos reales en Redline (2025-09-01, ver
proyecto_colome_api_mapa) hasta hoy. Sin Budget/LY por ahora (pedido
explícito: "sacarlas" -- ig_ventas no trae presupuesto y LY solo está
completo desde sep-2026 en adelante, no alcanza para todo el rango)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request

from ig_ventas import facts_panel_ventas

router = APIRouter(prefix="/api/ventas", tags=["panel"])

DESDE_HISTORICO = date(2025, 9, 1)


def require_reader(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


@router.get("/panel")
async def panel_ventas(user=Depends(require_reader)):
    hoy = date.today()
    return facts_panel_ventas(DESDE_HISTORICO, hoy)
