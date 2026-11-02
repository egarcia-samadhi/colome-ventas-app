"""Sales Performance (SNAP) -> Sales by Line of Business, conectado en vivo
a ig_ventas (2026-10-19, pedido explícito de Ezequiel: conectar el SNAP y
"configurar desde datos maestros qué se expone en cada línea"). Reemplaza
el dataset mock estático (`public/ventas/colome-data.json`, clave `sbl_aug`/
`sbl_ytd`) -- MISMO esquema de filas que consumía `snap.js`. Budget por
línea agregado 2026-11-02 (ver `_agregado_budget_linea` más abajo) --
revierte la decisión del 2026-10-09 ("nunca existió un dato real, se saca"),
que se basaba en un archivo donde la columna SÍ venía vacía. Fuente ÚNICA
con el Budget TOTAL de Panel de Ventas (`_budget_mensual`, más abajo):
`Budget_Dinamico.xlsx` clasificado por línea -- Ezequiel pidió explícitamente
("no podemos usar fuentes distintas") no mezclar el Budget por línea del
SNAP real de Ariel (que trae un total ~1.5-2% distinto) con el Budget total
ya usado en Panel de Ventas.

Jerarquía de totales (reconstruida comparando los números reales del mock
el 2026-10-19, no inventada -- confirmado con Ezequiel):
  Total Grupo Colome Brand = Grupo Colome Domestic + Grupo Colome Export
  Direct-to-consumer Channel = Employees + E-commerce + Colome Hotel +
                                Colome Visitor Center + Cafayate Visitor
                                Center
  TOTAL SALES TO THIRD PARTIES = Total Grupo Colome Brand
                                  + Direct-to-consumer Channel
                                  + Total Buyers Own Brand (BOB)
                                  + Sin clasificar
  TOTAL SALES = TOTAL SALES TO THIRD PARTIES + Total Intercompany Sales

Partición POR `d_categoria` (universo VINOS **, 6 valores reales posibles,
confirmado 2026-10-09): DBA/DCBA/DNOA -> Grupo Colome Domestic (wholesale),
EXPORTS -> Grupo Colome Export, DTC/HOSPITALIDAD -> Direct-to-consumer
Channel (sub-clasificado por `snap_linea_negocio_mapa`, editable desde
Datos Maestros -- ver database.py/datos_maestros.py).

**"Sin clasificar" (fila propia, SIEMPRE visible, 2026-10-19 -- pedido
explícito de Ezequiel: "tiene que ir a una línea sin clasificar, PERO
SIEMPRE TIENE QUE MOSTRAR EL TOTAL"):** ningún peso se pierde ni se
esconde. Dos casos cuentan ahí: 1) combinaciones centro_costo/categoria/
canal_venta dentro de DTC/HOSPITALIDAD que no matchean ninguna regla de
`snap_linea_negocio_mapa` (el admin agrega la regla faltante desde Datos
Maestros, endpoint `/api/datos-maestros/snap-linea-negocio/sin-clasificar`
lista las combinaciones pendientes); 2) valor de `d_categoria` fuera de
los 6 conocidos (no debería pasar nunca, pero antes de esta fila cualquier
línea así se perdía en silencio de TODOS los totales -- bug real
corregido acá). "Sin clasificar" entra en `TOTAL SALES TO THIRD PARTIES`
como hermano de Brand/DTC/BOB, no anidado dentro de Direct-to-consumer
Channel (el caso 2 no es necesariamente DTC).

BOB (Others) e Intercompany (GC Wines Uruguay S.A.) quedan en 0 FIJO --
investigado 2026-10-19: no hay ninguna venta real bajo la marca "Ascension"
en los 13 meses de histórico, y las únicas líneas de "GRUPO COLOME WINES
URUGUAY S.A." en ig_ventas son `d_grupo="REDLINE GASTOS"` (gastos
administrativos, fuera del universo VINOS **) -- no es una omisión, es que
esos canales todavía no tienen ventas de vino registradas en Redline.
Filas "Ascension Malbec/Reserva/Torrontes" sacadas de la hoja (pedido
explícito de Ezequiel 2026-10-19): sin venta real nunca, no aportaban nada
mostrando 3 filas en 0 -- queda solo "Others" dentro de BOB.

Last Year: solo se muestra si hay dato real (mismo mes/rango del año
anterior, posible desde que arrancó el histórico real en 2025-09-01) --
mismo criterio que Panel de Ventas. Ejercicio fiscal Colomé: julio a junio
(igual que `public/ventas/app.js`, P01=julio)."""
import json
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request

from ig_ventas import _lineas_vinos

router = APIRouter(prefix="/api/ventas", tags=["snap"])

# LY para jul-ago 2025 (agregado 2026-10-20): ese rango es ANTERIOR al
# histórico real en vivo (`DESDE_HISTORICO` = 2025-09-01, ig_ventas no
# tiene datos de ahí para atrás), así que el snap no podía mostrar LY para
# los primeros 2 meses del ejercicio fiscal (P01/P02 = julio/agosto) --
# Ezequiel: "sigo viendo los 1685 vs 1676" se cerró el día anterior, pero
# el LY de jul-ago seguía en "n/d". Ariel mandó `LFY.xlsx` (hoja "Base
# Sistema", export crudo tipo ERP, NO el mismo esquema que ig_ventas) con
# el real de jul-ago 2025. Pre-agregado por (periodo, línea de negocio) y
# commiteado como fixture estática -- no es un feed en vivo, es un volcado
# puntual de un rango que nunca va a cambiar (ya cerrado hace más de un
# año) y que nunca se va a volver a pedir (no hay otro hueco igual).
#
# Clasificación de línea INFERIDA del campo `Centro` (el archivo no trae
# una columna "línea de negocio" explícita) -- validada cruzando contra 2
# señales ya confirmadas en producción: 1) `Centro="Expo"` coincide exacto
# con las ventas a países != Argentina (salvo 4 filas de turistas pagando
# en el Hotel, correctamente excluidas de Export); 2) `Centro="Hotel"` /
# `"Visitor Center"` / `"Amalaya WB"` calzan con las reglas YA cargadas en
# `snap_linea_negocio_mapa` (centro_costo="HOTEL COLOME"→Colome Hotel,
# "AMALAYA WINE BAR"→Cafayate Visitor Center). NO validada con Ariel
# todavía -- si en algún momento no cierra contra un número que él
# confirme, revisar primero esta inferencia antes que el resto del cálculo.
#
# El campo `Costo` del archivo viene en ARS (confirmado cruzando contra
# `tipo de cambio` y el campo `MG2` ya calculado por fila) -- se convirtió
# a USD dividiendo por el tipo de cambio de cada fila antes de agregar.
LFY_RUTA = Path(__file__).parent / "lfy_jul_ago_2025.json"
LFY_DESDE = date(2025, 7, 1)
_lfy_cache: dict[tuple[str, str], list[float]] | None = None


