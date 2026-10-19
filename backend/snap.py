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
                                Center + Otro DTC/Hospitalidad
  TOTAL SALES TO THIRD PARTIES = Total Grupo Colome Brand
                                  + Direct-to-consumer Channel
                                  + Total Buyers Own Brand (BOB)
  TOTAL SALES = TOTAL SALES TO THIRD PARTIES + Total Intercompany Sales

Partición POR `d_categoria` (universo VINOS **, 6 valores reales posibles,
confirmado 2026-10-09): DBA/DCBA/DNOA -> Grupo Colome Domestic (wholesale),
EXPORTS -> Grupo Colome Export, DTC/HOSPITALIDAD -> Direct-to-consumer
Channel (sub-clasificado por `snap_linea_negocio_mapa`, ver database.py).
Ningún valor de categoria queda sin cubrir -- las combinaciones DTC/
HOSPITALIDAD que no matchean ninguna regla de Datos Maestros caen en "Otro
DTC/Hospitalidad" (se siguen sumando al total, solo no tienen nombre propio
todavía -- el admin agrega la regla faltante desde Datos Maestros).

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
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request

from ig_ventas import TIPOS_VALIDOS, _fetch_dia

router = APIRouter(prefix="/api/ventas", tags=["snap"])

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
    return "Otro DTC/Hospitalidad"


def _agregado_sbl(desde: date, hasta_incl: date) -> dict[str, list[float]]:
    """{linea: [usd, cajas, costo_usd]} para el rango dado."""
    reglas = _mapa_linea_negocio()
    acc: dict[str, list[float]] = {}
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
            if it.get("d_grupo") != "VINOS **":
                continue
            if it.get("d_rubro") == "FDELMOTTE **":
                # FdelMotte existe en ig_ventas pero el Excel/SNAP real de la
                # empresa no la tiene -- se separa del consolidado, mismo
                # criterio ya confirmado con Ariel Culasso 2026-10-09 para
                # Panel de Ventas (ver proyecto_colome_fdelmotte_separada).
                continue
            signo = -1.0 if it.get("d_tipo_compro") == "NOTA CREDITO VENTA" else 1.0
            categoria = it.get("d_categoria") or ""
            if categoria in DOMESTIC_WHOLESALE:
                linea = "Grupo Colome Domestic"
            elif categoria in EXPORT:
                linea = "Grupo Colome Export"
            elif categoria in DTC_HOSPITALIDAD:
                linea = _clasificar_dtc(it, reglas)
            else:
                linea = "Otro"  # categoria fuera de las 6 conocidas -- no debería pasar
            usd_linea = float(it.get("valor_venta_mon_alt") or 0)
            usd = signo * usd_linea
            cajas = signo * float(it.get("cantidad_cajas9l") or 0)
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
            costo_usd = signo * costo_linea
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
        dia += timedelta(days=1)
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
    return {"label": label, "usd_act": 0.0, "lit_act": 0.0, "gm_act": "N/A",
            "usd_ly": None, "lit_ly": None, "usd_vs_ly": "N/A", "lit_vs_ly": "N/A"}


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


