"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

// Otros Análisis -> Por Cliente / Por SKU / Por Vendedor (2026-10-19, pedido
// explícito de Ezequiel): réplica de las 3 hojas homónimas de
// "Operaciones_de_Ventas.xlsx" (cuadro mensual que se reporta a Colomé), en
// vivo contra ig_ventas (ver otros_analisis.py), con selector de un solo mes
// como Ctrl AFIP -> Ventas por Jurisdicción. Filtran VINOS ** (universo real
// de "Ventas" de ese Excel) a diferencia del Desglose por Grupo que seguía
// acá antes (ese endpoint queda sin tocar, no se usa en esta pantalla).
//
// "% Desc C" de la hoja Por Cliente se OMITE a pedido explícito de Ezequiel
// (2026-10-19): no hay un campo 1 a 1 en ig_ventas y no vale la pena
// estimarlo sin validar la fórmula con Ariel.
//
// "% MG" se sacó de las 3 vistas (2026-10-19, pedido explícito de Ezequiel:
// "saca esto por ahora") -- el backend (ig_ventas.py) sigue calculando
// `mg_pct` en los 3 endpoints, solo se deja de mostrar acá. Si se vuelve a
// pedir, alcanza con tocar esta pantalla, no hay que tocar el backend.
//
// Filtros en el SIDEBAR, no arriba de cada tarjeta (2026-10-19, pedido
// explícito de Ezequiel tras ver las píldoras de Vendedor en el lugar
// equivocado -- ver norma de trabajo "Toda pantalla con layout de sidebar
// pone sus filtros ahí", sección Diseño y mobile de 00-Normas-de-Trabajo.md).
// Cada sub-vista reporta su
// propio contenido de sidebar al padre vía `onFiltros` (useEffect), porque
// el selector de período/buscador/chips vive en el estado de cada
// componente, no en OtrosAnalisisPage.
//
// Orden alfabético en las 3 vistas (rubro, artículo, vendedor, cliente) --
// antes algunas ordenaban por valor descendente y otras no, lo que daba una
// sensación de inconsistencia entre pestañas (pedido explícito de Ezequiel
// 2026-10-19: "no veo consistencia en el orden de la información").
//
// Rubro/Vendedor como columna propia con rowSpan, no solo en la fila de
// Total -- antes el header decía "Rubro / Artículo" pero la fila de cada
// artículo no mostraba el rubro (solo aparecía en "Total <rubro>"), lo que
// se veía como si esa columna estuviera vacía (reportado por Ezequiel:
// "rubro/articulo esta sin datos").
//
// Por Cliente REDISEÑADO 2026-11-02 (pedido de Ariel Culasso vía Ezequiel,
// "sí, tal cual lo pide"): deja de agrupar fijo por Vendedor -- pasa a ser
// un RANKING de clientes (ordenado por Venta Neta desc), con Vendedor/Canal
// como "segmentador" (filtro de chips, elegible cuál de los dos usar, no
// una columna de la tabla). Período pasa de un selector de un solo mes a
// un rango de fechas libre. Se agrega "Descuento Comercial" (antes "% Desc
// C" se omitía -- ver docstring de `ventas_por_cliente` en ig_ventas.py
// para el campo real encontrado, `m_desc_total`).
//
// Por SKU y Por Vendedor, mismo día, 2 pedidos más de Ariel (ver
// comentarios en cada componente más abajo): también pasan a rango de
// fechas libre + Descuento Comercial. Por SKU gana un ranking de productos
// con Marca/Mercado como segmentadores + Precio Promedio. Por Vendedor
// suma un drill-down de tendencia por período cuando se tilda 1 solo
// vendedor.
//
// Semántica de `ChipsFiltro` invertida el mismo día (pedido explícito de
// Ezequiel, después de ver el filtro de Vendedor de Por Cliente: "deberia
// venir todo destildado (para mostrar todo). si se filtra 1, 2 o 3,
// muestre solo de esos vendedores. asi en las 3 pestañas") -- ver el
// comentario completo en `ChipsFiltro` más abajo. Institucionalizado en
// `00-Normas-de-Trabajo.md`.

interface FilaCliente { vendedor: string; canal: string; cliente: string; cajas: number; cantidad: number; ars: number; descuento: number; mg_pct: number }
interface FilaSku { rubro: string; c_articulo: string; d_articulo: string; oficina: string; cajas: number; cantidad: number; ars: number; descuento: number; mg_pct: number }
interface FilaVendedor { rubro: string; c_articulo: string; d_articulo: string; vendedor: string; periodo: string; cantidad: number; ars: number; descuento: number; mg_pct: number }

const fmtNum = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// % Descuento Comercial (2026-11-03, pedido explícito de Ezequiel: "en
// todas las tablas que pusimos descuento comercial, debemos agregar una
// columna con el % de descuento") -- `ars` (venta neta, `valor_mon_loc`)
// ya viene DESPUÉS de aplicar el descuento, así que venta bruta = ars +
// descuento, y %Desc = descuento / (ars + descuento). Puramente derivado
// en el frontend a partir de 2 campos que el backend ya manda, no hace
// falta tocar ig_ventas.py/otros_analisis.py.
const fmtPct = (descuento: number, ars: number) => {
  const bruto = ars + descuento;
  if (!bruto) return "—";
  return (descuento / bruto * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
};

function mesCerradoAnteriorRango(): { desde: string; hasta: string } {
  const hoy = new Date();
  const anio = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
  const mes = hoy.getMonth() === 0 ? 11 : hoy.getMonth() - 1; // 0-indexed
  const desde = new Date(anio, mes, 1);
  const hasta = new Date(anio, mes + 1, 0);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: fmt(desde), hasta: fmt(hasta) };
}

