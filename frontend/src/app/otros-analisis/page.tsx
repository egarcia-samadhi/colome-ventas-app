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
// para el campo real encontrado, `m_desc_total`). Por SKU/Por Vendedor NO
// se tocan, siguen con el diseño anterior (Ariel solo pidió esto para Por
// Cliente).

interface FilaCliente { vendedor: string; canal: string; cliente: string; cajas: number; cantidad: number; ars: number; descuento: number; mg_pct: number }
interface FilaSku { rubro: string; c_articulo: string; d_articulo: string; oficina: string; cajas: number; mg_pct: number }
interface FilaVendedor { rubro: string; c_articulo: string; d_articulo: string; vendedor: string; cantidad: number; ars: number; mg_pct: number }

const fmtNum = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function ultimosPeriodos(cantidad = 24): string[] {
  const hoy = new Date();
  const out: string[] = [];
  for (let i = 1; i <= cantidad; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Todos los controles de filtro de esta pantalla viven en el SIDEBAR
// (fondo oscuro #2b2d31 del AppShell) -- estilos propios, distintos de los
// inputs claros que usa el resto de las tarjetas.
function PeriodoSelect({ periodo, onChange }: { periodo: string; onChange: (p: string) => void }) {
  const periodos = ultimosPeriodos();
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Período</label>
      <select
        value={periodo}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-md border border-white/15 text-sm bg-white/5 text-white [&>option]:text-[#1c1811]"
      >
        {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}

function mesCerradoAnteriorRango(): { desde: string; hasta: string } {
  const hoy = new Date();
  const anio = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
  const mes = hoy.getMonth() === 0 ? 11 : hoy.getMonth() - 1; // 0-indexed
  const desde = new Date(anio, mes, 1);
  const hasta = new Date(anio, mes + 1, 0);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: fmt(desde), hasta: fmt(hasta) };
}

// Rango de fechas libre (pedido de Ariel Culasso 2026-11-02, "Por Cliente"):
// reemplaza el PeriodoSelect de un solo mes en esa vista puntual -- Por
// SKU/Por Vendedor siguen con PeriodoSelect sin cambios.
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
function ChipsFiltro({ label, opciones, ocultos, onToggle, onMostrarTodos }: {
  label: string; opciones: string[]; ocultos: Set<string>; onToggle: (v: string) => void; onMostrarTodos: () => void;
}) {
  if (opciones.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] uppercase tracking-wide text-white/40">{label}</label>
        {ocultos.size > 0 && (
          <button onClick={onMostrarTodos} className="text-[10px] text-[#DCBE84] hover:text-white underline">Todos</button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {opciones.map((v) => {
          const activo = !ocultos.has(v);
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
              {v}
            </label>
          );
        })}
      </div>
    </div>
  );
}

const normalizar = (s: string) => s.toLowerCase();
const porNombre = (a: string, b: string) => a.localeCompare(b, "es");

function useOtrosAnalisis<T>(endpoint: string, periodo: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/otros-analisis/${endpoint}?periodo=${periodo}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error(`Error cargando ${endpoint}`);
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [endpoint, periodo]);

  useEffect(load, [load]);
  return { rows, loading, error };
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

type Segmentador = "vendedor" | "canal";

function PorCliente({ onFiltros }: { onFiltros: (n: React.ReactNode) => void }) {
  const [{ desde: desdeDefault, hasta: hastaDefault }] = useState(mesCerradoAnteriorRango());
  const [desde, setDesde] = useState(desdeDefault);
  const [hasta, setHasta] = useState(hastaDefault);
  const [busqueda, setBusqueda] = useState("");
  const [segmentador, setSegmentador] = useState<Segmentador>("vendedor");
  const [segmentoOcultos, setSegmentoOcultos] = useState<Set<string>>(new Set());
  const { rows, loading, error } = useOtrosAnalisisRango<FilaCliente>("por-cliente", desde, hasta);

  // Cambiar de segmentador (Vendedor<->Canal) resetea los chips ocultos --
  // los valores de un dimensión no tienen sentido como filtro de la otra.
  const cambiarSegmentador = (s: Segmentador) => {
    setSegmentador(s);
    setSegmentoOcultos(new Set());
  };

  const opcionesSegmento = [...new Set(rows.map((r) => r[segmentador]))].sort(porNombre);
  const toggleSegmento = (v: string) => setSegmentoOcultos((prev) => {
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
          ocultos={segmentoOcultos}
          onToggle={toggleSegmento}
          onMostrarTodos={() => setSegmentoOcultos(new Set())}
        />
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, busqueda, segmentador, segmentoOcultos, onFiltros, opcionesSegmento.join("|")]);

  const texto = normalizar(busqueda.trim());
  const filtradas = rows.filter((r) => {
    if (segmentoOcultos.has(r[segmentador])) return false;
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
  const ranking = [...porCliente.values()].sort((a, b) => b.ars - a.ars);
  const total = ranking.reduce((a, f) => ({ cajas: a.cajas + f.cajas, cantidad: a.cantidad + f.cantidad, ars: a.ars + f.ars, descuento: a.descuento + f.descuento }), { cajas: 0, cantidad: 0, ars: 0, descuento: 0 });

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1c1811]">Por Cliente</h3>
        <p className="text-[11px] text-[#847c68] mt-0.5">Ranking de clientes (ventas VINOS), Venta Neta y Descuento Comercial en ARS. Filtrar por {segmentador} en el sidebar.</p>
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
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">Cliente</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Cajas9l</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Cantidad</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Venta Neta</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Descuento Comercial</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : (
                <>
                  {ranking.map((f, i) => (
                    <tr key={f.cliente} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      <td className="py-1.5 px-3 text-right tabular-nums text-[#847c68]">{i + 1}</td>
                      <td className="py-1.5 px-3 text-[#1c1811] border-l border-[#f3efe4]">{f.cliente}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cajas)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cantidad)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.ars)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.descuento)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                    <td className="py-1.5 px-3" colSpan={2}>Total</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.cajas)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.cantidad)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.ars)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.descuento)}</td>
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

