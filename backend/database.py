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
    conn.close()