def _lfy_agregado() -> dict[tuple[str, str], list[float]]:
    global _lfy_cache
    if _lfy_cache is None:
        raw = json.loads(LFY_RUTA.read_text(encoding="utf-8"))
        _lfy_cache = {}
        for k, v in raw.items():
            periodo, linea = k.split("|", 1)
            _lfy_cache[(periodo, linea)] = v
    return _lfy_cache


# Budget real (agregado 2026-10-20, Ezequiel: "subamos tambien esta info del
# budget") -- `Budget_Dinamico.xlsx`, hoja "Datos" (2.330 filas SKU/mes/
# canal/mercado del presupuesto de bodega), agregado acá a TOTAL por mes
# calendario (sin desglose por línea de negocio -- ni el SNAP real de Ariel
# trae Budget por línea, ver `YTD - Snap - ly.xlsx`, columna "Budget" vacía
# en TODAS las filas, Total incluido). Validado contra la propia hoja
# "Control" del archivo (cuadre interno de Ariel): 185.062,75 cajas totales,
# USD 10.556.951,16 -- exacto.
#
# CORREGIDO el mismo día: el archivo etiqueta su columna `Año_Fiscal` como
# "2025-2026", pero Ariel confirmó después que esa etiqueta está mal -- el
# presupuesto real es del ejercicio EN CURSO, 2026-2027 (jul-2026 a
# jun-2027). Se reextrajo mapeando Nro_Mes directo a 2026-07..2027-06
# (ignorando el campo `Año_Fiscal` del archivo, que quedó desfasado un
# año). Esto SÍ cubre el ejercicio actual -- no hace falta esperar otro
# presupuesto."""
BUDGET_RUTA = Path(__file__).parent / "budget_2026_2027.json"
_budget_cache: dict[str, list[float]] | None = None


def _budget_mensual() -> dict[str, list[float]]:
    global _budget_cache
    if _budget_cache is None:
        _budget_cache = json.loads(BUDGET_RUTA.read_text(encoding="utf-8"))
    return _budget_cache


# Budget POR LÍNEA de negocio (agregado 2026-11-02, Ezequiel: "en el snap
# (hoja sales performance) tenia budget, y nosotros no lo cargamos" -- la
# decisión del 2026-10-09 de sacar Budget de esta hoja se basaba en
# `YTD - Snap - ly.xlsx`, donde la columna Budget venía vacía).
#
# PRIMER INTENTO (mismo día, descartado): extraer el Budget por línea
# directo del SNAP real que Ariel manda mes a mes (`SNAP I Aug/September
# 2026 - NM - vsp.xls`, hoja "Sales by line of bussines", que SÍ trae esa
# columna poblada). Ezequiel cortó al toque: *"no podemos usar fuentes
# distintas"* -- el total de ESE archivo no coincide centavo a centavo con
# `budget_2026_2027.json` (Budget TOTAL de Panel de Ventas, ~1.5-2% de
# diferencia), dos equipos/momentos distintos de Ariel armando el mismo
# número. Se descartó esa fixture y se reconstruyó como sigue.
#
# FUENTE ÚNICA, la misma que `_budget_mensual` (arriba): `Budget_Dinamico.
# xlsx`, hoja "Datos" (2.330 filas SKU/mes/Canal/Mercado). Clasificado por
# línea de negocio vía el campo `Mercado` (no `Canal`, que solo distingue
# "Mercado Local"/"Exportación"): `E-commerce`->E-commerce; `Distrib. Bs.
# As.`/`Interior`/`Distrib. NOA`->Grupo Colome Domestic; `HCVC - Hotel`->
# Colome Hotel; `HCVC - VC Col`->Colome Visitor Center; `HCVC - VC Cafa`->
# Cafayate Visitor Center; el resto (UE/Brasil/Reino Unido/USA/Suiza/Asia/
# Canadá/Resto L.A./Caribe/México)->Grupo Colome Export. `Employees` no
# tiene `Mercado` propio en este archivo -- 0 fijo, igual que en el SNAP
# real (nunca tuvo Budget). **Validado exacto**: la suma de las 7 líneas de
# cada mes reproduce el total de `budget_2026_2027.json` centavo a centavo
# (diferencia ≤ USD 0,01 por redondeo, en los 12 meses del ejercicio) --
# misma fuente, una sola clasificación, Panel de Ventas y Sales Performance
# SIEMPRE van a sumar lo mismo para el Budget total.
#
# Nro_Mes del archivo mapeado directo a 2026-07..2027-06 (mismo criterio
# que `_budget_mensual`, el campo `Año_Fiscal` del archivo está mal
# etiquetado como "2025-2026").
BUDGET_LINEA_RUTA = Path(__file__).parent / "budget_linea_2026_2027.json"
_budget_linea_cache: dict[str, dict[str, list[float]]] | None = None


def _budget_linea_mensual() -> dict[str, dict[str, list[float]]]:
    global _budget_linea_cache
    if _budget_linea_cache is None:
        _budget_linea_cache = json.loads(BUDGET_LINEA_RUTA.read_text(encoding="utf-8"))
    return _budget_linea_cache


def _agregado_budget_linea(desde: date, hasta_incl: date) -> dict[str, list[float]] | None:
    """Suma Budget por línea para [desde, hasta_incl] (meses calendario
    completos, único patrón que usa `ventas_sbl`). `None` si falta la
    fixture de ALGUNO de los meses del rango -- no se aproxima un rango
    parcialmente cubierto, mismo criterio que LY."""
    budget = _budget_linea_mensual()
    acc: dict[str, list[float]] = {}
    for anio, mes in _meses_en_rango(desde, hasta_incl):
        periodo = f"{anio:04d}-{mes:02d}"
        mes_data = budget.get(periodo)
        if mes_data is None:
            return None
        for linea, v in mes_data.items():
            a = acc.setdefault(linea, [0.0, 0.0])
            a[0] += v[0]
            a[1] += v[1]
    return acc

DOMESTIC_WHOLESALE = {"DBA", "DCBA", "DNOA"}
EXPORT = {"EXPORTS"}
DTC_HOSPITALIDAD = {"DTC", "HOSPITALIDAD"}

SBL_TOTAL_ROWS = {
    "TOTAL SALES TO THIRD PARTIES", "TOTAL SALES", "Total Grupo Colome Brand",
    "Total Buyers Own Brand (BOB)", "Total Intercompany Sales",
}


def inicio_ejercicio_fiscal(d: date) -> date:
    """Ejercicio fiscal Colomé: julio a junio -- igual que app.js (P01=julio)."""
    return date(d.year, 7, 1) if d.month >= 7 else date(d.year - 1, 7, 1)


def _mapa_linea_negocio() -> list[dict]:
    from database import get_db
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM snap_linea_negocio_mapa ORDER BY "
        "(centro_costo IS NOT NULL) + (categoria IS NOT NULL) + (canal_venta IS NOT NULL) DESC"
    ).fetchall()]
    conn.close()
    return rows