function PorSku({ onFiltros }: { onFiltros: (n: React.ReactNode) => void }) {
  const [periodo, setPeriodo] = useState(ultimosPeriodos()[0]);
  const [busqueda, setBusqueda] = useState("");
  const { rows, loading, error } = useOtrosAnalisis<FilaSku>("por-sku", periodo);

  useEffect(() => {
    onFiltros(
      <div className="space-y-4">
        <PeriodoSelect periodo={periodo} onChange={setPeriodo} />
        <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Rubro o artículo…" label="Buscar" />
      </div>
    );
  }, [periodo, busqueda, onFiltros]);

  const texto = normalizar(busqueda.trim());
  const filtradas = texto
    ? rows.filter((r) => normalizar(r.rubro).includes(texto) || normalizar(r.d_articulo).includes(texto))
    : rows;

  const oficinasSet = new Set<string>();
  filtradas.forEach((r) => oficinasSet.add(r.oficina));
  const orden = ["MERCADO EXTERNO", "MERCADO INTERNO"];
  const oficinas = [...orden.filter((o) => oficinasSet.has(o)), ...[...oficinasSet].filter((o) => !orden.includes(o))];

  const rubros = new Map<string, Map<string, { d_articulo: string; porOficina: Map<string, { cajas: number }> }>>();
  for (const r of filtradas) {
    if (!rubros.has(r.rubro)) rubros.set(r.rubro, new Map());
    const arts = rubros.get(r.rubro)!;
    const key = `${r.c_articulo}::${r.d_articulo}`;
    if (!arts.has(key)) arts.set(key, { d_articulo: r.d_articulo, porOficina: new Map() });
    arts.get(key)!.porOficina.set(r.oficina, { cajas: r.cajas });
  }

  const grupos = [...rubros.entries()].map(([rubro, arts]) => {
    const filas = [...arts.entries()].map(([key, v]) => {
      const [c_articulo] = key.split("::");
      const totalCajas = [...v.porOficina.values()].reduce((a, o) => a + o.cajas, 0);
      return { c_articulo, d_articulo: v.d_articulo, porOficina: v.porOficina, totalCajas };
    }).sort((a, b) => porNombre(a.d_articulo, b.d_articulo));
    const totalRubroCajas = filas.reduce((a, f) => a + f.totalCajas, 0);
    return { rubro, filas, totalRubroCajas };
  }).sort((a, b) => porNombre(a.rubro, b.rubro));

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1c1811]">Por SKU</h3>
        <p className="text-[11px] text-[#847c68] mt-0.5">Cajas9l por artículo, separado por mercado externo/interno.</p>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Rubro</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">Artículo</th>
                {oficinas.map((o) => (
                  <th key={o} className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">{o}</th>
                ))}
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">Total Cajas9l</th>
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 ? (
                <tr><td colSpan={3 + oficinas.length} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : grupos.map((g) => (
                <Fragment key={g.rubro}>
                  {g.filas.map((f, i) => (
                    <tr key={`${g.rubro}::${f.c_articulo}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      {i === 0 && (
                        <td rowSpan={g.filas.length} className="py-1.5 px-3 text-[#1c1811] align-top font-medium">{g.rubro}</td>
                      )}
                      <td className="py-1.5 px-3 text-[#1c1811] border-l border-[#f3efe4]">{f.d_articulo}</td>
                      {oficinas.map((o) => {
                        const v = f.porOficina.get(o);
                        return (
                          <td key={o} className="py-1.5 px-3 text-right tabular-nums border-l border-[#f3efe4]">{v ? fmtNum(v.cajas) : "—"}</td>
                        );
                      })}
                      <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#f3efe4] font-medium">{fmtNum(f.totalCajas)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                    <td className="py-1.5 px-3 text-[#1c1811]" colSpan={2}>Total {g.rubro}</td>
                    {oficinas.map((o) => <td key={o} className="border-l border-[#ece6d8]" />)}
                    <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#ece6d8]">{fmtNum(g.totalRubroCajas)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PorVendedor({ onFiltros }: { onFiltros: (n: React.ReactNode) => void }) {
  const [periodo, setPeriodo] = useState(ultimosPeriodos()[0]);
  const [busqueda, setBusqueda] = useState("");
  const [vendedoresOcultos, setVendedoresOcultos] = useState<Set<string>>(new Set());
  const { rows, loading, error } = useOtrosAnalisis<FilaVendedor>("por-vendedor", periodo);

  // Chips de vendedor para elegir qué columnas mostrar -- la tabla pivotea
  // un vendedor por columna y con ~10 vendedores queda ilegible de ancha
  // (pedido explícito de Ezequiel 2026-10-19: "esta algo bruto diagramado").
  const todosVendedores = [...new Set(rows.map((r) => r.vendedor))].sort(porNombre);

  const toggleVendedor = (v: string) => setVendedoresOcultos((prev) => {
    const next = new Set(prev);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  });

  useEffect(() => {
    onFiltros(
      <div className="space-y-4">
        <PeriodoSelect periodo={periodo} onChange={setPeriodo} />
        <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Rubro o artículo…" label="Buscar" />
        <ChipsFiltro
          label="Vendedores"
          opciones={todosVendedores}
          ocultos={vendedoresOcultos}
          onToggle={toggleVendedor}
          onMostrarTodos={() => setVendedoresOcultos(new Set())}
        />
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, busqueda, vendedoresOcultos, onFiltros, todosVendedores.join("|")]);

  const texto = normalizar(busqueda.trim());
  const filtradas = rows.filter((r) => {
    if (vendedoresOcultos.has(r.vendedor)) return false;
    if (!texto) return true;
    return normalizar(r.rubro).includes(texto) || normalizar(r.d_articulo).includes(texto);
  });

  const vendedores = [...new Set(filtradas.map((r) => r.vendedor))].sort(porNombre);

  const rubros = new Map<string, Map<string, { d_articulo: string; porVendedor: Map<string, { cantidad: number; ars: number; mg_pct: number }> }>>();
  for (const r of filtradas) {
    if (!rubros.has(r.rubro)) rubros.set(r.rubro, new Map());
    const arts = rubros.get(r.rubro)!;
    const key = `${r.c_articulo}::${r.d_articulo}`;
    if (!arts.has(key)) arts.set(key, { d_articulo: r.d_articulo, porVendedor: new Map() });
    arts.get(key)!.porVendedor.set(r.vendedor, { cantidad: r.cantidad, ars: r.ars, mg_pct: r.mg_pct });
  }

  const grupos = [...rubros.entries()].map(([rubro, arts]) => {
    const filas = [...arts.entries()].map(([key, v]) => {
      const [c_articulo] = key.split("::");
      const totalArs = [...v.porVendedor.values()].reduce((a, o) => a + o.ars, 0);
      return { c_articulo, d_articulo: v.d_articulo, porVendedor: v.porVendedor, totalArs };
    }).sort((a, b) => porNombre(a.d_articulo, b.d_articulo));
    const totalRubroArs = filas.reduce((a, f) => a + f.totalArs, 0);
    return { rubro, filas, totalRubroArs };
  }).sort((a, b) => porNombre(a.rubro, b.rubro));

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1c1811]">Por Vendedor</h3>
        <p className="text-[11px] text-[#847c68] mt-0.5">Cantidad y Venta Neta (ARS) por artículo, separado por vendedor.</p>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th rowSpan={2} className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] align-bottom whitespace-nowrap">Rubro</th>
                <th rowSpan={2} className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] align-bottom whitespace-nowrap border-l border-[#ece6d8]">Artículo</th>
                {vendedores.map((v) => (
                  <th key={v} colSpan={2} className="py-1.5 px-3 text-center text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8] whitespace-nowrap">{v}</th>
                ))}
                <th colSpan={1} className="py-1.5 px-3 text-center text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">Total</th>
              </tr>
              <tr className="bg-[#f7f5f0]">
                {vendedores.map((v) => (
                  <Fragment key={v}>
                    <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68] border-l border-[#ece6d8]">Cant.</th>
                    <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68]">Venta Neta</th>
                  </Fragment>
                ))}
                <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68] border-l border-[#ece6d8]">Venta Neta</th>
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 ? (
                <tr><td colSpan={3 + vendedores.length * 2} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
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
                            <td className="py-1.5 px-3 text-right tabular-nums">{val ? fmtNum(val.ars) : "—"}</td>
                          </Fragment>
                        );
                      })}
                      <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#f3efe4] font-medium">{fmtNum(f.totalArs)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap" colSpan={2}>Total {g.rubro}</td>
                    {vendedores.map((v) => <Fragment key={v}><td className="border-l border-[#ece6d8]" /><td /></Fragment>)}
                    <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#ece6d8]">{fmtNum(g.totalRubroArs)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
