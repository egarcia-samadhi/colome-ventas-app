"""Hoja Auditoría -- replica el patrón ya documentado (regla de oro #33 en
00-Normas-de-Trabajo.md, ver también memoria feedback_patron_pantalla_
auditoria_linea_a_linea.md): pantalla propia, admin-only, 2 inputs de fecha
(rango libre) + botón "Descargar Excel", sin grilla en pantalla.

Fuente: ig_ventas.filas_auditoria(), la fuente más cruda del proyecto --
el 100% de las filas del rango, SIN el filtro TIPOS_VALIDOS (que sí aplican
Cruce AFIP/Ventas por Jurisdicción) ni el filtro GRUPO_VALIDO (que sí aplica
Panel de Ventas), para poder respaldar cualquier número de cualquier
pantalla, incluidas esas dos clasificaciones en sí mismas.

Columnas: todas las de CAMPOS_USADOS (ig_ventas.py) + periodo_real (mes
calendario real, igual que usa cada pantalla) + jurisdiccion_concepto
(mapeo ya cargado en Datos Maestros -> Jurisdicción, mismo lookup que usa
Ctrl AFIP -> Ventas por Jurisdicción). NO se suma linea_negocio (Sales
Performance / snap_linea_negocio_mapa): esa pantalla sigue siendo mock y la
lógica de matching centro_costo/categoria/canal todavía no está resuelta
(pendiente decidir DCBA/Interior) -- sumarla acá sería inventar una regla
que no existe en el modelo real todavía.
"""
import io
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell

from ig_ventas import filas_auditoria
from jurisdiccion import _mapa_jurisdiccion

router = APIRouter(prefix="/api/auditoria", tags=["auditoria"])

DESDE_HISTORICO = date(2025, 9, 1)

COLUMNAS = [
    ("periodo_real", "Período"),
    ("fecha", "Fecha"),
    ("id", "ID"),
    ("det_id", "Det. ID"),
    ("d_tipo_compro", "Tipo comprobante"),
    ("d_comprobante", "Comprobante"),
    ("numero", "Número"),
    ("r_cae", "CAE"),
    ("t_moneda", "Moneda"),
    ("valor_mon_loc", "Valor ARS"),
    ("valor_venta_mon_ext", "Valor USD (venta ext.)"),
    ("valor_venta_mon_alt", "Valor USD (venta alt.)"),
    ("costo_unit_mon_alt", "Costo unit. USD"),
    ("cantidad", "Cantidad"),
    ("cantidad_cajas9l", "Cajas 9L"),
    ("d_grupo", "Grupo"),
    ("d_rubro", "Rubro"),
    ("d_marca", "Marca"),
    ("d_categoria", "Categoría"),
    ("d_canal_venta", "Canal de venta"),
    ("d_oficina", "Oficina"),
    ("d_zona_comercial", "Zona comercial"),
    ("n_provincia", "Provincia (cruda)"),
    ("jurisdiccion_concepto", "Jurisdicción (mapeada)"),
    ("d_pais", "País"),
    ("n_cliente", "Cliente"),
]


def require_admin(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return session


@router.get("/export")
async def exportar(
    desde: date = Query(...),
    hasta: date = Query(...),
    admin=Depends(require_admin),
):
    if hasta < desde:
        raise HTTPException(status_code=400, detail="'hasta' no puede ser anterior a 'desde'")

    def _generar() -> bytes:
        mapa = _mapa_jurisdiccion()
        wb = Workbook(write_only=True)
        ws = wb.create_sheet("Auditoría")
        ws.append([label for _, label in COLUMNAS])

        def celda(valor, texto=False, fecha=False):
            c = WriteOnlyCell(ws, value=valor)
            if texto:
                c.number_format = "@"
            elif fecha:
                c.number_format = "d/m/yyyy"
            return c

        for it in filas_auditoria(desde, hasta):
            it["jurisdiccion_concepto"] = mapa.get(it.get("n_provincia"), "Sin clasificar")
            fila = []
            for campo, _ in COLUMNAS:
                v = it.get(campo)
                if campo == "fecha" and v:
                    try:
                        v = datetime.fromisoformat(v[:19])
                        fila.append(celda(v, fecha=True))
                        continue
                    except ValueError:
                        pass
                if campo in ("id", "det_id", "numero", "r_cae"):
                    fila.append(celda(v, texto=True))
                else:
                    fila.append(v)
            ws.append(fila)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    contenido = await run_in_threadpool(_generar)
    nombre = f"auditoria_{desde.isoformat()}_{hasta.isoformat()}.xlsx"
    return StreamingResponse(
        io.BytesIO(contenido),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={nombre}"},
    )