def _clasificar_dtc(it: dict, reglas: list[dict]) -> str:
    """Primera regla que matchea (ya ordenadas por especificidad desc en
    `_mapa_linea_negocio`) -- un campo NULL en la regla significa "no
    filtra por ese campo"."""
    for r in reglas:
        if r["centro_costo"] and it.get("d_centro_costo") != r["centro_costo"]:
            continue
        if r["categoria"] and it.get("d_categoria") != r["categoria"]:
            continue
        if r["canal_venta"] and it.get("d_canal_venta") != r["canal_venta"]:
            continue
        return r["linea_negocio"]
    return "Sin clasificar"


def _clasificar_leaf(it: dict, reglas: list[dict]) -> str:
    """Misma partición que usa `_agregado_sbl` (por `d_categoria`, con
    sub-clasificación DTC/HOSPITALIDAD vía `_clasificar_dtc`), extraída
    acá como helper compartido para que `desglose_mercado` (ver abajo)
    clasifique CADA fila con la MISMA regla exacta que arma las líneas del
    SNAP -- dos implementaciones separadas de la misma partición es
    exactamente el bug estructural que ya se corrigió una vez en este
    archivo (ver docstring del módulo, refactor 2026-10-19)."""
    categoria = it.get("d_categoria") or ""
    if categoria in DOMESTIC_WHOLESALE:
        return "Grupo Colome Domestic"
    if categoria in EXPORT:
        return "Grupo Colome Export"
    if categoria in DTC_HOSPITALIDAD:
        return _clasificar_dtc(it, reglas)
    return "Sin clasificar"


def _label_matches(label: str, it: dict, leaf: str) -> bool:
    """¿Esta fila entra en el total/línea `label` de Sales by Line of
    Business? -- usado por `desglose_mercado` (popup "Sales by Market" por
    línea, pedido explícito de Ezequiel 2026-10-21) para saber qué filas
    crudas componen cada fila clickeada, incluidas las de total/subtotal."""
    if label == "Grupo Colome Domestic - AirLines":
        return leaf == "Grupo Colome Domestic" and it.get("d_canal_venta") == "AEROPUERTOS"
    if label == "Total Grupo Colome Brand":
        return leaf in ("Grupo Colome Domestic", "Grupo Colome Export")
    if label == "Direct-to-consumer Channel":
        return leaf in DTC_LINEAS_FIJAS
    if label in ("TOTAL SALES TO THIRD PARTIES", "TOTAL SALES"):
        return leaf in ("Grupo Colome Domestic", "Grupo Colome Export", "Sin clasificar") or leaf in DTC_LINEAS_FIJAS
    if label in ("Total Buyers Own Brand (BOB)", "Total Intercompany Sales"):
        # 0 FIJO -- no hay ninguna fila real bajo Ascension/GC Wines
        # Uruguay en los 13 meses de histórico (ver docstring del módulo).
        return False
    return leaf == label


def _filas_universo(desde: date, hasta_incl: date, fdelmotte: bool):
    """Filtra `_lineas_vinos` por marca: FdelMotte tiene su propio SNAP
    separado del resto de Grupo Colomé (pedido explícito de Ezequiel
    2026-10-19 -- ver docstring de `_agregado_sbl`). Extraído acá como
    helper único (2026-10-22, pedido "llevá FdelMotte al mismo formato que
    Consolidado") para que ambos SNAP compartan EXACTAMENTE la misma
    clasificación por línea de negocio/mercado -- la única diferencia entre
    los dos es qué filas crudas entran, no la lógica que las agrupa."""
    for it in _lineas_vinos(desde, hasta_incl):
        es_fdelmotte = it.get("d_rubro") == "FDELMOTTE **"
        if es_fdelmotte != fdelmotte:
            continue
        yield it


# SNAP real de FdelMotte: ESTRUCTURA DISTINTA a Sales by Line of Business
# de Colomé (2026-11-02, pedido explícito de Ezequiel -- mostró el SNAP
# real de Ariel: 2 tablas independientes, cada una con su propio "Grand
# total", NUNCA unificadas en la jerarquía Domestic/Export/DTC/BOB/
# Intercompany que usa Colomé -- ver `ventas_sbl` arriba, que hasta ahora
# se reusaba tal cual para FdelMotte vía `fdelmotte=True` desde el
# 2026-10-22. Esa decisión quedó revertida PARA FDELMOTTE SOLAMENTE; el
# SNAP de Colomé (fdelmotte=False) no cambia.
#
# Tabla 1 -- por VARIEDAD de producto: agrupa directo por `d_articulo`
# (6 valores reales confirmados contra octubre-2026: FAMILIA DELMOTTE
# CLASICO/NATURAL/GSM TINTO/ASSEMBLAGE BLANCO/BONARDA/CORBEAU NATURAL --
# mapean 1 a 1 con "Flia Del Motte - Malbec Clásico/Natural/Assemblage
# GSM/Assemblage Blanco/Bonarda/Corbeau Natural" de la imagen de
# referencia de Ezequiel, sin necesidad de un mapeo manual en Datos
# Maestros). `d_marca` NO sirve para esto -- "FDM BONARDA" es el mismo
# valor tanto para Bonarda como para Corbeau Natural, se pierde la
# distinción.
#
# Tabla 2 -- por CANAL: mismos 3 grupos que usa Colomé para Domestic/
# Export (`DOMESTIC_WHOLESALE`/`EXPORT`, definidos arriba), pero DTC+
# HOSPITALIDAD se juntan en un solo "Familia Delmotte Direct" (FdelMotte
# no tiene las sub-líneas propias de Colomé -- Employees/E-commerce/
# Hotel/Visitor Center -- esos centros de costo no existen para esta
# marca). Mapeo CONFIRMADO con Ezequiel el mismo día: la imagen de
# referencia que mostró tenía un "Familia Delmotte Direct" de $221,6k que
# NO cierra con ningún dato real bajable de Redline en octubre-2026 (la
# suma de TODO lo de FdelMotte esa fecha, cualquier categoría, da
# exacto el "Grupo Colome Domestic" de esa imagen, $9.600,5k, sin nada
# más) -- Ezequiel decidió igual reclasificar DTC+HOSPITALIDAD como
# "Direct" de acá en más, sin perseguir el número exacto de esa imagen
# puntual (podía ser de otro período, u otra fuente).
#
# Last Year: mismo criterio que ya usa `ventas_sbl(fdelmotte=True)` --
# solo real desde `DESDE_HISTORICO` (2025-09-01), no hay fixture LFY para
# FdelMotte (esa fixture es un volcado puntual que Ariel mandó solo para
# la marca Colomé).
# Líneas FIJAS, pedido explícito de Ezequiel 2026-11-02 ("esta son las
# lineas que se tienen que ver... no otras... esto es solo para la
# pestaña del snap de familia del monte"): ni una fila más que estas 6 +
# Grand total / 3 + Grand total, pase lo que pase con los datos crudos --
# a diferencia del resto del SNAP (donde una categoría sin mapear cae en
# "Sin clasificar", SIEMPRE visible, para nunca esconder plata), acá
# Ezequiel pidió lo opuesto explícitamente para esta pestaña puntual: la
# lista es CERRADA. El Grand total suma SOLO estas filas (no el total
# real de todo lo de FdelMotte) para que el total mostrado siempre
# cuadre exacto con lo que se ve arriba -- investigado 2026-11-02: hoy
# no existe ninguna fila de FdelMotte fuera de estas 3 categorías de
# canal (confirmado contra octubre-2026, ver `_fdelmotte_canal`), así
# que en la práctica no hay plata que se pierda.
FDELMOTTE_VARIEDADES_ORDEN = [
    "FAMILIA DELMOTTE CLASICO",
    "FAMILIA DELMOTTE NATURAL",
    "FAMILIA DELMOTTE GSM TINTO",
    "FAMILIA DELMOTTE ASSEMBLAGE BLANCO",
    "FAMILIA DELMOTTE BONARDA",
    "FAMILIA DELMOTTE CORBEAU NATURAL",
]
FDELMOTTE_CANALES_ORDEN = [
    "Grupo Colome Domestic",
    "Familia Delmotte Direct",
    "Grupo Colome Export",
]

