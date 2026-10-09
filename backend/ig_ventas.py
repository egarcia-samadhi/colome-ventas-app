"""Acceso a la API ORDS de Colome (ig_ventas) para el Cruce AFIP.

Metodologia validada 2026-10-07 (ver ARQUITECTURA.md "Cruce AFIP -- ya NO
placeholder" para el detalle completo de la investigacion que llevo a esto):
- Paginar por RANGO DE MES COMPLETO pierde y duplica filas (bug real del
  endpoint, no confirmado el motivo exacto). Bajar SIEMPRE dia por dia.
- FECHA_DESDE=FECHA_HASTA=mismo dia tambien devuelve filas de dias vecinos
  (limite de fecha no es un corte limpio) -- dedupe SIEMPRE por (id, det_id)
  de forma GLOBAL (entre todos los dias del rango), nunca por dia aislado.
- El monto neto de una linea (comparable contra Imp.Neto Gravado+No
  Gravado+Exentas de AFIP) es directamente `valor_mon_loc` (ARS) o
  `valor_venta_mon_ext` (USD, lineas con t_moneda='X') -- NUNCA
  precio_neto*cantidad (rompe en lineas de servicio/ajuste con cantidad=0,
  ej. "GASTOS A RECUPERAR", "TRADE DEALS").
- El join entre ig_ventas y afip_comprobantes es por CAE (r_cae en
  ig_ventas = cod_autorizacion en AFIP) -- pero ALGUNAS lineas (ej. Facturas
  E/exportacion) traen r_cae=None en la API aunque el comprobante exista: no
  asumir "falta" solo por CAE vacio.

Cache en disco (persistente, mismo volumen /data que la DB) por dia
descargado -- evita re-pegarle a la API externa en cada carga de la pestaña.
"""
import json
import os
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

BASE = "http://51.161.76.107:8080/ords/redv12_emp001/redline_bi/ig_ventas"
CACHE_DIR = Path(os.environ.get("IG_VENTAS_CACHE_DIR", "/data/ig_ventas_cache"))
TIPOS_VALIDOS = {"FACTURAS VENTAS", "NOTA CREDITO VENTA", "NOTAS DE DEBITO VENTAS"}
# ig_ventas trae líneas de 3 grupos (`d_grupo`): INSUMOS, SERVICIOS, VINOS **
# -- "SERVICIOS" incluye hospitalidad/Estancia Colomé (habitaciones, menúes,
# visitas, degustaciones, vestimenta, cafetería), que NO es "Ventas" para la
# empresa. Confirmado 2026-10-08 contra el archivo real que usa Colomé
# (`Operaciones_de_Ventas.xlsx` -> hoja "Base de Ventas Colome"): el 100% de
# esas filas tiene `D Grupo = "VINOS **"`, sin una sola excepción -- ese es
# el universo real de "Panel de Ventas" para la empresa, no una decisión de
# Claude. Un `D TipoCliente`/`D Canal Venta` = "Hospitalidad"/"Estancia
# Colomé" SÍ puede aparecer ahí -- es vino vendido a través del canal de la
# estancia/vinoteca del hotel, no ingreso de hotelería.
GRUPO_VALIDO = "VINOS **"

# ig_ventas trae ~180 columnas por línea, pero los consumidores de este
# módulo solo usan un subconjunto. Cacheadas completas, 92 días de
# jul-ago-sep 2026 pesaban 246 MB en disco y cada request de Cruce AFIP
# tardaba ~2.5s SOLO en leer+parsear ese JSON de nuevo (encontrado
# 2026-10-08, Ezequiel: "cruce afip, veo que tarda un montón en mostrar los
# datos") -- recortar a estos campos en el momento de cachear reduce el
# peso ~90% sin cambiar ningún resultado (nunca se lee ningún otro campo de
# una fila cacheada). Si se agrega un consumidor nuevo que necesite otro
# campo, agregarlo acá ANTES de usarlo -- y regenerar (no solo reformatear)
# el cache ya escrito con los campos viejos, porque un campo que faltaba al
# cachear no se puede recuperar sin volver a pedirlo a la API externa.
CAMPOS_USADOS = (
    "id", "det_id", "d_tipo_compro", "r_cae", "t_moneda",
    "valor_venta_mon_ext", "valor_venta_mon_alt", "valor_mon_loc",
    "d_comprobante", "numero", "fecha", "periodo", "n_provincia",
    "d_oficina", "d_categoria", "d_canal_venta", "d_zona_comercial",
    "d_pais", "d_rubro", "d_marca", "n_cliente", "cantidad_cajas9l",
    "costo_unit_mon_alt", "cantidad", "d_grupo",
)


