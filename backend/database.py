import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "/data/colome-ventas.db")


def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS afip_comprobantes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            tipo TEXT NOT NULL,
            punto_venta TEXT NOT NULL,
            numero_desde TEXT NOT NULL,
            numero_hasta TEXT,
            cod_autorizacion TEXT,
            tipo_doc_receptor TEXT,
            nro_doc_receptor TEXT,
            denominacion_receptor TEXT,
            tipo_cambio REAL,
            moneda TEXT,
            imp_neto_gravado REAL,
            imp_neto_no_gravado REAL,
            imp_op_exentas REAL,
            otros_tributos REAL,
            iva REAL,
            imp_total REAL,
            periodo TEXT NOT NULL,
            credito TEXT,
            monto REAL,
            valor_doc REAL,
            comp_pvt TEXT,
            comp_nro TEXT,
            comp_letra TEXT,
            UNIQUE(tipo, punto_venta, numero_desde)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jurisdiccion_mapa (
            valor_api TEXT PRIMARY KEY,
            tipo TEXT NOT NULL,
            concepto TEXT NOT NULL
        )
    """)
    # SNAP -> Sales by Line of Business: clasifica combinaciones de
    # d_centro_costo/d_categoria/d_canal_venta de ig_ventas (universo VINOS
    # ** con categoria IN ('DTC','HOSPITALIDAD') -- el resto, DBA/DCBA/DNOA/
    # EXPORTS, ya tiene línea fija, ver snap.py) a una línea de "Direct-to-
    # consumer Channel". Campo NULL = no filtra por ese campo; si varias
    # reglas matchean, gana la MÁS ESPECÍFICA (más campos no-nulos). Catálogo
    # fijo editable a mano (NO auto-sincronizado), mismo criterio que
    # jurisdiccion_mapa -- pedido explícito de Ezequiel 2026-10-09: "todas
    # estas asignaciones tienen que estar especificadas en datos maestros".
    conn.execute("""
        CREATE TABLE IF NOT EXISTS snap_linea_negocio_mapa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            centro_costo TEXT,
            categoria TEXT,
            canal_venta TEXT,
            linea_negocio TEXT NOT NULL
        )
    """)
    conn.commit()

    # Semilla fija (2026-10-07, pedido explícito de Ezequiel: "tiene que ser
    # una base de datos fija y editable por el usuario", NO auto-sincronizada
    # desde ig_ventas) -- las 24 provincias argentinas + CABA, cargadas UNA
    # sola vez si la tabla está vacía. El admin agrega a mano los valores de
    # "Exterior" (países) que vea en Ventas por Jurisdicción.
    (cantidad,) = conn.execute("SELECT COUNT(*) FROM jurisdiccion_mapa").fetchone()
    if cantidad == 0:
        provincias = [
            "CABA", "BUENOS AIRES", "CATAMARCA", "CHACO", "CHUBUT", "CORDOBA",
            "CORRIENTES", "ENTRE RIOS", "FORMOSA", "JUJUY", "LA PAMPA",
            "LA RIOJA", "MENDOZA", "MISIONES", "NEUQUEN", "RIO NEGRO",
            "SALTA", "SAN JUAN", "SAN LUIS", "SANTA CRUZ", "SANTA FE",
            "SANTIAGO DEL ESTERO", "TIERRA DEL FUEGO", "TUCUMAN",
        ]
        conn.executemany(
            "INSERT INTO jurisdiccion_mapa (valor_api, tipo, concepto) VALUES (?, 'Provincia', ?)",
            [(p, p) for p in provincias],
        )
        conn.commit()

    # Semilla de snap_linea_negocio_mapa -- solo lo YA CONFIRMADO por
    # Ezequiel el 2026-10-09 (texto literal de esa sesión). Combinaciones de
    # DTC/HOSPITALIDAD que no matcheen ninguna regla caen en "Otro DTC/
    # Hospitalidad" (ver snap.py) -- el admin agrega reglas nuevas a mano
    # desde Datos Maestros a medida que aparecen centros de costo nuevos.
    (cantidad,) = conn.execute("SELECT COUNT(*) FROM snap_linea_negocio_mapa").fetchone()
    if cantidad == 0:
        reglas = [
            (None, None, "ECOMMERCE", "E-commerce"),
            (None, None, "VENTA AL PERSONAL", "Employees"),
            ("HOTEL COLOME", None, None, "Colome Hotel"),
            ("COLOME WINE BAR", "HOSPITALIDAD", None, "Colome Visitor Center"),
            ("AMALAYA WINE BAR", "HOSPITALIDAD", None, "Cafayate Visitor Center"),
        ]
        conn.executemany(
            "INSERT INTO snap_linea_negocio_mapa (centro_costo, categoria, canal_venta, linea_negocio) VALUES (?, ?, ?, ?)",
            reglas,
        )
        conn.commit()
    conn.close()