FDELMOTTE_CANAL_MAP: list[tuple[set, str]] = [
    (DOMESTIC_WHOLESALE, "Grupo Colome Domestic"),
    (DTC_HOSPITALIDAD, "Familia Delmotte Direct"),
    (EXPORT, "Grupo Colome Export"),
]


def _fdelmotte_canal(it: dict) -> str:
    categoria = it.get("d_categoria") or ""
    for categorias, label in FDELMOTTE_CANAL_MAP:
        if categoria in categorias:
            return label
    return "Sin clasificar"


def _agregado_fdelmotte(desde: date, hasta_incl: date, *, por: str) -> dict[str, list[float]]:
    """{label: [ars, cajas]} -- `por='variedad'` agrupa por `d_articulo`,
    `por='canal'` agrupa vía `_fdelmotte_canal`. ARS (no USD) porque el
    total reconcilia exacto contra la imagen de referencia de Ezequiel
    dividiendo `valor_mon_loc` por 1000 -- el SNAP de FdelMotte reporta en
    moneda local, a diferencia del de Colomé (USD)."""
    acc: dict[str, list[float]] = {}
    for it in _filas_universo(desde, hasta_incl, fdelmotte=True):
        label = (it.get("d_articulo") or "Sin artículo") if por == "variedad" else _fdelmotte_canal(it)
        a = acc.setdefault(label, [0.0, 0.0])
        a[0] += float(it.get("valor_mon_loc") or 0)
        a[1] += float(it.get("cantidad_cajas9l") or 0)
    return acc


def _filas_fdelmotte_tabla(desde: date, hasta_incl: date, por: str) -> list[dict]:
    agg = _agregado_fdelmotte(desde, hasta_incl, por=por)
    desde_ly = date(desde.year - 1, desde.month, desde.day)
    hasta_ly = date(hasta_incl.year - 1, hasta_incl.month, hasta_incl.day)
    ly = _agregado_fdelmotte(desde_ly, hasta_ly, por=por) if desde_ly >= DESDE_HISTORICO else None

    # Lista FIJA (ver FDELMOTTE_VARIEDADES_ORDEN/FDELMOTTE_CANALES_ORDEN
    # arriba, pedido explícito de Ezequiel: "no otras") -- nunca las
    # labels que traigan los datos crudos. Mismo criterio resuelve el BUG
    # REAL encontrado validando en vivo el mismo día (Grand total LY de
    # "Por canal" daba $7.156k vs $7.944k de "Por variedad", debería ser
    # el MISMO número): antes el loop recorría solo los labels del
    # período ACTUAL, perdiendo el LY de un canal con venta el año
    # pasado pero cero en el actual (ej. "Grupo Colome Export", sin
    # exportaciones en oct-2026 pero con ARS 787k en oct-2025) -- al
    # recorrer la lista fija completa (que YA incluye Export) en vez de
    # `agg.keys()`, ese caso queda cubierto de taquito.
    labels = FDELMOTTE_VARIEDADES_ORDEN if por == "variedad" else FDELMOTTE_CANALES_ORDEN
    out = []
    for label in labels:
        ars, cajas = agg.get(label, [0.0, 0.0])
        row = {"label": label, "ars": round(ars / 1000, 4), "cajas": round(cajas, 4)}
        if ly is not None:
            ars_ly, cajas_ly = ly.get(label, [0.0, 0.0])
            row["ars_ly"] = round(ars_ly / 1000, 4)
            row["cajas_ly"] = round(cajas_ly, 4)
            row["ars_vs_ly"] = (ars - ars_ly) / ars_ly if ars_ly else ("N/A" if ars == 0 else 1.0)
            row["cajas_vs_ly"] = (cajas - cajas_ly) / cajas_ly if cajas_ly else ("N/A" if cajas == 0 else 1.0)
        else:
            row["ars_ly"] = None
            row["cajas_ly"] = None
            row["ars_vs_ly"] = "N/A"
            row["cajas_vs_ly"] = "N/A"
        out.append(row)

    total_ars = sum(r["ars"] for r in out)
    total_cajas = sum(r["cajas"] for r in out)
    total: dict = {"label": "Grand total", "ars": round(total_ars, 4), "cajas": round(total_cajas, 4)}
    if ly is not None:
        total_ars_ly = sum((r["ars_ly"] or 0) for r in out)
        total_cajas_ly = sum((r["cajas_ly"] or 0) for r in out)
        total["ars_ly"] = round(total_ars_ly, 4)
        total["cajas_ly"] = round(total_cajas_ly, 4)
        total["ars_vs_ly"] = (total_ars - total_ars_ly) / total_ars_ly if total_ars_ly else ("N/A" if total_ars == 0 else 1.0)
        total["cajas_vs_ly"] = (total_cajas - total_cajas_ly) / total_cajas_ly if total_cajas_ly else ("N/A" if total_cajas == 0 else 1.0)
    else:
        total["ars_ly"] = None
        total["cajas_ly"] = None
        total["ars_vs_ly"] = "N/A"
        total["cajas_vs_ly"] = "N/A"
    out.append(total)
    return out


def ventas_fdelmotte(desde: date, hasta_incl: date) -> dict:
    """SNAP real de FdelMotte: {"por_variedad": [...], "por_canal": [...]}
    -- 2 tablas independientes, cada una con su propia fila "Grand total"
    (ver comentario arriba de `FDELMOTTE_CANAL_MAP` para el detalle
    completo de la estructura y las decisiones de clasificación)."""
    return {
        "por_variedad": _filas_fdelmotte_tabla(desde, hasta_incl, "variedad"),
        "por_canal": _filas_fdelmotte_tabla(desde, hasta_incl, "canal"),
    }