def _fetch_dia_remoto(dia: date) -> list[dict]:
    desde = dia.isoformat()
    hasta = (dia + timedelta(days=1)).isoformat()
    offset, limit, rows, vistos = 0, 1000, [], set()
    while True:
        url = f"{BASE}?FECHA_DESDE={desde}&FECHA_HASTA={hasta}&limit={limit}&offset={offset}"
        for intento in range(3):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    data = json.load(r)
                break
            except Exception:
                if intento == 2:
                    raise
                time.sleep(2)
        for it in data["items"]:
            key = (it.get("id"), it.get("det_id"))
            if key in vistos:
                continue
            vistos.add(key)
            rows.append({c: it.get(c) for c in CAMPOS_USADOS})
        if not data.get("hasMore"):
            break
        offset += limit
    return rows


TTL_MES_EN_CURSO = 6 * 3600  # segundos


def _mes_cerrado(dia: date) -> bool:
    """Un día es cacheable PARA SIEMPRE si su mes calendario ya cerró --
    pedido explícito de Ezequiel 2026-10-08 ("si ventas vs afip ya cerró, no
    va a cambiar, ya por temas fiscales y legales"): una vez que un período
    cierra, el ERP no lo vuelve a modificar."""
    hoy = date.today()
    return (dia.year, dia.month) != (hoy.year, hoy.month)


def _periodo_de_fila(it: dict, dia: date) -> str:
    """Mes calendario para agrupar una fila -- SIEMPRE a partir de la
    `fecha` real de la fila, nunca del día del loop (`dia`). Bug real
    encontrado 2026-10-08 reconciliando jul-ago contra Operaciones_de_Ventas
    .xlsx: el límite de fecha de ig_ventas "no es un corte limpio" (mismo
    gotcha ya documentado para el dedupe por id/det_id) -- pedir
    FECHA_DESDE=2026-08-31&FECHA_HASTA=2026-09-01 a veces devuelve además
    líneas del 1 de septiembre. Como el dedupe GLOBAL se queda con la
    PRIMERA vez que ve cada (id,det_id), esas filas de septiembre quedaban
    "vistas" durante el fetch del 31 de agosto y places quedaban agrupadas
    en el período del DÍA DEL LOOP (agosto) en vez de su mes real
    (septiembre) -- encontrado al comparar factura por factura contra el
    Excel real (15 facturas del 1/sep apareciendo como "de más" en agosto,
    exactamente la diferencia residual tras descontar FdelMotte). La
    `fecha` de la fila en sí es confiable (no es el campo `periodo` de
    cierre contable del ERP, ese sí puede estar desfasado -- ver
    neto_por_jurisdiccion) -- se parsea con un fallback al día del loop
    por si alguna vez viene vacía."""
    fecha = (it.get("fecha") or "")[:7]  # "YYYY-MM-DDTHH:..." -> "YYYY-MM"
    if len(fecha) == 7 and fecha[4] == "-":
        return fecha
    return f"{dia.year}-{dia.month:02d}"