def ventas_sbl(desde: date, hasta_incl: date) -> list[dict | None]:
    """Filas de Sales by Line of Business para el rango [desde, hasta_incl].
    LY se calcula para el mismo rango corrido un año atrás, SOLO si ese
    rango cae dentro del histórico real (>= 2025-09-01)."""
    DESDE_HISTORICO = date(2025, 9, 1)
    agg = _agregado_sbl(desde, hasta_incl)

    desde_ly = date(desde.year - 1, desde.month, desde.day)
    hasta_ly = date(hasta_incl.year - 1, hasta_incl.month, hasta_incl.day)
    ly = _agregado_sbl(desde_ly, hasta_ly) if desde_ly >= DESDE_HISTORICO else None

    domestic = _fila("Grupo Colome Domestic", agg, ly, sin_costeo=True)
    export_ = _fila("Grupo Colome Export", agg, ly, sin_costeo=True)
    brand_total = _sumar("Total Grupo Colome Brand", [domestic, export_])

    dtc_fijas = [_fila(l, agg, ly) for l in DTC_LINEAS_FIJAS]
    otro_dtc = _fila("Otro DTC/Hospitalidad", agg, ly)
    dtc_channel = _sumar("Direct-to-consumer Channel", dtc_fijas + [otro_dtc])

    bob_rows = [_cero(l) for l in ("Others",)]
    bob_total = _sumar("Total Buyers Own Brand (BOB)", bob_rows)

    tercero_total = _sumar("TOTAL SALES TO THIRD PARTIES", [brand_total, dtc_channel, bob_total])

    uy = _cero("GC Wines Uruguay S.A.")
    intercompany_total = _sumar("Total Intercompany Sales", [uy])

    total = _sumar("TOTAL SALES", [tercero_total, intercompany_total])

    # Filas mostradas = exactamente las filas NO ocultas en el SNAP real de
    # Ariel (SNAP I September 2026 - NM - VSP 2.xls, hoja "Sales by line of
    # bussines", confirmado con xlrd leyendo el flag `hidden` de cada fila
    # -- Ezequiel sospechó que estaba viendo filas ocultas del Excel, y así
    # era). Ocultas ahí (y acá): "Grupo Colome Domestic - AirLines" (dato
    # informativo, sigue sumado DENTRO de Domestic), todo "Total Buyers Own
    # Brand (BOB)" (Ascension */Others/subtotal -- 0 fijo, ver
    # investigación arriba) y todo "Total Intercompany Sales" (GC Wines
    # Uruguay S.A. -- también 0 fijo). `airlines`, `bob_rows`/`bob_total` y
    # `uy`/`intercompany_total` se siguen calculando (entran en
    # `tercero_total`/`total` igual que en el SNAP real), solo no se
    # exponen como fila propia.
    return [
        domestic, export_, brand_total,
        None,
        *dtc_fijas, dtc_channel,
        None,
        tercero_total,
        None,
        total,
    ]


def combos_sin_clasificar(desde: date, hasta_incl: date) -> list[dict]:
    """Combinaciones centro_costo/categoria/canal_venta (dentro de DTC/
    HOSPITALIDAD) que cayeron en "Otro DTC/Hospitalidad" -- para que Datos
    Maestros pueda mostrarlas y el admin agregue la regla que falta."""
    reglas = _mapa_linea_negocio()
    conteo: dict[tuple, int] = {}
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
            if it.get("d_grupo") != "VINOS **":
                continue
            categoria = it.get("d_categoria") or ""
            if categoria not in DTC_HOSPITALIDAD:
                continue
            if _clasificar_dtc(it, reglas) != "Otro DTC/Hospitalidad":
                continue
            k = (it.get("d_centro_costo") or "", categoria, it.get("d_canal_venta") or "")
            conteo[k] = conteo.get(k, 0) + 1
        dia += timedelta(days=1)
    out = [
        {"centro_costo": cc, "categoria": cat, "canal_venta": cv, "filas": n}
        for (cc, cat, cv), n in conteo.items()
    ]
    out.sort(key=lambda r: -r["filas"])
    return out


def _mes_cerrado_anterior() -> tuple[date, date]:
    hoy = date.today()
    anio, mes = (hoy.year, hoy.month - 1) if hoy.month > 1 else (hoy.year - 1, 12)
    desde = date(anio, mes, 1)
    hasta_excl = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    return desde, hasta_excl - timedelta(days=1)


def require_reader(request: Request):
    from app import get_sso_session
    session = get_sso_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


@router.get("/snap")
async def snap(user=Depends(require_reader)):
    """{sbl_mes, sbl_ytd, periodo, desde_ytd, hasta_ytd} -- "mes" es siempre
    el último mes calendario CERRADO (el actual todavía puede recibir
    comprobantes tarde), "ytd" es desde el inicio del ejercicio fiscal
    (julio) hasta ese mismo mes cerrado."""
    desde_mes, hasta_mes = _mes_cerrado_anterior()
    desde_ytd = inicio_ejercicio_fiscal(hasta_mes)
    if desde_ytd > desde_mes:
        desde_ytd = desde_mes
    return {
        "periodo": hasta_mes.strftime("%Y-%m"),
        "desde_ytd": desde_ytd.isoformat(),
        "hasta_ytd": hasta_mes.isoformat(),
        "sbl_mes": ventas_sbl(desde_mes, hasta_mes),
        "sbl_ytd": ventas_sbl(desde_ytd, hasta_mes),
    }