def desglose_mercado(label: str, desde: date, hasta_incl: date, fdelmotte: bool = False) -> list[dict]:
    """Desglose por mercado (provincia Argentina / Exterior, mismo catálogo
    ya validado que usa Ventas por Jurisdicción -- jurisdiccion_mapa en
    Datos Maestros) de las filas que componen una línea/total de Sales by
    Line of Business. Pedido explícito de Ezequiel 2026-10-21: poder hacer
    clic en una línea del SNAP y ver el "Sales by Market" correspondiente a
    ESA línea, en vivo (el Sales by Market mock de ~40 países se había
    sacado el 2026-10-19 por no estar conectado -- ver ARQUITECTURA.md).
    Usa la MISMA fuente/filtro que `_agregado_sbl` (`_lineas_vinos`, vía
    `_filas_universo`) para no divergir del total que ya se ve en la fila."""
    from jurisdiccion import _mapa_jurisdiccion
    reglas = _mapa_linea_negocio()
    mapa_jur = _mapa_jurisdiccion()
    acc: dict[str, list[float]] = {}
    for it in _filas_universo(desde, hasta_incl, fdelmotte):
        leaf = _clasificar_leaf(it, reglas)
        if not _label_matches(label, it, leaf):
            continue
        mercado = mapa_jur.get(it.get("n_provincia") or "", "Sin clasificar")
        usd = float(it.get("valor_venta_mon_alt") or 0)
        cajas = float(it.get("cantidad_cajas9l") or 0)
        a = acc.setdefault(mercado, [0.0, 0.0])
        a[0] += usd
        a[1] += cajas
    out = [{"mercado": m, "usd": round(v[0] / 1000, 4), "cajas": round(v[1], 4)} for m, v in acc.items()]
    out.sort(key=lambda r: -r["usd"])
    return out


def _agregado_sbl(desde: date, hasta_incl: date, fdelmotte: bool = False) -> dict[str, list[float]]:
    """{linea: [usd, cajas, costo_usd]} para el rango dado.

    REFACTOR 2026-10-19 (pedido explícito de Ezequiel: "no tenemos que
    partir de cosas distintas, los mismos 1676 asignandole la
    clasificacion tienen que ir al snap"): antes esta función tenía su
    PROPIO loop `_fetch_dia`+dedupe+filtro TIPOS_VALIDOS/GRUPO_VALIDO,
    reimplementado en paralelo al de `_lineas_vinos()` (el generador que ya
    usa Otros Análisis -> Por Cliente/SKU/Vendedor, y por el que también se
    guía Panel de Ventas). Dos pipelines separados para el MISMO universo
    de datos es la causa estructural de que puedan divergir -- cualquier
    corrección futura (ej. el fix de doble-signo de NC) tenía que aplicarse
    dos veces y podía quedar desincronizada. Ahora Sales by Line of
    Business CONSUME el mismo generador que el resto de la app: la
    clasificación en líneas de negocio se aplica como una capa sobre las
    MISMAS filas, no sobre una reconsulta independiente a ig_ventas.

    `fdelmotte=True` (agregado 2026-10-22, pedido "llevá FdelMotte al mismo
    formato que Consolidado"): agrega SOLO las filas de FdelMotte -- antes
    esta función las excluía sin opción, FdelMotte se armaba aparte en
    app.js sin comparativo LY ni desglose por línea/mercado. MISMA lógica
    de clasificación (`snap_linea_negocio_mapa` filtra por centro_costo/
    categoria/canal_venta, no por marca, así que aplica igual de bien). Si
    FdelMotte tiene canales que Colomé no usa (ej. sin Hotel/Visitor Center
    propios), esas filas caen en "Sin clasificar" -- visible, no se
    pierden (mismo criterio que el resto del módulo). Mismo criterio de
    separación de marcas ya confirmado con Ariel Culasso 2026-10-09 para
    Panel de Ventas (ver proyecto_colome_fdelmotte_separada) -- lo que
    cambia acá es que FdelMotte ahora tiene SU PROPIO Sales by Line of
    Business en vez de solo gráficos de Top clientes/productos."""
    reglas = _mapa_linea_negocio()
    acc: dict[str, list[float]] = {}
    for it in _filas_universo(desde, hasta_incl, fdelmotte):
        categoria = it.get("d_categoria") or ""
        if categoria in DOMESTIC_WHOLESALE:
            linea = "Grupo Colome Domestic"
        elif categoria in EXPORT:
            linea = "Grupo Colome Export"
        elif categoria in DTC_HOSPITALIDAD:
            linea = _clasificar_dtc(it, reglas)
        else:
            # categoria fuera de las 6 conocidas -- no debería pasar nunca,
            # pero antes de la fila "Sin clasificar" (2026-10-19) esto se
            # perdía en silencio de TODOS los totales (bug real: el bucket
            # "Otro" se acumulaba pero ninguna fila lo leía).
            linea = "Sin clasificar"
        usd_linea = float(it.get("valor_venta_mon_alt") or 0)
        usd = usd_linea
        cajas = float(it.get("cantidad_cajas9l") or 0)
        costo_linea = float(it.get("costo_unit_mon_alt") or 0) * float(it.get("cantidad") or 0)
        # Guarda contra costo_unit_mon_alt corrupto en el origen (ej.
        # "AMALAYA BLANCO DULCE" vendida por VENTA AL PERSONAL en
        # agosto-2026: costo unitario de ~USD 1.87M contra un precio de
        # venta de ~USD 2.70 -- rompía el %MG a valores sin sentido como
        # -19753%). Dos condiciones, cualquiera descarta ESE costo
        # puntual (no el ingreso): 1) supera 10x su propio ingreso
        # (cuando hay ingreso), o 2) supera un techo absoluto de USD 500
        # -- necesario SOLO con la condición 1 el guard no disparaba en
        # líneas de ingreso EXACTAMENTE 0 (ej. degustación gratis/100%
        # desc.), porque `if usd_linea` es falsy con 0.0 y el costo
        # corrupto pasaba entero. Hasta que Ariel/Redline confirme el
        # dato real -- pedido explícito de Ezequiel 2026-10-19.
        TECHO_COSTO_ABSOLUTO = 500.0
        if (usd_linea and costo_linea > usd_linea * 10) or costo_linea > TECHO_COSTO_ABSOLUTO:
            costo_linea = 0.0
        costo_usd = costo_linea
        a = acc.setdefault(linea, [0.0, 0.0, 0.0])
        a[0] += usd
        a[1] += cajas
        a[2] += costo_usd
        # AirLines es informativo DENTRO de Domestic, no se resta/separa
        if categoria in DOMESTIC_WHOLESALE and it.get("d_canal_venta") == "AEROPUERTOS":
            b = acc.setdefault("Grupo Colome Domestic - AirLines", [0.0, 0.0, 0.0])
            b[0] += usd
            b[1] += cajas
            b[2] += costo_usd
    return acc


DTC_LINEAS_FIJAS = ["Employees", "E-commerce", "Colome Hotel", "Colome Visitor Center", "Cafayate Visitor Center"]