def _fetch_dia(dia: date, forzar: bool = False) -> list[dict]:
    """Cache por día: los meses ya cerrados se cachean para siempre (ver
    `_mes_cerrado`). El día de HOY nunca se cachea (sigue cargándose
    durante la jornada). Los días YA PASADOS del mes EN CURSO (ej. el 1 de
    octubre, mientras estamos a 8 de octubre) todavía pueden recibir
    comprobantes cargados tarde hasta que el mes cierre -- pero recién
    volver a pedirlos a la API externa EN CADA request de Panel de Ventas
    los hacía tardar ~17s solo para esos pocos días (encontrado 2026-10-08).
    Se cachean igual, con un TTL corto (`TTL_MES_EN_CURSO`, 6 horas) en vez
    de sin cache -- balance entre ver una carga tardía razonablemente rápido
    y no re-pegarle a la API externa en cada clic."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{dia.isoformat()}.json"
    hoy = date.today()
    es_hoy = dia == hoy
    cacheable = not es_hoy
    ttl = None if _mes_cerrado(dia) else TTL_MES_EN_CURSO
    if not forzar and cacheable and cache_file.exists():
        vencido = ttl is not None and (time.time() - cache_file.stat().st_mtime) > ttl
        if not vencido:
            return json.loads(cache_file.read_text(encoding="utf-8"))
    rows = _fetch_dia_remoto(dia)
    if cacheable:
        cache_file.write_text(json.dumps(rows), encoding="utf-8")
    return rows


def neto_y_cae_por_comprobante(desde: date, hasta_incl: date) -> dict[str, dict]:
    """Devuelve {cae: {neto, moneda, lineas, periodo, pv, numero, fecha}} para
    el rango [desde, hasta_incl] inclusive, bajando dia por dia con dedupe
    GLOBAL entre todos los dias (ver docstring del modulo)."""
    por_cae: dict[str, dict] = {}
    vistos_global = set()
    dia = desde
    while dia <= hasta_incl:
        for it in _fetch_dia(dia):
            key = (it.get("id"), it.get("det_id"))
            if key in vistos_global:
                continue
            vistos_global.add(key)
            if it.get("d_tipo_compro") not in TIPOS_VALIDOS:
                continue
            cae = str(it.get("r_cae") or "").strip()
            es_nc = it.get("d_tipo_compro") == "NOTA CREDITO VENTA"
            if it.get("t_moneda") == "X":
                moneda, neto = "USD", float(it.get("valor_venta_mon_ext") or 0)
            else:
                moneda, neto = "ARS", float(it.get("valor_mon_loc") or 0)
            if not cae:
                # Sin CAE (ej. Facturas E) -- se indexa por PV+numero como
                # fallback para no perderlo del cruce.
                pv = (it.get("d_comprobante") or "").rsplit("PV", 1)[-1].strip() if "PV" in (it.get("d_comprobante") or "") else None
                cae = f"PVNUM:{pv}:{it.get('numero')}"
            d = por_cae.setdefault(cae, {"neto": 0.0, "moneda": moneda, "lineas": 0, "fecha": it.get("fecha")})
            d["neto"] += (-neto if es_nc else neto)
            d["lineas"] += 1
        dia += timedelta(days=1)
    return por_cae


def neto_por_jurisdiccion(desde: date, hasta_incl: date) -> list[dict]:
    """Ventas por periodo (mes calendario) + provincia del comprobante
    (`n_provincia`, la provincia de IIBB real no existe como campo separado
    en ig_ventas como en el ERP de Chakana -- se usa esta como equivalente),
    separado por moneda (ars/usd). Misma metodologia validada que
    neto_y_cae_por_comprobante (bajada dia por dia + dedupe GLOBAL).

    IMPORTANTE: el periodo se calcula del DIA CALENDARIO que se esta
    iterando (`dia`), NUNCA del campo `periodo` que trae cada fila de
    ig_ventas -- ese campo es de cierre/disponibilidad contable del ERP
    origen y puede NO coincidir con el mes calendario real de la fecha del
    comprobante (confirmado 2026-10-07: filas con fecha 30/09 traen
    periodo="2026-10"). Usar el campo de la fila hacia que un filtro por
    2026-09 mostrara comprobantes de octubre."""
    acc: dict[tuple[str, str], dict[str, float]] = {}
    filas: dict[tuple[str, str], int] = {}
    vistos_global = set()
    dia = desde
    while dia <= hasta_incl:
        for it in _fetch_dia(dia):
            key = (it.get("id"), it.get("det_id"))
            if key in vistos_global:
                continue
            vistos_global.add(key)
            if it.get("d_tipo_compro") not in TIPOS_VALIDOS:
                continue
            es_nc = it.get("d_tipo_compro") == "NOTA CREDITO VENTA"
            periodo = _periodo_de_fila(it, dia)
            jurisdiccion = it.get("n_provincia") or "Otro País"
            if it.get("t_moneda") == "X":
                bucket, neto = "usd", float(it.get("valor_venta_mon_ext") or 0)
            else:
                bucket, neto = "ars", float(it.get("valor_mon_loc") or 0)
            if es_nc:
                neto = -neto
            k = (periodo, jurisdiccion)
            d = acc.setdefault(k, {"ars": 0.0, "usd": 0.0})
            d[bucket] += neto
            filas[k] = filas.get(k, 0) + 1
        dia += timedelta(days=1)
    out = [
        {"periodo": p, "jurisdiccion": j, "filas": filas[(p, j)], **{kk: round(vv, 2) for kk, vv in v.items()}}
        for (p, j), v in acc.items()
    ]
    out.sort(key=lambda r: (r["periodo"], r["jurisdiccion"]))
    return out


# Dimensiones y mapeo de campos de Panel de Ventas / Ventas por Región --
# mismo esquema dims/facts que ya consumía el mock estático (ver
# fuentes-mock-app/extraer_datos_api.py, NO USAR ese script: pagina por mes
# completo, bug ya resuelto acá con bajada día a día + dedupe global).
DIMS_PANEL = ["periodo", "mercado", "categoria", "canal", "zona", "pais", "provincia", "brand", "producto", "cliente"]
CAMPOS_PANEL = ["d_oficina", "d_categoria", "d_canal_venta", "d_zona_comercial",
                "d_pais", "n_provincia", "d_rubro", "d_marca", "n_cliente"]


PANEL_AGG_CACHE = CACHE_DIR.parent / "panel_ventas_agg_cerrado.json"


def _agregado_crudo_panel(desde: date, hasta_incl: date) -> dict[tuple, list[float]]:
    """Agregado {(periodo, mercado_raw, ..., cliente_raw): [usd,cajas,ars,mg]}
    con claves en VALORES CRUDOS (no códigos) -- separado de
    facts_panel_ventas() para poder cachear en disco el agregado de los
    meses ya cerrados (ver PANEL_AGG_CACHE) sin mezclar la codificación de
    dims entre el bloque cacheado y el bloque en vivo del mes en curso."""
    if hasta_incl < desde:
        return {}
    agg: dict[tuple, list[float]] = {}
    vistos_global = set()
    dia = desde
    while dia <= hasta_incl:
        for it in _fetch_dia(dia):
            key = (it.get("id"), it.get("det_id"))
            if key in vistos_global:
                continue
            vistos_global.add(key)
            if it.get("d_tipo_compro") not in TIPOS_VALIDOS:
                continue
            if it.get("d_grupo") != GRUPO_VALIDO:
                continue
            # periodo = mes calendario del DIA que se esta iterando, NUNCA el
            # campo `periodo` de la fila (mismo bug ya documentado en
            # neto_por_jurisdiccion: ese campo es de cierre contable del ERP
            # y puede no coincidir con el mes real de `fecha`).
            periodo = _periodo_de_fila(it, dia)
            k = (periodo,) + tuple(str(it.get(c) or "").strip() for c in CAMPOS_PANEL)
            usd = float(it.get("valor_venta_mon_alt") or 0)
            cajas = float(it.get("cantidad_cajas9l") or 0)
            ars = float(it.get("valor_mon_loc") or 0)
            costo_usd = float(it.get("costo_unit_mon_alt") or 0) * float(it.get("cantidad") or 0)
            a = agg.setdefault(k, [0.0, 0.0, 0.0, 0.0])
            a[0] += usd
            a[1] += cajas
            a[2] += ars
            a[3] += usd - costo_usd
        dia += timedelta(days=1)
    return agg


def facts_panel_ventas(desde: date, hasta_incl: date) -> dict:
    """{dims, facts} para Panel de Ventas / Ventas por Región. `facts` es una
    lista de filas [cod_periodo, cod_mercado, ..., cod_cliente, usd, cajas,
    ars, mg] -- cada dimensión se codifica a un índice entero sobre la lista
    `dims[<nombre>]`, igual que el mock original, para que el frontend
    (app.js portado del mock) no tenga que cambiar.

    Performance (2026-10-08): el agregado de los meses YA CERRADOS no puede
    cambiar más (mismo criterio que el cache por-día de _fetch_dia -- ver
    `_mes_cerrado`, confirmado por Ezequiel: "si ventas vs afip ya cerró, no
    va a cambiar, ya por temas fiscales y legales"), así que ese bloque se
    cachea COMPLETO (ya agregado, no las filas crudas) en
    `PANEL_AGG_CACHE` -- recalcularlo desde cero con ~400 días cacheados en
    disco tardaba ~19s en cada request (123 MB de JSON por-día a releer).
    Solo el mes EN CURSO se recalcula en vivo en cada request (pocos días,
    rápido). El cache de meses cerrados se invalida solo (se recalcula una
    vez) cuando cambia el límite de "cerrado" -- es decir, una vez por mes,
    la primera vez que se pide después de que cerró uno nuevo."""
    hoy = date.today()
    inicio_mes_actual = date(hoy.year, hoy.month, 1)
    cerrado_hasta = min(hasta_incl, inicio_mes_actual - timedelta(days=1))

    agg_cerrado: dict[tuple, list[float]] = {}
    if cerrado_hasta >= desde:
        cache_valido = False
        if PANEL_AGG_CACHE.exists():
            try:
                cached = json.loads(PANEL_AGG_CACHE.read_text(encoding="utf-8"))
                if cached.get("desde") == desde.isoformat() and cached.get("hasta") == cerrado_hasta.isoformat():
                    agg_cerrado = {tuple(k.split("\x1f")): v for k, v in cached["agg"].items()}
                    cache_valido = True
            except Exception:
                pass
        if not cache_valido:
            agg_cerrado = _agregado_crudo_panel(desde, cerrado_hasta)
            PANEL_AGG_CACHE.parent.mkdir(parents=True, exist_ok=True)
            PANEL_AGG_CACHE.write_text(json.dumps({
                "desde": desde.isoformat(), "hasta": cerrado_hasta.isoformat(),
                "agg": {"\x1f".join(k): v for k, v in agg_cerrado.items()},
            }), encoding="utf-8")

    desde_vivo = max(desde, inicio_mes_actual)
    agg_vivo = _agregado_crudo_panel(desde_vivo, hasta_incl) if desde_vivo <= hasta_incl else {}

    agg_crudo: dict[tuple, list[float]] = dict(agg_cerrado)
    for k, v in agg_vivo.items():
        a = agg_crudo.setdefault(k, [0.0, 0.0, 0.0, 0.0])
        for i in range(4):
            a[i] += v[i]

    valores: dict[str, dict[str, int]] = {d: {} for d in DIMS_PANEL}

    def _code(d: str, v: str) -> int:
        m = valores[d]
        if v not in m:
            m[v] = len(m)
        return m[v]

    facts = []
    for k, v in agg_crudo.items():
        cods = [_code(d, val) for d, val in zip(DIMS_PANEL, k)]
        facts.append(cods + [round(x, 2) for x in v])

    dims = {d: [v for v, _ in sorted(m.items(), key=lambda kv: kv[1])] for d, m in valores.items()}
    return {"dims": dims, "facts": facts}


def desglose_por_grupo(desde: date, hasta_incl: date) -> list[dict]:
    """Otros Análisis -> desglose por `d_grupo` (VINOS/INSUMOS/SERVICIOS),
    por período y moneda -- a diferencia de facts_panel_ventas() acá NO se
    filtra por GRUPO_VALIDO, es el 100% de las líneas que concilian con
    AFIP (mismo universo que neto_y_cae_por_comprobante). Pedido explícito
    de Ezequiel 2026-10-08: mostrar la diferencia entre "Ventas" (solo vino,
    lo que ve Panel de Ventas) y el total facturado real."""
    acc: dict[tuple[str, str], dict[str, float]] = {}
    vistos_global = set()
    dia = desde
    while dia <= hasta_incl:
        for it in _fetch_dia(dia):
            key = (it.get("id"), it.get("det_id"))
            if key in vistos_global:
                continue
            vistos_global.add(key)
            if it.get("d_tipo_compro") not in TIPOS_VALIDOS:
                continue
            es_nc = it.get("d_tipo_compro") == "NOTA CREDITO VENTA"
            periodo = _periodo_de_fila(it, dia)
            grupo = it.get("d_grupo") or "Sin grupo"
            if it.get("t_moneda") == "X":
                bucket, neto = "usd", float(it.get("valor_venta_mon_ext") or 0)
            else:
                bucket, neto = "ars", float(it.get("valor_mon_loc") or 0)
            if es_nc:
                neto = -neto
            k = (periodo, grupo)
            d = acc.setdefault(k, {"ars": 0.0, "usd": 0.0})
            d[bucket] += neto
        dia += timedelta(days=1)
    out = [
        {"periodo": p, "grupo": g, **{kk: round(vv, 2) for kk, vv in v.items()}}
        for (p, g), v in acc.items()
    ]
    out.sort(key=lambda r: (r["periodo"], r["grupo"]))
    return out
