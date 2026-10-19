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

interface FilaCliente { vendedor: string; cliente: string; cajas: number; cantidad: number; ars: number; mg_pct: number }
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

function PeriodoSelect({ periodo, onChange }: { periodo: string; onChange: (p: string) => void }) {
  const periodos = ultimosPeriodos();
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-[#847c68]">Período</label>
      <select
        value={periodo}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm bg-white"
      >
        {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}

// Buscador de texto libre por substring (norma de trabajo 4.sexdecies:
// dimensiones con muchos valores -- cliente, vendedor, artículo -- se
// filtran con un input libre, nunca con un <select> de selección única).
function BuscadorTexto({ valor, onChange, placeholder }: { valor: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="text"
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="px-3 py-1.5 rounded-md border border-[#ece6d8] text-sm bg-white w-56"
    />
  );
}

const normalizar = (s: string) => s.toLowerCase();

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

function PorCliente() {
  const [periodo, setPeriodo] = useState(ultimosPeriodos()[0]);
  const [busqueda, setBusqueda] = useState("");
  const { rows, loading, error } = useOtrosAnalisis<FilaCliente>("por-cliente", periodo);

  const texto = normalizar(busqueda.trim());
  const filtradas = texto
    ? rows.filter((r) => normalizar(r.vendedor).includes(texto) || normalizar(r.cliente).includes(texto))
    : rows;

  const vendedores = new Map<string, FilaCliente[]>();
  for (const r of filtradas) {
    if (!vendedores.has(r.vendedor)) vendedores.set(r.vendedor, []);
    vendedores.get(r.vendedor)!.push(r);
  }
  const grupos = [...vendedores.entries()].map(([vendedor, filas]) => ({
    vendedor, filas,
    total: filas.reduce((a, f) => ({ cajas: a.cajas + f.cajas, cantidad: a.cantidad + f.cantidad, ars: a.ars + f.ars }), { cajas: 0, cantidad: 0, ars: 0 }),
  })).sort((a, b) => b.total.ars - a.total.ars);

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">Por Cliente</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">Ventas VINOS por vendedor y cliente, Venta Neta en ARS.</p>
        </div>
        <div className="flex items-center gap-3">
          <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Buscar vendedor o cliente…" />
          <PeriodoSelect periodo={periodo} onChange={setPeriodo} />
        </div>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Vendedor / Cliente</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Cajas9l</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Cantidad</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Venta Neta</th>
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 ? (
                <tr><td colSpan={4} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : grupos.map((g) => (
                <Fragment key={g.vendedor}>
                  {g.filas.sort((a, b) => b.ars - a.ars).map((f) => (
                    <tr key={`${g.vendedor}::${f.cliente}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      <td className="py-1.5 px-3 pl-6 text-[#1c1811]">{f.cliente}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cajas)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.cantidad)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(f.ars)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                    <td className="py-1.5 px-3 text-[#1c1811]">Total {g.vendedor}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(g.total.cajas)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(g.total.cantidad)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(g.total.ars)}</td>
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

function PorSku() {
  const [periodo, setPeriodo] = useState(ultimosPeriodos()[0]);
  const [busqueda, setBusqueda] = useState("");
  const { rows, loading, error } = useOtrosAnalisis<FilaSku>("por-sku", periodo);

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
    }).sort((a, b) => b.totalCajas - a.totalCajas);
    const totalRubroCajas = filas.reduce((a, f) => a + f.totalCajas, 0);
    return { rubro, filas, totalRubroCajas };
  }).sort((a, b) => b.totalRubroCajas - a.totalRubroCajas);

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">Por SKU</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">Cajas9l por artículo, separado por mercado externo/interno.</p>
        </div>
        <div className="flex items-center gap-3">
          <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Buscar rubro o artículo…" />
          <PeriodoSelect periodo={periodo} onChange={setPeriodo} />
        </div>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Rubro / Artículo</th>
                {oficinas.map((o) => (
                  <th key={o} className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">{o}</th>
                ))}
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">Total Cajas9l</th>
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 ? (
                <tr><td colSpan={2 + oficinas.length} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : grupos.map((g) => (
                <Fragment key={g.rubro}>
                  {g.filas.map((f) => (
                    <tr key={`${g.rubro}::${f.c_articulo}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      <td className="py-1.5 px-3 pl-6 text-[#1c1811]">{f.d_articulo}</td>
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
                    <td className="py-1.5 px-3 text-[#1c1811]">Total {g.rubro}</td>
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

function PorVendedor() {
  const [periodo, setPeriodo] = useState(ultimosPeriodos()[0]);
  const [busqueda, setBusqueda] = useState("");
  const [vendedoresOcultos, setVendedoresOcultos] = useState<Set<string>>(new Set());
  const { rows, loading, error } = useOtrosAnalisis<FilaVendedor>("por-vendedor", periodo);

  // Chips de vendedor para elegir qué columnas mostrar -- la tabla pivotea
  // un vendedor por columna y con ~10 vendedores queda ilegible de ancha
  // (pedido explícito de Ezequiel 2026-10-19: "esta algo bruto diagramado").
  const vendedoresTotalesTodos = new Map<string, number>();
  rows.forEach((r) => vendedoresTotalesTodos.set(r.vendedor, (vendedoresTotalesTodos.get(r.vendedor) || 0) + r.ars));
  const todosVendedores = [...vendedoresTotalesTodos.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);

  const texto = normalizar(busqueda.trim());
  const filtradas = rows.filter((r) => {
    if (vendedoresOcultos.has(r.vendedor)) return false;
    if (!texto) return true;
    return normalizar(r.rubro).includes(texto) || normalizar(r.d_articulo).includes(texto);
  });

  const vendedoresTotales = new Map<string, number>();
  filtradas.forEach((r) => vendedoresTotales.set(r.vendedor, (vendedoresTotales.get(r.vendedor) || 0) + r.ars));
  const vendedores = [...vendedoresTotales.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);

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
    }).sort((a, b) => b.totalArs - a.totalArs);
    const totalRubroArs = filas.reduce((a, f) => a + f.totalArs, 0);
    return { rubro, filas, totalRubroArs };
  }).sort((a, b) => b.totalRubroArs - a.totalRubroArs);

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">Por Vendedor</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">Cantidad y Venta Neta (ARS) por artículo, separado por vendedor.</p>
        </div>
        <div className="flex items-center gap-3">
          <BuscadorTexto valor={busqueda} onChange={setBusqueda} placeholder="Buscar rubro o artículo…" />
          <PeriodoSelect periodo={periodo} onChange={setPeriodo} />
        </div>
      </div>
      {todosVendedores.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] text-[#847c68] mr-1">Vendedores:</span>
          {todosVendedores.map((v) => {
            const activo = !vendedoresOcultos.has(v);
            return (
              <button
                key={v}
                onClick={() => setVendedoresOcultos((prev) => {
                  const next = new Set(prev);
                  if (activo) next.add(v); else next.delete(v);
                  return next;
                })}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
                  activo ? "bg-[#7D4E5B] text-white" : "bg-[#f7f5f0] text-[#847c68] hover:bg-[#ece6d8]"
                }`}
              >
                {v}
              </button>
            );
          })}
          {vendedoresOcultos.size > 0 && (
            <button onClick={() => setVendedoresOcultos(new Set())} className="text-[11px] text-[#7D4E5B] hover:text-[#9F6375] underline ml-1">
              Mostrar todos
            </button>
          )}
        </div>
      )}
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th rowSpan={2} className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] align-bottom whitespace-nowrap">Rubro / Artículo</th>
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
                <tr><td colSpan={2 + vendedores.length * 2} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : grupos.map((g) => (
                <Fragment key={g.rubro}>
                  {g.filas.map((f) => (
                    <tr key={`${g.rubro}::${f.c_articulo}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      <td className="py-1.5 px-3 pl-6 text-[#1c1811] whitespace-nowrap">{f.d_articulo}</td>
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
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">Total {g.rubro}</td>
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

  return (
    <AppShell current="/otros-analisis/" title="Otros Análisis">
      <div className="flex gap-1.5 mt-6 mb-5">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              sub === t.key ? "bg-[#7D4E5B] text-white" : "bg-[#f7f5f0] text-[#1c1811] hover:bg-[#ece6d8]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "cliente" && <PorCliente />}
      {sub === "sku" && <PorSku />}
      {sub === "vendedor" && <PorVendedor />}
    </AppShell>
  );
}