def _fila(label: str, agg: dict[str, list[float]], ly: dict[str, list[float]] | None, sin_costeo: bool = False,
          bud: dict[str, list[float]] | None = None) -> dict:
    usd, cajas, costo_usd = agg.get(label, [0.0, 0.0, 0.0])
    # sin_costeo=True (Domestic/Export/AirLines, canal mayorista): el campo
    # costo_unit_mon_alt viene prácticamente vacío en Redline para ese canal
    # (verificado 2026-10-19: USD 2,26 de costo sobre USD 219.980 de venta
    # en agosto-2026, 896 líneas) -- mostrar el %MG ahí daría ~100%, un
    # número engañoso, no un margen real. Se marca N/A en vez de ocultar el
    # hallazgo con un cálculo que no refleja la realidad.
    gm_act = "N/A" if sin_costeo else ((usd - costo_usd) / usd if usd else "N/A")
    out = {
        "label": label,
        "usd_act": round(usd / 1000, 4),
        "lit_act": round(cajas, 4),
        "gm_act": gm_act,
    }
    if ly is not None:
        usd_ly, cajas_ly, _ = ly.get(label, [0.0, 0.0, 0.0])
        out["usd_ly"] = round(usd_ly / 1000, 4)
        out["lit_ly"] = round(cajas_ly, 4)
        out["usd_vs_ly"] = (usd - usd_ly) / usd_ly if usd_ly else ("N/A" if usd == 0 else 1.0)
        out["lit_vs_ly"] = (cajas - cajas_ly) / cajas_ly if cajas_ly else ("N/A" if cajas == 0 else 1.0)
    else:
        out["usd_ly"] = None
        out["lit_ly"] = None
        out["usd_vs_ly"] = "N/A"
        out["lit_vs_ly"] = "N/A"
    if bud is not None and label in bud:
        usd_bud, cajas_bud = bud[label]
        out["usd_bud"] = round(usd_bud / 1000, 4)
        out["lit_bud"] = round(cajas_bud, 4)
        out["usd_vs_bud"] = (usd - usd_bud) / usd_bud if usd_bud else ("N/A" if usd == 0 else 1.0)
        out["lit_vs_bud"] = (cajas - cajas_bud) / cajas_bud if cajas_bud else ("N/A" if cajas == 0 else 1.0)
    else:
        out["usd_bud"] = None
        out["lit_bud"] = None
        out["usd_vs_bud"] = "N/A"
        out["lit_vs_bud"] = "N/A"
    return out


def _cero(label: str) -> dict:
    # BUG REAL corregido 2026-10-20: usd_ly=None (no 0.0) hacía que
    # `_sumar()` tratara a TOTAL SALES TO THIRD PARTIES/TOTAL SALES como
    # "sin LY" en TODOS los casos (con_ly exige que NINGUNA fila tenga
    # usd_ly=None) -- aunque Brand/DTC/Sin clasificar sí tuvieran LY real,
    # bastaba que BOB/Intercompany (fijos en 0, siempre `_cero()`)
    # contaminaran el chequeo para que los totales de arriba mostraran
    # "n/d" sin necesidad. BOB/Intercompany son 0 FIJO en CUALQUIER año
    # (no hay ventas reales bajo esos canales, ver docstring del módulo),
    # así que 0.0 es un LY tan válido como el actual -- no un "no hay
    # dato", sino un "el dato real es cero".
    return {"label": label, "usd_act": 0.0, "lit_act": 0.0, "gm_act": "N/A",
            "usd_ly": 0.0, "lit_ly": 0.0, "usd_vs_ly": "N/A", "lit_vs_ly": "N/A",
            "usd_bud": 0.0, "lit_bud": 0.0, "usd_vs_bud": "N/A", "lit_vs_bud": "N/A"}


def _sumar(label: str, filas: list[dict]) -> dict:
    usd = round(sum(f["usd_act"] for f in filas), 4)
    lit = round(sum(f["lit_act"] for f in filas), 4)
    con_ly = all(f["usd_ly"] is not None for f in filas) and len(filas) > 0
    out = {"label": label, "usd_act": usd, "lit_act": lit, "gm_act": "N/A"}
    if con_ly:
        usd_ly = round(sum(f["usd_ly"] for f in filas), 4)
        lit_ly = round(sum(f["lit_ly"] for f in filas), 4)
        out["usd_ly"] = usd_ly
        out["lit_ly"] = lit_ly
        out["usd_vs_ly"] = (usd - usd_ly) / usd_ly if usd_ly else ("N/A" if usd == 0 else 1.0)
        out["lit_vs_ly"] = (lit - lit_ly) / lit_ly if lit_ly else ("N/A" if lit == 0 else 1.0)
    else:
        out["usd_ly"] = None
        out["lit_ly"] = None
        out["usd_vs_ly"] = "N/A"
        out["lit_vs_ly"] = "N/A"
    con_bud = all(f.get("usd_bud") is not None for f in filas) and len(filas) > 0
    if con_bud:
        usd_bud = round(sum(f["usd_bud"] for f in filas), 4)
        lit_bud = round(sum(f["lit_bud"] for f in filas), 4)
        out["usd_bud"] = usd_bud
        out["lit_bud"] = lit_bud
        out["usd_vs_bud"] = (usd - usd_bud) / usd_bud if usd_bud else ("N/A" if usd == 0 else 1.0)
        out["lit_vs_bud"] = (lit - lit_bud) / lit_bud if lit_bud else ("N/A" if lit == 0 else 1.0)
    else:
        out["usd_bud"] = None
        out["lit_bud"] = None
        out["usd_vs_bud"] = "N/A"
        out["lit_vs_bud"] = "N/A"
    return out


def _meses_en_rango(desde: date, hasta_incl: date) -> list[tuple[int, int]]:
    out = []
    anio, mes = desde.year, desde.month
    while date(anio, mes, 1) <= hasta_incl:
        out.append((anio, mes))
        anio, mes = (anio + 1, 1) if mes == 12 else (anio, mes + 1)
    return out


def _agregado_sbl_con_lfy(desde: date, hasta_incl: date) -> dict[str, list[float]]:
    """Igual que `_agregado_sbl`, pero completa con la fixture LFY (ver
    arriba) los meses del rango que caen ANTES de `DESDE_HISTORICO`
    (ig_ventas no tiene datos ahí para atrás). Asume rangos alineados a
    mes calendario completo -- único patrón que usa `ventas_sbl` (meses
    cerrados, YTD desde el inicio del ejercicio fiscal), la fixture LFY
    solo tiene totales mensuales, no permite partir un mes a la mitad."""
    acc: dict[str, list[float]] = {}
    lfy = None
    for anio, mes in _meses_en_rango(desde, hasta_incl):
        mes_ini = date(anio, mes, 1)
        mes_fin_excl = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
        mes_fin = mes_fin_excl - timedelta(days=1)
        d0, d1 = max(mes_ini, desde), min(mes_fin, hasta_incl)
        if mes_ini < DESDE_HISTORICO:
            if lfy is None:
                lfy = _lfy_agregado()
            periodo = f"{anio:04d}-{mes:02d}"
            for (p, linea), v in lfy.items():
                if p != periodo:
                    continue
                a = acc.setdefault(linea, [0.0, 0.0, 0.0])
                for i in range(3):
                    a[i] += v[i]
        else:
            sub = _agregado_sbl(d0, d1)
            for linea, v in sub.items():
                a = acc.setdefault(linea, [0.0, 0.0, 0.0])
                for i in range(3):
                    a[i] += v[i]
    return acc


