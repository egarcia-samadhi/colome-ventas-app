"""Ctrl AFIP -> Info AFIP. Replica del mecanismo de chakana-ventas
(backend/app/afip.py) para Colomé: carga mensual del export real de AFIP
("Mis Comprobantes") vía plantilla Excel -- el usuario descarga el modelo
(GET /api/afip/plantilla), pega ahí el export de AFIP y sube el archivo
(POST /api/afip/importar, multipart). Mismas 4 columnas calculadas al
importar (NO son datos crudos de AFIP):

- `Periodo`: mes calendario de la Fecha del comprobante (YYYY-MM).
- `Credito?`: "Si" si el Tipo es una Nota de Crédito, "No" en caso contrario.
- `Monto`: si Moneda es "$" (ARS), es el Imp. Neto Gravado; para cualquier
  otra moneda, el Imp. Total.
- `Valor doc`: Monto con signo -- negativo si Credito?="Si".

Idempotente: reimportar el mismo comprobante lo actualiza, no lo duplica
(UNIQUE en tipo+punto_venta+numero_desde, INSERT OR REPLACE).

2026-10-07: Cruce AFIP (GET /api/afip/cruce) implementado el mismo día tras
una investigación extensa de reconciliación -- ver ARQUITECTURA.md para el
detalle completo de la metodología validada (bajada día a día + dedupe
global + match por CAE con fallback PV+número). Las otras 3 hojas de Chakana
(Ventas por Jurisdicción, Duplicados Facturante, Composición Vino/Otros)
siguen sin implementar, dependen de más endpoints del ERP en vivo que
todavía no están mapeados para Colomé.
"""
import io
import re
from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook

from database import get_db
from ig_ventas import neto_y_cae_por_comprobante

router = APIRouter(prefix="/api/afip", tags=["afip"])

HEADER_ESPERADO = "Fecha"

COLUMNAS_CSV = [
    "fecha", "tipo", "punto_venta", "numero_desde", "numero_hasta",
    "cod_autorizacion", "tipo_doc_receptor", "nro_doc_receptor", "denominacion_receptor",
    "tipo_cambio", "moneda", "imp_neto_gravado", "imp_neto_no_gravado", "imp_op_exentas",
    "otros_tributos", "iva", "imp_total",
]

ENCABEZADOS_PLANTILLA = [
    "Fecha", "Tipo", "Punto de Venta", "Número Desde", "Número Hasta",
    "Cód. Autorización", "Tipo Doc. Receptor", "Nro. Doc. Receptor", "Denominación Receptor",
    "Tipo Cambio", "Moneda", "Imp. Neto Gravado", "Imp. Neto No Gravado", "Imp. Op. Exentas",
    "Otros Tributos", "IVA", "Imp. Total",
]


def require_admin(request: Request):
    """Mismo mecanismo SSO que app.py (sso_session + rol 'ventas') -- acá
    además exige rol admin, igual que require_admin de chakana-ventas."""
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


def _num(s: str) -> float:
    s = (s or "").strip()
    if not s:
        return 0.0
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


def _periodo_de_fecha(fecha_ddmmyyyy: str) -> str | None:
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", fecha_ddmmyyyy.strip())
    if not m:
        return None
    _, mes, anio = m.groups()
    return f"{anio}-{int(mes):02d}"


def _extraer_letra(tipo: str) -> str | None:
    tipo = tipo.strip()
    m = re.search(r"\b([A-Z])$", tipo)
    return m.group(1) if m else None


def _fila_desde_valores(fila: dict) -> dict | None:
    if not fila["fecha"].strip() or fila["fecha"].strip() == HEADER_ESPERADO:
        return None

    periodo = _periodo_de_fecha(fila["fecha"])
    moneda = fila["moneda"].strip()
    imp_neto_gravado = _num(fila["imp_neto_gravado"])
    imp_total = _num(fila["imp_total"])
    # "Factura de Crédito electrónica MiPyMEs (FCE)" NO es nota de crédito --
    # match completo "Nota de Crédito", no la palabra suelta (mismo gotcha
    # documentado en chakana-ventas/backend/app/afip.py).
    es_credito = "Nota de Crédito" in fila["tipo"] or "Nota de Credito" in fila["tipo"]
    monto = imp_neto_gravado if (moneda == "$" and imp_neto_gravado != 0) else imp_total
    valor_doc = -monto if es_credito else monto

    punto_venta = fila["punto_venta"].strip()
    numero_desde = fila["numero_desde"].strip()
    pv_parte = punto_venta.split("-")[0] if "-" in punto_venta else punto_venta

    return {
        "fecha": fila["fecha"].strip(),
        "tipo": fila["tipo"].strip(),
        "punto_venta": punto_venta,
        "numero_desde": numero_desde,
        "numero_hasta": fila["numero_hasta"].strip(),
        "cod_autorizacion": fila["cod_autorizacion"].strip(),
        "tipo_doc_receptor": fila["tipo_doc_receptor"].strip(),
        "nro_doc_receptor": fila["nro_doc_receptor"].strip(),
        "denominacion_receptor": fila["denominacion_receptor"].strip(),
        "tipo_cambio": _num(fila["tipo_cambio"]),
        "moneda": moneda,
        "imp_neto_gravado": imp_neto_gravado,
        "imp_neto_no_gravado": _num(fila["imp_neto_no_gravado"]),
        "imp_op_exentas": _num(fila["imp_op_exentas"]),
        "otros_tributos": _num(fila["otros_tributos"]),
        "iva": _num(fila["iva"]),
        "imp_total": imp_total,
        "periodo": periodo,
        "credito": "Si" if es_credito else "No",
        "monto": monto,
        "valor_doc": valor_doc,
        "comp_pvt": pv_parte.zfill(5) if pv_parte else None,
        "comp_nro": numero_desde.zfill(8) if numero_desde else None,
        "comp_letra": _extraer_letra(fila["tipo"]),
    }