// Rango de fechas libre (pedido de Ariel Culasso 2026-11-02 en las 3
// vistas): reemplaza el selector de un solo mes que tenían antes.
function RangoFechas({ desde, hasta, onChange }: { desde: string; hasta: string; onChange: (desde: string, hasta: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Período (rango de fechas)</label>
      <div className="flex flex-col gap-1.5">
        <input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => onChange(e.target.value, hasta)}
          className="w-full px-2.5 py-1.5 rounded-md border border-white/15 text-sm bg-white/5 text-white [color-scheme:dark]"
        />
        <input
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => onChange(desde, e.target.value)}
          className="w-full px-2.5 py-1.5 rounded-md border border-white/15 text-sm bg-white/5 text-white [color-scheme:dark]"
        />
      </div>
    </div>
  );
}

// Buscador de texto libre por substring (norma de trabajo 4.sexdecies:
// dimensiones con muchos valores -- cliente, vendedor, artículo -- se
// filtran con un input libre, nunca con un <select> de selección única).
function BuscadorTexto({ valor, onChange, placeholder, label }: { valor: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">{label}</label>
      <input
        type="text"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded-md border border-white/15 text-sm bg-white/5 text-white placeholder-white/30"
      />
    </div>
  );
}

// Chips de selección múltiple (ej. qué vendedores mostrar como columna) --
// MISMO patrón que Panel de Ventas (public/ventas/app.js + ventas.css,
// clase `.chip`): un checkbox REAL dentro de un <label> con pinta de chip,
// nunca un <button> que solo cambia de color (norma de trabajo "Filtro
// on/off: checkbox real, nunca un botón toggle" -- pedido explícito de
// Ezequiel 2026-10-19: "sacalo como pildora y ponelo con checkbox como
// esta en panel de ventas"). Mismo dorado (#DCBE84/#b8975a) que usa esa
// pantalla para el estado marcado.
//
// Semántica invertida 2026-11-02 (pedido explícito de Ezequiel: "deberia
// venir todo destildado (para mostrar todo). si se filtra 1, 2 o 3,
// muestre solo de esos... asi en las 3 pestañas"): antes tildado=visible
// (default: TODO tildado, destildar para ocultar) -- criterio al revés
// de lo esperable, además con el agravante de que Ariel había pedido
// "solo" para destildar todos los demás con 1 click (ver commit
// anterior). Ahora `seleccionados` (vacío = sin filtro, se muestra TODO;
// 1+ valores tildados = se muestra SOLO esos). "Solo" queda redundante
// con este criterio (tildar nada más que ese valor ya hace lo mismo en 1
// click) -- se saca, reemplazado por "Limpiar" (solo visible cuando hay
// algo tildado, vuelve a "sin filtro").
function ChipsFiltro({ label, opciones, seleccionados, onToggle, onLimpiar }: {
  label: string; opciones: string[]; seleccionados: Set<string>; onToggle: (v: string) => void; onLimpiar: () => void;
}) {
  if (opciones.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] uppercase tracking-wide text-white/40">{label}</label>
        {seleccionados.size > 0 && (
          <button onClick={onLimpiar} className="text-[10px] text-[#DCBE84] hover:text-white underline">Limpiar</button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {opciones.map((v) => {
          const activo = seleccionados.has(v);
          return (
            <label
              key={v}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-[12px] cursor-pointer transition ${
                activo
                  ? "bg-gradient-to-br from-[#e7cd9c] to-[#DCBE84] text-[#1c1811] font-semibold"
                  : "bg-white/5 text-white/75 hover:bg-white/10"
              }`}
            >
              <input
                type="checkbox"
                checked={activo}
                onChange={() => onToggle(v)}
                className="accent-[#b8975a] shrink-0"
              />
              <span className="truncate">{v}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

const normalizar = (s: string) => s.toLowerCase();
const porNombre = (a: string, b: string) => a.localeCompare(b, "es");

// Encabezados de tabla ordenables por click (pedido explícito de Ezequiel
// 2026-11-02: "que le falta a las 3 pestañas? que se pueda ordenar al
// hacer clic en el encabezado") -- 1er click en una columna nueva ordena
// desc (lo más vendido/caro primero, el caso de uso más común en estas
// tablas); 2do click en la MISMA columna invierte a asc; click en OTRA
// columna vuelve a arrancar en desc. Mismo componente `SortTh` en las 3
// pestañas.
type SortDir = "asc" | "desc";
type SortState<K extends string> = { col: K; dir: SortDir };

function SortTh<K extends string>({ label, col, sort, onSort, align = "right", className = "", rowSpan }: {
  label: string; col: K; sort: SortState<K>; onSort: (col: K) => void; align?: "left" | "right"; className?: string; rowSpan?: number;
}) {
  const activo = sort.col === col;
  return (
    <th
      rowSpan={rowSpan}
      onClick={() => onSort(col)}
      className={`py-2 px-3 text-[11px] uppercase tracking-wider font-semibold cursor-pointer select-none hover:text-[#1c1811] ${
        align === "right" ? "text-right" : "text-left"
      } ${activo ? "text-[#1c1811]" : "text-[#5a5342]"} ${className}`}
    >
      {label}
      <span className={`inline-block ml-1 text-[9px] ${activo ? "opacity-100" : "opacity-0"}`}>
        {activo && sort.dir === "desc" ? "▼" : "▲"}
      </span>
    </th>
  );
}

function ordenar<T, K extends string>(filas: T[], sort: SortState<K>, valor: (f: T, col: K) => string | number): T[] {
  const mult = sort.dir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    const va = valor(a, sort.col), vb = valor(b, sort.col);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "es") * mult;
    return (va - vb) * mult;
  });
}

function useOtrosAnalisisRango<T>(endpoint: string, desde: string, hasta: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/otros-analisis/${endpoint}?desde=${desde}&hasta=${hasta}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error(`Error cargando ${endpoint}`);
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [endpoint, desde, hasta]);

  useEffect(load, [load]);
  return { rows, loading, error };
}

interface FilaMarcaProducto {
  marca: string; c_articulo: string; d_articulo: string;
  cajas: number; cantidad: number; ars: number; descuento: number; mg_pct: number;
}

// Drill-down de Por Cliente (2026-11-03, pedido explícito de Ezequiel: "el
// drill-down, no tiene que ser por factura, tiene que ser por marca -
// producto") -- agrupa por Marca/Producto en vez de listar facturas
// reales, mismo patrón visual que la tabla de Por SKU (Precio Promedio
// incluido). Mismo día, Por SKU y Por Vendedor también dejaron el drill-
// down por factura (ver `DesgloseClienteModal` más abajo) -- la
// composición por factura (`ComposicionModal`/`/detalle-facturas`) quedó
// sin ningún consumidor y se sacó del todo, no quedó código muerto.
function DesgloseMarcaProductoModal({ cliente, desde, hasta, onClose }: {
  cliente: string; desde: string; hasta: string; onClose: () => void;
}) {
  const [rows, setRows] = useState<FilaMarcaProducto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ desde, hasta, cliente });
    fetch(`/api/otros-analisis/por-cliente/marca-producto?${qs}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el desglose");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, cliente]);

  const total = rows.reduce((a, f) => ({ cajas: a.cajas + f.cajas, ars: a.ars + f.ars, descuento: a.descuento + f.descuento }), { cajas: 0, ars: 0, descuento: 0 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-[18px] shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 pb-4 border-b border-[#ece6d8]">
          <div>
            <h3 className="text-sm font-semibold text-[#1c1811]">Desglose por Marca/Producto — {cliente}</h3>
            <p className="text-[11px] text-[#847c68] mt-0.5">{desde} a {hasta}, ventas VINOS.</p>
          </div>
          <button onClick={onClose} className="text-[#847c68] hover:text-[#1c1811] text-xl leading-none">×</button>
        </div>
        <div className="overflow-auto p-6 pt-4">
          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
          {loading ? (
            <div className="h-48 rounded-md bg-[#f7f5f0] animate-pulse" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f7f5f0]">
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Marca</th>
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Producto</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Cajas9l</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Venta Neta</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Desc. Comercial</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">% Desc.</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Precio Prom. (Caja9l)</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-[#847c68]">Sin ventas para este cliente en el rango</td></tr>
                ) : (
                  <>
                    {rows.map((f) => (
                      <tr key={`${f.marca}::${f.c_articulo}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                        <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{f.marca}</td>
                        <td className="py-1.5 px-3 text-[#1c1811]">{f.d_articulo}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cajas)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.ars)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.descuento)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(f.descuento, f.ars)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{f.cajas ? fmtNum(f.ars / f.cajas) : "—"}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                      <td className="py-1.5 px-3" colSpan={2}>Total ({rows.length} productos)</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.cajas)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.ars)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.descuento)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(total.descuento, total.ars)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{total.cajas ? fmtNum(total.ars / total.cajas) : "—"}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

interface FilaDesgloseCliente {
  cliente: string; cajas: number; cantidad: number; ars: number; descuento: number; mg_pct: number;
}

// Drill-down de Por SKU (2026-11-03, pedido explícito de Ezequiel: "por
// sku, tenemos que aplicar el mismo criterio. el drill down es por
// cliente, no por factura") -- mismo cambio que Por Cliente el mismo día
// (ver `DesgloseMarcaProductoModal`), acá al revés: fija el producto,
// desglosa por cliente. Reusado por Por Vendedor (mismo día, "por
// ultimo, por vendedor, no hagas la apertura por factura" -- mismo
// desglose, con `vendedor` opcional para acotar a la celda
// vendedor×artículo clickeada).
function DesgloseClienteModal({ titulo, c_articulo, vendedor, desde, hasta, onClose }: {
  titulo: string; c_articulo: string; vendedor?: string; desde: string; hasta: string; onClose: () => void;
}) {
  const [rows, setRows] = useState<FilaDesgloseCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ desde, hasta, c_articulo, ...(vendedor ? { vendedor } : {}) });
    fetch(`/api/otros-analisis/por-sku/cliente?${qs}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el desglose");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, c_articulo, vendedor]);

  const total = rows.reduce((a, f) => ({ cajas: a.cajas + f.cajas, ars: a.ars + f.ars, descuento: a.descuento + f.descuento }), { cajas: 0, ars: 0, descuento: 0 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-[18px] shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 pb-4 border-b border-[#ece6d8]">
          <div>
            <h3 className="text-sm font-semibold text-[#1c1811]">Desglose por Cliente — {titulo}</h3>
            <p className="text-[11px] text-[#847c68] mt-0.5">{desde} a {hasta}, ventas VINOS.</p>
          </div>
          <button onClick={onClose} className="text-[#847c68] hover:text-[#1c1811] text-xl leading-none">×</button>
        </div>
        <div className="overflow-auto p-6 pt-4">
          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
          {loading ? (
            <div className="h-48 rounded-md bg-[#f7f5f0] animate-pulse" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f7f5f0]">
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Cliente</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Cajas9l</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Venta Neta</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Desc. Comercial</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">% Desc.</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-[#847c68]">Sin ventas de este artículo en el rango</td></tr>
                ) : (
                  <>
                    {rows.map((f) => (
                      <tr key={f.cliente} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                        <td className="py-1.5 px-3 text-[#1c1811]">{f.cliente}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cajas)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.ars)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.descuento)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(f.descuento, f.ars)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                      <td className="py-1.5 px-3">Total ({rows.length} clientes)</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.cajas)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.ars)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.descuento)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(total.descuento, total.ars)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

type Segmentador = "vendedor" | "canal";
type ColCliente = "cliente" | "cajas" | "cantidad" | "ars" | "descuento";

function PorCliente({ onFiltros }: { onFiltros: (n: React.ReactNode) => void }) {
  const [{ desde: desdeDefault, hasta: hastaDefault }] = useState(mesCerradoAnteriorRango());
  const [desde, setDesde] = useState(desdeDefault);
  const [hasta, setHasta] = useState(hastaDefault);
  const [busqueda, setBusqueda] = useState("");
  const [segmentador, setSegmentador] = useState<Segmentador>("vendedor");
  const [segmentoSeleccion, setSegmentoSeleccion] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState<ColCliente>>({ col: "ars", dir: "desc" });
  const onSort = (col: ColCliente) => setSort((prev) => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });
  const { rows, loading, error } = useOtrosAnalisisRango<FilaCliente>("por-cliente", desde, hasta);

  // Cambiar de segmentador (Vendedor<->Canal) resetea la selección -- los
  // valores de una dimensión no tienen sentido como filtro de la otra.
  const cambiarSegmentador = (s: Segmentador) => {
    setSegmentador(s);
    setSegmentoSeleccion(new Set());
  };

  const opcionesSegmento = [...new Set(rows.map((r) => r[segmentador]))].sort(porNombre);
  const toggleSegmento = (v: string) => setSegmentoSeleccion((prev) => {
    const next = new Set(prev);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  });

  useEffect(() => {
    onFiltros(
      <div className="space-y-4">
        <RangoFechas desde={desde} hasta={hasta} onChange={(d, h) => { setDesde(d); setHasta(h); }} />
        <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Cliente…" label="Buscar" />
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Segmentador</label>
          <div className="flex gap-1.5">
            {(["vendedor", "canal"] as const).map((s) => (
              <button
                key={s}
                onClick={() => cambiarSegmentador(s)}
                className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium capitalize transition ${
                  segmentador === s ? "bg-[#DCBE84] text-[#1c1811]" : "bg-white/5 text-white/75 hover:bg-white/10"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <ChipsFiltro
          label={segmentador === "vendedor" ? "Vendedores" : "Canales"}
          opciones={opcionesSegmento}
          seleccionados={segmentoSeleccion}
          onToggle={toggleSegmento}
          onLimpiar={() => setSegmentoSeleccion(new Set())}
        />
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, busqueda, segmentador, segmentoSeleccion, onFiltros, opcionesSegmento.join("|")]);

  const texto = normalizar(busqueda.trim());
  const filtradas = rows.filter((r) => {
    if (segmentoSeleccion.size > 0 && !segmentoSeleccion.has(r[segmentador])) return false;
    if (texto && !normalizar(r.cliente).includes(texto)) return false;
    return true;
  });

  // Ranking de CLIENTES (pedido de Ariel: "solo pondría la info de
  // clientes") -- se suma a través de Vendedor/Canal, el segmentador es un
  // filtro previo, no una columna de la tabla final.
  const porCliente = new Map<string, { cliente: string; cajas: number; cantidad: number; ars: number; descuento: number }>();
  for (const r of filtradas) {
    const acc = porCliente.get(r.cliente) ?? { cliente: r.cliente, cajas: 0, cantidad: 0, ars: 0, descuento: 0 };
    acc.cajas += r.cajas;
    acc.cantidad += r.cantidad;
    acc.ars += r.ars;
    acc.descuento += r.descuento;
    porCliente.set(r.cliente, acc);
  }
  const ranking = ordenar([...porCliente.values()], sort, (f, col) => f[col]);
  const total = ranking.reduce((a, f) => ({ cajas: a.cajas + f.cajas, cantidad: a.cantidad + f.cantidad, ars: a.ars + f.ars, descuento: a.descuento + f.descuento }), { cajas: 0, cantidad: 0, ars: 0, descuento: 0 });
  const [composicion, setComposicion] = useState<string | null>(null);

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      {composicion && (
        <DesgloseMarcaProductoModal
          cliente={composicion}
          desde={desde} hasta={hasta}
          onClose={() => setComposicion(null)}
        />
      )}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1c1811]">Por Cliente</h3>
        <p className="text-[11px] text-[#847c68] mt-0.5">Ranking de clientes (ventas VINOS), Venta Neta y Descuento Comercial en ARS. Filtrar por {segmentador} en el sidebar. Click en un cliente para ver su desglose por Marca/Producto.</p>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">#</th>
                <SortTh label="Cliente" col="cliente" sort={sort} onSort={onSort} align="left" className="border-l border-[#ece6d8]" />
                <SortTh label="Cajas9l" col="cajas" sort={sort} onSort={onSort} />
                <SortTh label="Cantidad" col="cantidad" sort={sort} onSort={onSort} />
                <SortTh label="Venta Neta" col="ars" sort={sort} onSort={onSort} />
                <SortTh label="Descuento Comercial" col="descuento" sort={sort} onSort={onSort} />
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">% Desc.</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : (
                <>
                  {ranking.map((f, i) => (
                    <tr key={f.cliente} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      <td className="py-1.5 px-3 text-right tabular-nums text-[#847c68]">{i + 1}</td>
                      <td className="py-1.5 px-3 border-l border-[#f3efe4]">
                        <button onClick={() => setComposicion(f.cliente)} className="text-[#1c1811] hover:text-[#7D4E5B] hover:underline text-left">{f.cliente}</button>
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cajas)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cantidad)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.ars)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.descuento)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(f.descuento, f.ars)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                    <td className="py-1.5 px-3" colSpan={2}>Total</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.cajas)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.cantidad)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.ars)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.descuento)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(total.descuento, total.ars)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Por SKU REDISEÑADO 2026-11-02 (pedido de Ariel Culasso vía Ezequiel,
// "sí, tal cual lo pide"): Rubro ("Marca") y Oficina ("Mercado") dejan de
// ser columna fija/pivot -- pasan a ser DOS segmentadores independientes
// (chips de filtro simultáneos, no un toggle como Vendedor/Canal en Por
// Cliente -- acá ambas dimensiones tienen sentido filtradas a la vez). La
// tabla pasa a ranking de PRODUCTOS (agregado por artículo, sumando a
// través de lo que quede después de filtrar Marca/Mercado), con Descuento
// Comercial y Precio Promedio (Venta Neta ARS / Cajas9l) agregados.
//
// Orden de los filtros en el sidebar (mismo día, pedido explícito de
// Ezequiel): Mercado ANTES que Marca -- "siempre de menos a mas (el
// mercado es lo que contiene la venta de la marca)". Institucionalizado
// en 00-Normas-de-Trabajo.md: el filtro de la dimensión más amplia/
// contenedora va primero (arriba), el de la dimensión más específica/
// contenida va después.
type ColSku = "d_articulo" | "cajas" | "ars" | "descuento" | "precioProm";

function PorSku({ onFiltros }: { onFiltros: (n: React.ReactNode) => void }) {
  const [{ desde: desdeDefault, hasta: hastaDefault }] = useState(mesCerradoAnteriorRango());
  const [desde, setDesde] = useState(desdeDefault);
  const [hasta, setHasta] = useState(hastaDefault);
  const [busqueda, setBusqueda] = useState("");
  const [marcasSeleccion, setMarcasSeleccion] = useState<Set<string>>(new Set());
  const [mercadosSeleccion, setMercadosSeleccion] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState<ColSku>>({ col: "ars", dir: "desc" });
  const onSort = (col: ColSku) => setSort((prev) => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });
  const { rows, loading, error } = useOtrosAnalisisRango<FilaSku>("por-sku", desde, hasta);

  const marcas = [...new Set(rows.map((r) => r.rubro))].sort(porNombre);
  const mercados = [...new Set(rows.map((r) => r.oficina))].sort(porNombre);
  const toggleSet = (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };

  useEffect(() => {
    onFiltros(
      <div className="space-y-4">
        <RangoFechas desde={desde} hasta={hasta} onChange={(d, h) => { setDesde(d); setHasta(h); }} />
        <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Artículo…" label="Buscar" />
        <ChipsFiltro
          label="Mercado"
          opciones={mercados}
          seleccionados={mercadosSeleccion}
          onToggle={toggleSet(mercadosSeleccion, setMercadosSeleccion)}
          onLimpiar={() => setMercadosSeleccion(new Set())}
        />
        <ChipsFiltro
          label="Marca"
          opciones={marcas}
          seleccionados={marcasSeleccion}
          onToggle={toggleSet(marcasSeleccion, setMarcasSeleccion)}
          onLimpiar={() => setMarcasSeleccion(new Set())}
        />
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, busqueda, marcasSeleccion, mercadosSeleccion, onFiltros, marcas.join("|"), mercados.join("|")]);

  const texto = normalizar(busqueda.trim());
  const filtradas = rows.filter((r) => {
    if (marcasSeleccion.size > 0 && !marcasSeleccion.has(r.rubro)) return false;
    if (mercadosSeleccion.size > 0 && !mercadosSeleccion.has(r.oficina)) return false;
    if (texto && !normalizar(r.d_articulo).includes(texto)) return false;
    return true;
  });

  const porProducto = new Map<string, { c_articulo: string; d_articulo: string; cajas: number; cantidad: number; ars: number; descuento: number }>();
  for (const r of filtradas) {
    const key = `${r.c_articulo}::${r.d_articulo}`;
    const acc = porProducto.get(key) ?? { c_articulo: r.c_articulo, d_articulo: r.d_articulo, cajas: 0, cantidad: 0, ars: 0, descuento: 0 };
    acc.cajas += r.cajas;
    acc.cantidad += r.cantidad;
    acc.ars += r.ars;
    acc.descuento += r.descuento;
    porProducto.set(key, acc);
  }
  const conPrecioProm = [...porProducto.values()].map((f) => ({ ...f, precioProm: f.cajas ? f.ars / f.cajas : 0 }));
  const ranking = ordenar(conPrecioProm, sort, (f, col) => f[col]);
  const total = ranking.reduce((a, f) => ({ cajas: a.cajas + f.cajas, ars: a.ars + f.ars, descuento: a.descuento + f.descuento }), { cajas: 0, ars: 0, descuento: 0 });
  const [composicion, setComposicion] = useState<{ c_articulo: string; d_articulo: string } | null>(null);

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      {composicion && (
        <DesgloseClienteModal
          titulo={composicion.d_articulo}
          c_articulo={composicion.c_articulo}
          desde={desde} hasta={hasta}
          onClose={() => setComposicion(null)}
        />
      )}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1c1811]">Por SKU</h3>
        <p className="text-[11px] text-[#847c68] mt-0.5">Ranking de productos (ventas VINOS), Venta Neta y Descuento Comercial en ARS. Filtrar por Marca/Mercado en el sidebar. Click en un artículo para ver su desglose por Cliente.</p>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">#</th>
                <SortTh label="Artículo" col="d_articulo" sort={sort} onSort={onSort} align="left" className="border-l border-[#ece6d8]" />
                <SortTh label="Cajas9l" col="cajas" sort={sort} onSort={onSort} />
                <SortTh label="Venta Neta" col="ars" sort={sort} onSort={onSort} />
                <SortTh label="Descuento Comercial" col="descuento" sort={sort} onSort={onSort} />
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">% Desc.</th>
                <SortTh label="Precio Promedio (por Caja9l)" col="precioProm" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : (
                <>
                  {ranking.map((f, i) => (
                    <tr key={`${f.c_articulo}::${f.d_articulo}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      <td className="py-1.5 px-3 text-right tabular-nums text-[#847c68]">{i + 1}</td>
                      <td className="py-1.5 px-3 border-l border-[#f3efe4]">
                        <button onClick={() => setComposicion({ c_articulo: f.c_articulo, d_articulo: f.d_articulo })} className="text-[#1c1811] hover:text-[#7D4E5B] hover:underline text-left">{f.d_articulo}</button>
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cajas)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.ars)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.descuento)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(f.descuento, f.ars)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{f.cajas ? fmtNum(f.ars / f.cajas) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                    <td className="py-1.5 px-3" colSpan={2}>Total</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.cajas)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.ars)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.descuento)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtPct(total.descuento, total.ars)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{total.cajas ? fmtNum(total.ars / total.cajas) : "—"}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Por Vendedor REDISEÑADO 2026-11-02 (pedido de Ariel Culasso vía Ezequiel,
// "sí, tal cual lo pide"):
// 1. Bug de UX real corregido: el criterio de los chips (tildado=visible)
//    obligaba a destildar TODOS los demás vendedores uno a uno para ver
//    uno solo ("me fue dificultoso seleccionar un vendedor particular...
//    debemos cambiar el criterio"). Con la semántica invertida de
//    `ChipsFiltro` (ver su comentario -- pedido explícito de Ezequiel el
//    mismo día, DESPUÉS de este fix: "deberia venir todo destildado...
//    si se filtra 1, 2 o 3, muestre solo de esos") tildar un solo
//    vendedor ya hace exactamente eso en 1 click, sin tocar el resto.
// 2. Rango de fechas libre, vista acumulada (la tabla principal sigue
//    sumando TODO el rango, como antes).
// 3. Drill-down de tendencia por período -- intentado y luego sacado DEL
//    TODO el mismo día (Ezequiel, después de ver 2 variantes: una donde
//    solo aparecía aislando 1 vendedor, otra siempre visible con "Total":
//    "no, sacalo del todo"). No queda ningún panel de tendencia en esta
//    vista -- si se vuelve a pedir, el campo `periodo` ya viaja en cada
//    fila (agregado en ig_ventas.py) para no tener que pedir un endpoint
//    aparte.
// 4. Descuento Comercial agregado como 3ra sub-columna por vendedor
//    (Cantidad / Desc. Comercial / Venta Neta) -- Ariel pidió explícito
//    "cantidad, desc comercial, neto". Margen queda para una iteración
//    futura (Ariel: "dps le agregaremos el margen").
// Columnas ordenables de Por Vendedor: "rubro" reordena los GRUPOS
// (Rubro), "d_articulo"/"totalArs" reordenan las filas DENTRO de cada
// grupo (las columnas por-vendedor no son ordenables, ambiguo en una
// tabla pivot con varios vendedores a la vez).
// Columnas por-vendedor (Cant./Venta Neta/Desc. Com.) codificadas como
// "v:<vendedor>:<métrica>" -- pedido explícito de Ezequiel 2026-11-02
// ("cantidad, venta neta y desc. no se pueden ordenar?"), agregado sobre
// el diseño original que solo dejaba ordenar Rubro/Artículo/Total (esas
// sub-columnas parecían ambiguas con varios vendedores tildados a la vez,
// pero no lo son: cada una ordena SU PROPIO vendedor, sin afectar al
// resto -- fila sin esa métrica para ese vendedor cuenta como 0).
type MetricaVendedor = "cantidad" | "ars" | "descuento";
type ColVendedor = "rubro" | "d_articulo" | "totalArs" | `v:${string}:${MetricaVendedor}`;
const colVendedor = (vendedor: string, metrica: MetricaVendedor): ColVendedor => `v:${vendedor}:${metrica}`;

function PorVendedor({ onFiltros }: { onFiltros: (n: React.ReactNode) => void }) {
  const [{ desde: desdeDefault, hasta: hastaDefault }] = useState(mesCerradoAnteriorRango());
  const [desde, setDesde] = useState(desdeDefault);
  const [hasta, setHasta] = useState(hastaDefault);
  const [busqueda, setBusqueda] = useState("");
  const [vendedoresSeleccion, setVendedoresSeleccion] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState<ColVendedor>>({ col: "rubro", dir: "asc" });
  const onSort = (col: ColVendedor) => setSort((prev) => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: col === "rubro" || col === "d_articulo" ? "asc" : "desc" });
  const { rows, loading, error } = useOtrosAnalisisRango<FilaVendedor>("por-vendedor", desde, hasta);

  // Chips de vendedor para elegir qué columnas mostrar -- la tabla pivotea
  // un vendedor por columna y con ~10 vendedores queda ilegible de ancha
  // (pedido explícito de Ezequiel 2026-10-19: "esta algo bruto diagramado").
  const todosVendedores = [...new Set(rows.map((r) => r.vendedor))].sort(porNombre);

  const toggleVendedor = (v: string) => setVendedoresSeleccion((prev) => {
    const next = new Set(prev);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  });

  useEffect(() => {
    onFiltros(
      <div className="space-y-4">
        <RangoFechas desde={desde} hasta={hasta} onChange={(d, h) => { setDesde(d); setHasta(h); }} />
        <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Rubro o artículo…" label="Buscar" />
        <ChipsFiltro
          label="Vendedores"
          opciones={todosVendedores}
          seleccionados={vendedoresSeleccion}
          onToggle={toggleVendedor}
          onLimpiar={() => setVendedoresSeleccion(new Set())}
        />
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, busqueda, vendedoresSeleccion, onFiltros, todosVendedores.join("|")]);

  const texto = normalizar(busqueda.trim());
  const filtradas = rows.filter((r) => {
    if (vendedoresSeleccion.size > 0 && !vendedoresSeleccion.has(r.vendedor)) return false;
    if (!texto) return true;
    return normalizar(r.rubro).includes(texto) || normalizar(r.d_articulo).includes(texto);
  });

  const vendedores = [...new Set(filtradas.map((r) => r.vendedor))].sort(porNombre);

  const rubros = new Map<string, Map<string, { d_articulo: string; porVendedor: Map<string, { cantidad: number; ars: number; descuento: number }> }>>();
  for (const r of filtradas) {
    if (!rubros.has(r.rubro)) rubros.set(r.rubro, new Map());
    const arts = rubros.get(r.rubro)!;
    const key = `${r.c_articulo}::${r.d_articulo}`;
    if (!arts.has(key)) arts.set(key, { d_articulo: r.d_articulo, porVendedor: new Map() });
    const prev = arts.get(key)!.porVendedor.get(r.vendedor) ?? { cantidad: 0, ars: 0, descuento: 0 };
    arts.get(key)!.porVendedor.set(r.vendedor, {
      cantidad: prev.cantidad + r.cantidad, ars: prev.ars + r.ars, descuento: prev.descuento + r.descuento,
    });
  }

  // Rubro ordena los grupos; cualquier otra columna (Artículo, Total, o
  // una sub-columna por-vendedor) ordena las filas DENTRO de cada grupo
  // (el orden de los grupos entre sí queda alfabético por Rubro en ese
  // caso, para no desarmar el agrupado).
  const colFila: ColVendedor = sort.col === "rubro" ? "d_articulo" : sort.col;
  const dirFila = sort.col === "rubro" ? "asc" : sort.dir;
  const grupos = ordenar(
    [...rubros.entries()].map(([rubro, arts]) => {
      const filas = ordenar(
        [...arts.entries()].map(([key, v]) => {
          const [c_articulo] = key.split("::");
          const totalArs = [...v.porVendedor.values()].reduce((a, o) => a + o.ars, 0);
          return { c_articulo, d_articulo: v.d_articulo, porVendedor: v.porVendedor, totalArs };
        }),
        { col: colFila, dir: dirFila },
        (f, col) => {
          if (col === "d_articulo") return f.d_articulo;
          if (col === "totalArs") return f.totalArs;
          const [, vendedor, metrica] = col.split(":") as [string, string, MetricaVendedor];
          return f.porVendedor.get(vendedor)?.[metrica] ?? 0;
        },
      );
      const totalRubroArs = filas.reduce((a, f) => a + f.totalArs, 0);
      // Subtotal por vendedor de la fila "Total {rubro}" (bug real
      // reportado por Ezequiel 2026-11-02: "los subtotales no veo que
      // sumen" -- la fila de total dejaba las celdas de Cant./Desc. Com.
      // por vendedor vacías, solo mostraba el total general de la
      // derecha).
      const totalPorVendedor = new Map<string, { cantidad: number; ars: number; descuento: number }>();
      for (const f of filas) {
        for (const [v, val] of f.porVendedor) {
          const acc = totalPorVendedor.get(v) ?? { cantidad: 0, ars: 0, descuento: 0 };
          acc.cantidad += val.cantidad; acc.ars += val.ars; acc.descuento += val.descuento;
          totalPorVendedor.set(v, acc);
        }
      }
      return { rubro, filas, totalRubroArs, totalPorVendedor };
    }),
    { col: "rubro", dir: sort.col === "rubro" ? sort.dir : "asc" },
    (g) => g.rubro,
  );

  const [composicion, setComposicion] = useState<{ c_articulo: string; d_articulo: string; vendedor: string } | null>(null);

  return (
    <div className="space-y-5">
      {composicion && (
        <DesgloseClienteModal
          titulo={`${composicion.d_articulo} — ${composicion.vendedor}`}
          c_articulo={composicion.c_articulo}
          vendedor={composicion.vendedor}
          desde={desde} hasta={hasta}
          onClose={() => setComposicion(null)}
        />
      )}

      <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1c1811]">Por Vendedor</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">Cantidad, Descuento Comercial y Venta Neta (ARS) por artículo, separado por vendedor. Vista acumulada del rango. Click en una Venta Neta para ver su desglose por Cliente.</p>
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {loading ? (
          <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f7f5f0]">
                  <SortTh label="Rubro" col="rubro" sort={sort} onSort={onSort} align="left" rowSpan={2} className="align-bottom whitespace-nowrap" />
                  <SortTh label="Artículo" col="d_articulo" sort={sort} onSort={onSort} align="left" rowSpan={2} className="align-bottom whitespace-nowrap border-l border-[#ece6d8]" />
                  {vendedores.map((v) => (
                    <th key={v} colSpan={4} className="py-1.5 px-3 text-center text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8] whitespace-nowrap">{v}</th>
                  ))}
                  <th colSpan={1} className="py-1.5 px-3 text-center text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">Total</th>
                </tr>
                <tr className="bg-[#f7f5f0]">
                  {vendedores.map((v) => (
                    <Fragment key={v}>
                      <SortTh label="Cant." col={colVendedor(v, "cantidad")} sort={sort} onSort={onSort} className="!text-[10px] !normal-case !tracking-normal !font-normal text-[#847c68] border-l border-[#ece6d8]" />
                      <SortTh label="Venta Neta" col={colVendedor(v, "ars")} sort={sort} onSort={onSort} className="!text-[10px] !normal-case !tracking-normal !font-normal text-[#847c68]" />
                      <SortTh label="Desc. Com." col={colVendedor(v, "descuento")} sort={sort} onSort={onSort} className="!text-[10px] !normal-case !tracking-normal !font-normal text-[#847c68]" />
                      <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68] whitespace-nowrap">% Desc.</th>
                    </Fragment>
                  ))}
                  <SortTh label="Venta Neta" col="totalArs" sort={sort} onSort={onSort} className="!text-[10px] !normal-case !tracking-normal !font-normal text-[#847c68] border-l border-[#ece6d8]" />
                </tr>
              </thead>
              <tbody>
                {grupos.length === 0 ? (
                  <tr><td colSpan={3 + vendedores.length * 4} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
                ) : grupos.map((g) => (
                  <Fragment key={g.rubro}>
                    {g.filas.map((f, i) => (
                      <tr key={`${g.rubro}::${f.c_articulo}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                        {i === 0 && (
                          <td rowSpan={g.filas.length} className="py-1.5 px-3 text-[#1c1811] align-top font-medium whitespace-nowrap">{g.rubro}</td>
                        )}
                        <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap border-l border-[#f3efe4]">{f.d_articulo}</td>
                        {vendedores.map((v) => {
                          const val = f.porVendedor.get(v);
                          return (
                            <Fragment key={v}>
                              <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#f3efe4]">{val ? fmtNum(val.cantidad) : "—"}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums">
                                {val ? (
                                  <button onClick={() => setComposicion({ c_articulo: f.c_articulo, d_articulo: f.d_articulo, vendedor: v })} className="hover:text-[#7D4E5B] hover:underline">{fmtNum(val.ars)}</button>
                                ) : "—"}
                              </td>
                              <td className="py-1.5 px-3 text-right tabular-nums">{val ? fmtNum(val.descuento) : "—"}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums">{val ? fmtPct(val.descuento, val.ars) : "—"}</td>
                            </Fragment>
                          );
                        })}
                        <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#f3efe4] font-medium">{fmtNum(f.totalArs)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap" colSpan={2}>Total {g.rubro}</td>
                      {vendedores.map((v) => {
                        const val = g.totalPorVendedor.get(v);
                        return (
                          <Fragment key={v}>
                            <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#ece6d8]">{val ? fmtNum(val.cantidad) : "—"}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums">{val ? fmtNum(val.ars) : "—"}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums">{val ? fmtNum(val.descuento) : "—"}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums">{val ? fmtPct(val.descuento, val.ars) : "—"}</td>
                          </Fragment>
                        );
                      })}
                      <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#ece6d8]">{fmtNum(g.totalRubroArs)}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const SUB_TABS = [
  { key: "cliente", label: "Por Cliente" },
  { key: "sku", label: "Por SKU" },
  { key: "vendedor", label: "Por Vendedor" },
] as const;

export default function OtrosAnalisisPage() {
  const [sub, setSub] = useState<(typeof SUB_TABS)[number]["key"]>("cliente");
  const [filtros, setFiltros] = useState<React.ReactNode>(null);

  // Cambiar de sub-pestaña limpia los filtros viejos hasta que la nueva
  // vista reporte los suyos (evita mostrar, por un instante, chips de
  // "Por Vendedor" mientras se mira "Por Cliente").
  const cambiarSub = (k: (typeof SUB_TABS)[number]["key"]) => {
    setFiltros(null);
    setSub(k);
  };

  return (
    <AppShell
      current="/otros-analisis/"
      title="Otros Análisis"
      sidebar={<div className="space-y-5">{filtros}</div>}
    >
      <div className="flex gap-1.5 mt-6 mb-5">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => cambiarSub(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              sub === t.key ? "bg-[#7D4E5B] text-white" : "bg-[#f7f5f0] text-[#1c1811] hover:bg-[#ece6d8]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "cliente" && <PorCliente onFiltros={setFiltros} />}
      {sub === "sku" && <PorSku onFiltros={setFiltros} />}
      {sub === "vendedor" && <PorVendedor onFiltros={setFiltros} />}
    </AppShell>
  );
}