def ventas_sbl(desde: date, hasta_incl: date, fdelmotte: bool = False) -> list[dict | None]:
    """Filas de Sales by Line of Business para el rango [desde, hasta_incl].
    LY se calcula para el mismo rango corrido un año atrás, combinando la
    fixture LFY (jul-ago 2025) con el histórico real en vivo para el resto
    del rango -- `None` solo si ni siquiera eso alcanza (LY antes de
    `LFY_DESDE`, 2025-07-01).

    `fdelmotte=True` (2026-10-22): la fixture LFY es un volcado puntual de
    `LFY.xlsx` que Ariel mandó para la marca Colomé -- no existe el
    equivalente para FdelMotte, así que acá el LY se apoya SOLO en el
    histórico real en vivo (desde `DESDE_HISTORICO`, 2025-09-01). Un rango
    de LY que cae antes de esa fecha queda en `None` ("n/d"), igual que
    cualquier otro hueco sin dato real en el resto del módulo -- no se
    inventa ni se aproxima."""
    agg = _agregado_sbl(desde, hasta_incl, fdelmotte)

    desde_ly = date(desde.year - 1, desde.month, desde.day)
    hasta_ly = date(hasta_incl.year - 1, hasta_incl.month, hasta_incl.day)
    if fdelmotte:
        ly = _agregado_sbl(desde_ly, hasta_ly, fdelmotte=True) if desde_ly >= DESDE_HISTORICO else None
    else:
        ly = _agregado_sbl_con_lfy(desde_ly, hasta_ly) if desde_ly >= LFY_DESDE else None

    # Budget por línea: solo existe para la marca Colomé (el reporte SNAP de
    # FdelMotte, cuando exista, es un universo aparte -- ver docstring de
    # `_agregado_budget_linea` más arriba).
    bud = _agregado_budget_linea(desde, hasta_incl) if not fdelmotte else None

    domestic = _fila("Grupo Colome Domestic", agg, ly, sin_costeo=True, bud=bud)
    export_ = _fila("Grupo Colome Export", agg, ly, sin_costeo=True, bud=bud)
    brand_total = _sumar("Total Grupo Colome Brand", [domestic, export_])

    dtc_fijas = [_fila(l, agg, ly, bud=bud) for l in DTC_LINEAS_FIJAS]
    dtc_channel = _sumar("Direct-to-consumer Channel", dtc_fijas)

    # "Sin clasificar" (2026-10-19, pedido explícito de Ezequiel) -- SIEMPRE
    # se muestra, incluso en 0, para que quede claro que no hay plata
    # escondida. Hermano de Brand/DTC/BOB en TOTAL SALES TO THIRD PARTIES,
    # no anidado dentro de Direct-to-consumer Channel (puede venir de DTC/
    # HOSPITALIDAD sin regla matcheada O de una categoria completamente
    # fuera de las 6 conocidas -- ver _agregado_sbl). No tiene fila propia
    # en el SNAP real -- Budget fijo en 0 (igual que BOB/Intercompany vía
    # `_cero`), para no tirar a "n/d" el Budget de TOTAL SALES TO THIRD
    # PARTIES/TOTAL SALES por un residuo que de por sí casi siempre es 0.
    sin_clasificar = _fila("Sin clasificar", agg, ly, bud={"Sin clasificar": [0.0, 0.0]})

    bob_rows = [_cero(l) for l in ("Others",)]
    bob_total = _sumar("Total Buyers Own Brand (BOB)", bob_rows)

    tercero_total = _sumar("TOTAL SALES TO THIRD PARTIES", [brand_total, dtc_channel, bob_total, sin_clasificar])

    uy = _cero("GC Wines Uruguay S.A.")
    intercompany_total = _sumar("Total Intercompany Sales", [uy])

    total = _sumar("TOTAL SALES", [tercero_total, intercompany_total])

    # Filas mostradas = las filas NO ocultas en el SNAP real de Ariel (SNAP
    # I September 2026 - NM - VSP 2.xls, hoja "Sales by line of bussines",
    # confirmado con xlrd leyendo el flag `hidden` de cada fila -- Ezequiel
    # sospechó que estaba viendo filas ocultas del Excel, y así era) MÁS la
    # fila "Sin clasificar" (que el SNAP real no tiene porque ya viene
    # depurado a mano -- acá sí puede haber datos sin mapear, y pedido
    # explícito es que nunca se escondan). Ocultas del SNAP real: "Grupo
    # Colome Domestic - AirLines" (informativo, sigue sumado DENTRO de
    # Domestic), todo "Total Buyers Own Brand (BOB)" (Ascension */Others/
    # subtotal -- 0 fijo) y todo "Total Intercompany Sales" (GC Wines
    # Uruguay S.A. -- 0 fijo) -- `bob_rows`/`bob_total` y
    # `uy`/`intercompany_total` se siguen calculando (entran en
    # `tercero_total`/`total`), solo no se exponen como fila propia.
    return [
        domestic, export_, brand_total,
        None,
        *dtc_fijas, dtc_channel,
        None,
        sin_clasificar,
        None,
        tercero_total,
        None,
        total,
    ]


def combos_sin_clasificar(desde: date, hasta_incl: date) -> list[dict]:
    """Combinaciones centro_costo/categoria/canal_venta (dentro de DTC/
    HOSPITALIDAD) que cayeron en "Sin clasificar" -- para que Datos
    Maestros pueda mostrarlas y el admin agregue la regla que falta."""
    reglas = _mapa_linea_negocio()
    conteo: dict[tuple, int] = {}
    for it in _lineas_vinos(desde, hasta_incl):
        categoria = it.get("d_categoria") or ""
        if categoria not in DTC_HOSPITALIDAD:
            continue
        if _clasificar_dtc(it, reglas) != "Sin clasificar":
            continue
        k = (it.get("d_centro_costo") or "", categoria, it.get("d_canal_venta") or "")
        conteo[k] = conteo.get(k, 0) + 1
    out = [
        {"centro_costo": cc, "categoria": cat, "canal_venta": cv, "filas": n}
        for (cc, cat, cv), n in conteo.items()
    ]
    out.sort(key=lambda r: -r["filas"])
    return out


DESDE_HISTORICO = date(2025, 9, 1)  # mismo arranque del histórico real que panel_ventas.py/otros_analisis.py/auditoria.py


def _rango_mes(anio: int, mes: int) -> tuple[date, date]:
    desde = date(anio, mes, 1)
    hasta_excl = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    return desde, hasta_excl - timedelta(days=1)