@router.get("/plantilla")
async def descargar_plantilla(admin=Depends(require_admin)):
    wb = Workbook()
    ws = wb.active
    ws.title = "Info AFIP"
    ws.append(ENCABEZADOS_PLANTILLA)
    for col_idx in range(1, len(ENCABEZADOS_PLANTILLA) + 1):
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = 20
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=plantilla-info-afip.xlsx"},
    )


def _celda_a_texto(valor, es_fecha: bool = False) -> str:
    if valor is None:
        return ""
    if es_fecha and isinstance(valor, (datetime, date)):
        return valor.strftime("%d/%m/%Y")
    if isinstance(valor, float):
        if valor.is_integer():
            return str(int(valor))
        return str(valor).replace(".", ",")
    return str(valor).strip()


@router.post("/importar")
async def importar_afip(archivo: UploadFile = File(...), admin=Depends(require_admin)):
    if not archivo.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="El archivo debe ser un Excel (.xlsx) -- descargá la plantilla e importá esa misma planilla completada.")

    contenido = await archivo.read()
    try:
        wb = load_workbook(io.BytesIO(contenido), data_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo -- ¿es un Excel válido?")
    ws = wb.active

    filas = []
    periodos_error = 0
    for row in ws.iter_rows(min_row=2, max_col=17, values_only=True):
        if row is None or all(v is None or str(v).strip() == "" for v in row):
            continue
        campos = {
            col: _celda_a_texto(row[i] if i < len(row) else None, es_fecha=(col == "fecha"))
            for i, col in enumerate(COLUMNAS_CSV)
        }
        fila = _fila_desde_valores(campos)
        if fila is None:
            continue
        if fila["periodo"] is None:
            periodos_error += 1
            continue
        filas.append(fila)

    if not filas:
        raise HTTPException(status_code=400, detail="No se encontraron filas válidas en el Excel importado")

    conn = get_db()
    cols = [
        "fecha", "tipo", "punto_venta", "numero_desde", "numero_hasta",
        "cod_autorizacion", "tipo_doc_receptor", "nro_doc_receptor", "denominacion_receptor",
        "tipo_cambio", "moneda", "imp_neto_gravado", "imp_neto_no_gravado", "imp_op_exentas",
        "otros_tributos", "iva", "imp_total", "periodo", "credito", "monto", "valor_doc",
        "comp_pvt", "comp_nro", "comp_letra",
    ]
    placeholders = ", ".join("?" for _ in cols)
    col_names = ", ".join(f'"{c}"' for c in cols)
    conn.executemany(
        f'INSERT OR REPLACE INTO afip_comprobantes ({col_names}) VALUES ({placeholders})',
        [[f[c] for c in cols] for f in filas],
    )
    conn.commit()
    conn.close()

    periodos = Counter(f["periodo"] for f in filas)
    return {
        "ok": True,
        "filas_importadas": len(filas),
        "filas_con_fecha_invalida": periodos_error,
        "periodos": dict(sorted(periodos.items())),
    }


@router.get("/comprobantes")
async def listar_comprobantes(periodo: str | None = None, user=Depends(require_reader)):
    conn = get_db()
    if periodo:
        rows = conn.execute(
            "SELECT * FROM afip_comprobantes WHERE periodo = ? ORDER BY fecha, numero_desde",
            (periodo,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM afip_comprobantes ORDER BY periodo DESC, fecha, numero_desde LIMIT 500"
        ).fetchall()
    conn.close()
    return {"rows": [dict(r) for r in rows]}


@router.get("/periodos")
async def listar_periodos(user=Depends(require_reader)):
    conn = get_db()
    rows = conn.execute(
        "SELECT periodo, COUNT(*) AS cantidad FROM afip_comprobantes GROUP BY periodo ORDER BY periodo DESC"
    ).fetchall()
    conn.close()
    return {"periodos": [dict(r) for r in rows]}


@router.delete("/periodo/{periodo}")
async def borrar_periodo(periodo: str, admin=Depends(require_admin)):
    conn = get_db()
    cur = conn.execute("DELETE FROM afip_comprobantes WHERE periodo = ?", (periodo,))
    conn.commit()
    borradas = cur.rowcount
    conn.close()
    if borradas == 0:
        raise HTTPException(status_code=404, detail=f"No hay Info AFIP cargada para el período {periodo}")
    return {"ok": True, "filas_borradas": borradas}


def _rango_mes(periodo: str) -> tuple[date, date]:
    """(primer_dia, ultimo_dia) del mes calendario YYYY-MM, ambos inclusive."""
    anio, mes = int(periodo[:4]), int(periodo[5:7])
    primer = date(anio, mes, 1)
    if mes == 12:
        ultimo = date(anio, 12, 31)
    else:
        ultimo = date(anio, mes + 1, 1) - timedelta(days=1)
    return primer, ultimo


def calcular_cruce() -> dict:
    """Compara, por moneda, TODA la Info AFIP ya cargada (todos los períodos
    de `afip_comprobantes`) contra ig_ventas en vivo -- mismo patrón que
    chakana-ventas (total acumulado + desglose por período), metodología
    validada 2026-10-07 (ver docstring de ig_ventas.py y ARQUITECTURA.md).
    Join por CAE, con fallback por punto_venta+número para las líneas donde
    ig_ventas no trae CAE (ej. Facturas E). La moneda de cada comprobante se
    toma SIEMPRE del lado AFIP (fuente de verdad) para evitar que un mismo
    comprobante quede bucketeado distinto en cada lado.

    Extraído a función propia (2026-10-08) para que Controles pueda llamarla
    directo, sin pasar por el endpoint HTTP ni su Depends de autenticación
    -- el endpoint de abajo es ahora un wrapper fino."""
    conn = get_db()
    afip_rows = conn.execute(
        "SELECT fecha, tipo, punto_venta, numero_desde, cod_autorizacion, "
        "imp_neto_gravado, imp_neto_no_gravado, imp_op_exentas, credito, moneda, periodo "
        "FROM afip_comprobantes ORDER BY periodo"
    ).fetchall()
    conn.close()

    if not afip_rows:
        return {"tiene_datos_afip": False, "detalle": [], "detalle_por_periodo": [],
                "comprobantes_afip": 0, "comprobantes_sin_match": 0, "faltantes": []}

    periodos = sorted({f["periodo"] for f in afip_rows})
    primer_mes = _rango_mes(periodos[0])[0]
    ultimo_mes = _rango_mes(periodos[-1])[1]
    ig_por_cae = neto_y_cae_por_comprobante(primer_mes, ultimo_mes)

    afip_total: dict[str, float] = {}
    ig_total: dict[str, float] = {}
    afip_por_periodo: dict[tuple[str, str], float] = {}
    ig_por_periodo: dict[tuple[str, str], float] = {}
    faltantes = []

    for f in afip_rows:
        cae = (f["cod_autorizacion"] or "").strip()
        neto = (f["imp_neto_gravado"] or 0) + (f["imp_neto_no_gravado"] or 0) + (f["imp_op_exentas"] or 0)
        if f["credito"] == "Si":
            neto = -neto
        moneda = "USD" if (f["moneda"] or "").strip().upper() == "USD" else "ARS"
        afip_total[moneda] = afip_total.get(moneda, 0.0) + neto
        afip_por_periodo[(f["periodo"], moneda)] = afip_por_periodo.get((f["periodo"], moneda), 0.0) + neto

        ig = ig_por_cae.get(cae)
        if ig is None and cae:
            ig = ig_por_cae.get(f"PVNUM:{f['punto_venta']}:{f['numero_desde']}")
        if ig is None:
            faltantes.append({
                "fecha": f["fecha"], "tipo": f["tipo"], "punto_venta": f["punto_venta"],
                "numero": f["numero_desde"], "cod_autorizacion": cae, "monto_neto": round(neto, 2),
            })
        else:
            # moneda del lado AFIP, no la de ig -- ver docstring.
            ig_total[moneda] = ig_total.get(moneda, 0.0) + ig["neto"]
            ig_por_periodo[(f["periodo"], moneda)] = ig_por_periodo.get((f["periodo"], moneda), 0.0) + ig["neto"]

    def _fila(afip_v, ig_v):
        afip_v, ig_v = round(afip_v, 2), round(ig_v, 2)
        return {"afip": afip_v, "api": ig_v, "diferencia": round(afip_v - ig_v, 2), "ok": abs(afip_v - ig_v) <= 1}

    detalle = [{"moneda": m, **_fila(afip_total.get(m, 0), ig_total.get(m, 0))}
               for m in sorted(set(afip_total) | set(ig_total))]

    detalle_por_periodo = [
        {"periodo": p, "moneda": m, **_fila(afip_por_periodo.get((p, m), 0), ig_por_periodo.get((p, m), 0))}
        for p, m in sorted(set(afip_por_periodo) | set(ig_por_periodo))
    ]

    return {
        "tiene_datos_afip": True,
        "detalle": detalle,
        "detalle_por_periodo": detalle_por_periodo,
        "comprobantes_afip": len(afip_rows),
        "comprobantes_sin_match": len(faltantes),
        "faltantes": faltantes[:50],
    }


@router.get("/cruce")
async def cruce_afip(user=Depends(require_reader)):
    return calcular_cruce()
