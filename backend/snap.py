"""Sales Performance (SNAP) -> Sales by Line of Business, conectado en vivo
a ig_ventas (2026-10-19, pedido explícito de Ezequiel: conectar el SNAP y
"configurar desde datos maestros qué se expone en cada línea"). Reemplaza
el dataset mock estático (`public/ventas/colome-data.json`, clave `sbl_aug`/
`sbl_ytd`) -- MISMO esquema de filas que consumía `snap.js`, pero sin
columnas de Budget/Forecast (decisión confirmada 2026-10-09: "nunca existió
un dato real, se saca").

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


def _agregado_sbl(desde: date, hasta_incl: date) -> dict[str, list[float]]:
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
    MISMAS filas, no sobre una reconsulta independiente a ig_ventas."""
    reglas = _mapa_linea_negocio()
    acc: dict[str, list[float]] = {}
    for it in _lineas_vinos(desde, hasta_incl):
        if it.get("d_rubro") == "FDELMOTTE **":
            # FdelMotte tiene su propio SNAP separado (pestaña "FdelMotte"
            # de esta misma hoja) -- queda pre-excluida de "la estadística
            # de ventas" (Sales by Line of Business), aclarado explícito
            # por Ezequiel 2026-10-19 al corregir una mala interpretación
            # de un pedido anterior ("no me refiero a familia del monte,
            # tiene su propio snap"). Mismo criterio ya confirmado con
            # Ariel Culasso 2026-10-09 para Panel de Ventas (ver
            # proyecto_colome_fdelmotte_separada).
            continue
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


def _fila(label: str, agg: dict[str, list[float]], ly: dict[str, list[float]] | None, sin_costeo: bool = False) -> dict:
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
            "usd_ly": 0.0, "lit_ly": 0.0, "usd_vs_ly": "N/A", "lit_vs_ly": "N/A"}


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


def ventas_sbl(desde: date, hasta_incl: date) -> list[dict | None]:
    """Filas de Sales by Line of Business para el rango [desde, hasta_incl].
    LY se calcula para el mismo rango corrido un año atrás, combinando la
    fixture LFY (jul-ago 2025) con el histórico real en vivo para el resto
    del rango -- `None` solo si ni siquiera eso alcanza (LY antes de
    `LFY_DESDE`, 2025-07-01)."""
    agg = _agregado_sbl(desde, hasta_incl)

    desde_ly = date(desde.year - 1, desde.month, desde.day)
    hasta_ly = date(hasta_incl.year - 1, hasta_incl.month, hasta_incl.day)
    ly = _agregado_sbl_con_lfy(desde_ly, hasta_ly) if desde_ly >= LFY_DESDE else None

    domestic = _fila("Grupo Colome Domestic", agg, ly, sin_costeo=True)
    export_ = _fila("Grupo Colome Export", agg, ly, sin_costeo=True)
    brand_total = _sumar("Total Grupo Colome Brand", [domestic, export_])

    dtc_fijas = [_fila(l, agg, ly) for l in DTC_LINEAS_FIJAS]
    dtc_channel = _sumar("Direct-to-consumer Channel", dtc_fijas)

    # "Sin clasificar" (2026-10-19, pedido explícito de Ezequiel) -- SIEMPRE
    # se muestra, incluso en 0, para que quede claro que no hay plata
    # escondida. Hermano de Brand/DTC/BOB en TOTAL SALES TO THIRD PARTIES,
    # no anidado dentro de Direct-to-consumer Channel (puede venir de DTC/
    # HOSPITALIDAD sin regla matcheada O de una categoria completamente
    # fuera de las 6 conocidas -- ver _agregado_sbl).
    sin_clasificar = _fila("Sin clasificar", agg, ly)

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


def require_reader(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


@router.get("/snap")
async def snap(mes: str | None = None, user=Depends(require_reader)):
    """{sbl_mes, sbl_ytd, periodo, desde_ytd, hasta_ytd, meses_disponibles}.
    `mes` (query param "YYYY-MM", opcional) elige qué mes mostrar en
    "Monthly" -- y hasta qué mes llega el YTD (desde el inicio del
    ejercicio fiscal). Sin `mes`, default al último mes calendario CERRADO
    (el actual todavía puede recibir comprobantes tarde). Selector pedido
    explícito de Ezequiel 2026-10-19 -- antes el mes cerrado era fijo, sin
    forma de elegir otro."""
    disponibles = _meses_disponibles()
    if mes and mes in disponibles:
        anio, mes_num = (int(x) for x in mes.split("-"))
        desde_mes, hasta_mes = _rango_mes(anio, mes_num)
    else:
        desde_mes, hasta_mes = _mes_cerrado_anterior()
    desde_ytd = inicio_ejercicio_fiscal(hasta_mes)
    if desde_ytd > desde_mes:
        desde_ytd = desde_mes
    return {
        "periodo": hasta_mes.strftime("%Y-%m"),
        "desde_ytd": desde_ytd.isoformat(),
        "hasta_ytd": hasta_mes.isoformat(),
        "meses_disponibles": disponibles,
        "sbl_mes": ventas_sbl(desde_mes, hasta_mes),
        "sbl_ytd": ventas_sbl(desde_ytd, hasta_mes),
    }