def _mes_cerrado_anterior() -> tuple[date, date]:
    hoy = date.today()
    anio, mes = (hoy.year, hoy.month - 1) if hoy.month > 1 else (hoy.year - 1, 12)
    return _rango_mes(anio, mes)


def _meses_disponibles() -> list[str]:
    """Lista "YYYY-MM" desde el inicio del histórico real hasta el último
    mes cerrado -- para poblar el selector de mes del sidebar (pedido
    explícito de Ezequiel 2026-10-19: "en el sidebar tiene que decir qué
    mes querés ver")."""
    _, hasta_cerrado = _mes_cerrado_anterior()
    out = []
    anio, mes = DESDE_HISTORICO.year, DESDE_HISTORICO.month
    while date(anio, mes, 1) <= hasta_cerrado:
        out.append(f"{anio:04d}-{mes:02d}")
        anio, mes = (anio + 1, 1) if mes == 12 else (anio, mes + 1)
    return out


def _ly_mensual() -> list[dict]:
    """TOTAL SALES actual+LY por mes calendario, desde `LFY_DESDE`
    (2025-07) hasta el último mes cerrado -- agregado 2026-10-20 para que
    Panel de Ventas pueda mostrar LY para CUALQUIER combinación de
    períodos que el usuario tilde en el sidebar (antes `snapRef()` en
    app.js solo reconocía 3 casos fijos: P01, P02, P01+P02, justo los
    únicos 2 meses que en su momento tenían LY real. Con LFY (jul-ago
    2025) + histórico real en vivo (set-2025 en adelante) ya hay LY para
    TODO el rango que muestra Panel de Ventas, no solo esos 2 meses --
    Ezequiel: "si, asi tenemos todo el ly y empezamos a completar todas
    las hojas"). Un mes sin LY real (ej. jul-2025, que necesitaría
    jul-2024) queda con `usd_ly=None` -- el frontend decide si mostrar
    "n/d" según qué meses necesite sumar.

    `usd_bud`/`lit_bud` agregados el mismo día con el Budget real del
    ejercicio ACTUAL 2026-2027 (ver `_budget_mensual` -- corregido el
    mismo día, el archivo de origen lo etiquetaba mal como "2025-2026")
    -- `None` para cualquier mes fuera de ese ejercicio."""
    _, hasta_cerrado = _mes_cerrado_anterior()
    budget = _budget_mensual()
    out = []
    anio, mes = LFY_DESDE.year, LFY_DESDE.month
    while date(anio, mes, 1) <= hasta_cerrado:
        mes_ini, mes_fin = _rango_mes(anio, mes)
        filas = ventas_sbl(mes_ini, mes_fin)
        tot = next((f for f in filas if f and f["label"] == "TOTAL SALES"), None)
        periodo = f"{anio:04d}-{mes:02d}"
        bud = budget.get(periodo)
        out.append({
            "periodo": periodo,
            "usd_act": tot["usd_act"] if tot else 0.0,
            "lit_act": tot["lit_act"] if tot else 0.0,
            "usd_ly": tot["usd_ly"] if tot else None,
            "lit_ly": tot["lit_ly"] if tot else None,
            "usd_bud": round(bud[0] / 1000, 4) if bud else None,
            "lit_bud": round(bud[1], 4) if bud else None,
        })
        anio, mes = (anio + 1, 1) if mes == 12 else (anio, mes + 1)
    return out


def require_reader(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


@router.get("/snap/mercado")
async def snap_mercado(
    label: str,
    desde: str,
    hasta: str,
    fdelmotte: bool = False,
    user=Depends(require_reader),
):
    """Popup "Sales by Market" de una línea puntual de Sales by Line of
    Business -- `desde`/`hasta` (YYYY-MM-DD) vienen del frontend, que pasa
    el MISMO rango que ya está mostrando (Monthly o YTD, ver snap.js).
    `fdelmotte` (2026-10-22): mismo popup para la pestaña FdelMotte del
    SNAP, ver `ventas_sbl`."""
    d0 = date.fromisoformat(desde)
    d1 = date.fromisoformat(hasta)
    return {"label": label, "desde": desde, "hasta": hasta, "rows": desglose_mercado(label, d0, d1, fdelmotte=fdelmotte)}


@router.get("/snap")
async def snap(mes: str | None = None, fdelmotte: bool = False, user=Depends(require_reader)):
    """{sbl_mes, sbl_ytd, periodo, desde_ytd, hasta_ytd, meses_disponibles,
    ly_mensual}.
    `mes` (query param "YYYY-MM", opcional) elige qué mes mostrar en
    "Monthly" -- y hasta qué mes llega el YTD (desde el inicio del
    ejercicio fiscal). Sin `mes`, default al último mes calendario CERRADO
    (el actual todavía puede recibir comprobantes tarde). Selector pedido
    explícito de Ezequiel 2026-10-19 -- antes el mes cerrado era fijo, sin
    forma de elegir otro.

    `fdelmotte=True`: SNAP real de FdelMotte, ESTRUCTURA DISTINTA desde
    2026-11-02 (ver `ventas_fdelmotte` -- 2 tablas por variedad/canal, ya
    no la jerarquía de Sales by Line of Business de Colomé que se
    reusaba desde el 2026-10-22). Devuelve `fdelmotte_variedad_mes`/
    `_ytd` y `fdelmotte_canal_mes`/`_ytd` en vez de `sbl_mes`/`sbl_ytd`.
    `ly_mensual` se omite acá (solo lo consume la tabla comparativa de
    Panel de Ventas, que es exclusiva de Colomé, no de esta pestaña) para
    no calcular un SNAP completo de 12+ meses de más en cada request."""
    disponibles = _meses_disponibles()
    if mes and mes in disponibles:
        anio, mes_num = (int(x) for x in mes.split("-"))
        desde_mes, hasta_mes = _rango_mes(anio, mes_num)
    else:
        desde_mes, hasta_mes = _mes_cerrado_anterior()
    desde_ytd = inicio_ejercicio_fiscal(hasta_mes)
    if desde_ytd > desde_mes:
        desde_ytd = desde_mes
    base = {
        "periodo": hasta_mes.strftime("%Y-%m"),
        "desde_ytd": desde_ytd.isoformat(),
        "hasta_ytd": hasta_mes.isoformat(),
        "meses_disponibles": disponibles,
    }
    if fdelmotte:
        fd_mes = ventas_fdelmotte(desde_mes, hasta_mes)
        fd_ytd = ventas_fdelmotte(desde_ytd, hasta_mes)
        base["fdelmotte_variedad_mes"] = fd_mes["por_variedad"]
        base["fdelmotte_variedad_ytd"] = fd_ytd["por_variedad"]
        base["fdelmotte_canal_mes"] = fd_mes["por_canal"]
        base["fdelmotte_canal_ytd"] = fd_ytd["por_canal"]
        base["ly_mensual"] = []
    else:
        base["sbl_mes"] = ventas_sbl(desde_mes, hasta_mes)
        base["sbl_ytd"] = ventas_sbl(desde_ytd, hasta_mes)
        base["ly_mensual"] = _ly_mensual()
    return base
