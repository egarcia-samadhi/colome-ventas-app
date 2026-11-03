"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";

// Budget (2026-11-03, pedido explícito de Ezequiel: "la hoja Budget no esta
// mostrando la tabla con el Budget actual cargado. La idea es que se lea y
// edite desde ahí") -- esta pantalla era un <Placeholder> sin datos reales
// atrás, pese a que el Budget SÍ existe y se usa en vivo (Panel de Ventas,
// tabla comparativa; Sales Performance, Budget por línea). Ver backend/
// budget.py para el detalle completo.
//
// MISMO DÍA, 2do pedido ("te quedaste corto con la vista del budget,
// deberiamos cargar la hoja datos" -> "subamos todo y que cada fila tenga
// un boton de editar para cambiar los montos o cantidades"): se agrega la
// sección "Detalle (SKU)" de abajo, con las 2.329 filas reales de la hoja
// "Datos" de Budget_Dinamico.xlsx (verificado antes de cargar que agregarla
// reproduce exacto el Total/Por Línea ya cargados, ver ARQUITECTURA.md).
// Pasa a ser la ÚNICA fuente editable -- la tabla de arriba (Total + Por
// Línea) queda de SOLO LECTURA, calculada en vivo sumando el detalle
// (backend/budget.py), para que nunca puedan desincronizarse.

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function labelPeriodo(p: string): string {
  const [anio, mes] = p.split("-").map(Number);
  return `${MESES[mes - 1]} ${anio}`;
}

const fmtNum = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Cajas9l con 2 decimales (mismo criterio que el drill-down de Otros
// Análisis, ver proyecto_colome_ventas_drilldown_cliente_marca_producto en
// memoria de Claude) -- los valores de Budget vienen con decimales reales
// (ej. 115.5, 8.08), 0 decimales los distorsionaba.
const fmtCajas = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface FilaBudget {
  periodo: string;
  usd: number;
  cajas: number;
  por_linea: Record<string, [number, number]>;
}

interface FilaDetalle {
  id: number;
  periodo: string;
  sku: string;
  canal: string;
  mercado: string;
  cajas: number;
  usd: number;
}

function TablaResumen({ lineas, filas }: { lineas: string[]; filas: FilaBudget[] }) {
  const total = filas.reduce((a, f) => ({ usd: a.usd + f.usd, cajas: a.cajas + f.cajas }), { usd: 0, cajas: 0 });
  return (
    <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#f7f5f0]">
            <th rowSpan={2} className="py-1.5 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] align-bottom whitespace-nowrap">Período</th>
            <th colSpan={2} className="py-1.5 px-3 text-center text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8]">Total</th>
            {lineas.map((l) => (
              <th key={l} colSpan={2} className="py-1.5 px-3 text-center text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] border-l border-[#ece6d8] whitespace-nowrap">{l}</th>
            ))}
          </tr>
          <tr className="bg-[#f7f5f0]">
            <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68] border-l border-[#ece6d8]">USD</th>
            <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68]">Cajas9l</th>
            {lineas.map((l) => (
              <Fragment key={l}>
                <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68] border-l border-[#ece6d8]">USD</th>
                <th className="py-1.5 px-3 text-right text-[10px] text-[#847c68]">Cajas9l</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr><td colSpan={2 + lineas.length * 2} className="py-12 text-center text-[#847c68]">No hay Budget cargado</td></tr>
          ) : (
            <>
              {filas.map((f) => (
                <tr key={f.periodo} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap font-medium">{labelPeriodo(f.periodo)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#f3efe4]">{fmtNum(f.usd)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{fmtCajas(f.cajas)}</td>
                  {lineas.map((l) => {
                    const [usdL, cajasL] = f.por_linea[l] ?? [0, 0];
                    return (
                      <Fragment key={l}>
                        <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#f3efe4]">{fmtNum(usdL)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtCajas(cajasL)}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                <td className="py-1.5 px-3">Total ejercicio</td>
                <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#ece6d8]">{fmtNum(total.usd)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{fmtCajas(total.cajas)}</td>
                {lineas.map((l) => {
                  const sum = filas.reduce((a, f) => {
                    const [u, c] = f.por_linea[l] ?? [0, 0];
                    return { usd: a.usd + u, cajas: a.cajas + c };
                  }, { usd: 0, cajas: 0 });
                  return (
                    <Fragment key={l}>
                      <td className="py-1.5 px-3 text-right tabular-nums border-l border-[#ece6d8]">{fmtNum(sum.usd)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtCajas(sum.cajas)}</td>
                    </Fragment>
                  );
                })}
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilaDetalleEditable({ fila, puedeEditar, onGuardado }: {
  fila: FilaDetalle; puedeEditar: boolean; onGuardado: (id: number, cajas: number, usd: number) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [cajas, setCajas] = useState(String(fila.cajas));
  const [usd, setUsd] = useState(String(fila.usd));
  const [guardando, setGuardando] = useState(false);

  if (!editando) {
    return (
      <tr className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
        <td className="py-1.5 px-3 text-[#1c1811]">{fila.sku}</td>
        <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{fila.canal}</td>
        <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{fila.mercado}</td>
        <td className="py-1.5 px-3 text-right tabular-nums">{fmtCajas(fila.cajas)}</td>
        <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(fila.usd)}</td>
        {puedeEditar && (
          <td className="py-1.5 px-3 text-center">
            <button onClick={() => { setCajas(String(fila.cajas)); setUsd(String(fila.usd)); setEditando(true); }} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs">Editar</button>
          </td>
        )}
      </tr>
    );
  }
  return (
    <tr className="border-t border-[#d9b38c] bg-[#fdf3ea]">
      <td className="py-1.5 px-3 text-[#1c1811]">{fila.sku}</td>
      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{fila.canal}</td>
      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{fila.mercado}</td>
      <td className="py-1.5 px-3 text-right">
        <input type="number" step="any" value={cajas} disabled={guardando} onChange={(e) => setCajas(e.target.value)}
          className="w-24 text-right px-1 py-0.5 rounded border border-[#d9b38c] text-sm tabular-nums" />
      </td>
      <td className="py-1.5 px-3 text-right">
        <input type="number" step="any" value={usd} disabled={guardando} onChange={(e) => setUsd(e.target.value)}
          className="w-28 text-right px-1 py-0.5 rounded border border-[#d9b38c] text-sm tabular-nums" />
      </td>
      <td className="py-1.5 px-3 text-center whitespace-nowrap">
        <button
          disabled={guardando}
          onClick={async () => {
            const c = parseFloat(cajas), u = parseFloat(usd);
            if (Number.isNaN(c) || Number.isNaN(u)) return;
            setGuardando(true);
            await onGuardado(fila.id, c, u);
            setGuardando(false);
            setEditando(false);
          }}
          className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-2"
        >
          Guardar
        </button>
        <button onClick={() => setEditando(false)} disabled={guardando} className="text-[#847c68] hover:text-[#5a5342] text-xs">Cancelar</button>
      </td>
    </tr>
  );
}

function SeccionDetalle({ periodos, puedeEditar, onCambio }: {
  periodos: string[]; puedeEditar: boolean; onCambio: () => void;
}) {
  const [periodo, setPeriodo] = useState(periodos[0] ?? "");
  const [busqueda, setBusqueda] = useState("");
  const [filas, setFilas] = useState<FilaDetalle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!periodo && periodos[0]) setPeriodo(periodos[0]); }, [periodos, periodo]);

  const load = useCallback(() => {
    if (!periodo) return;
    setLoading(true);
    setError(null);
    fetch(`/api/budget/detalle?periodo=${encodeURIComponent(periodo)}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el detalle");
        return r.json();
      })
      .then((d) => { if (d) setFilas(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [periodo]);

  useEffect(load, [load]);

  const guardarFila = async (id: number, cajas: number, usd: number) => {
    const r = await fetch(`/api/budget/detalle/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cajas, usd }),
    });
    if (r.ok) { load(); onCambio(); }
  };

  const texto = busqueda.trim().toLowerCase();
  const filtradas = useMemo(
    () => (texto ? filas.filter((f) => f.sku.toLowerCase().includes(texto) || f.mercado.toLowerCase().includes(texto) || f.canal.toLowerCase().includes(texto)) : filas),
    [filas, texto],
  );

  const total = filtradas.reduce((a, f) => ({ cajas: a.cajas + f.cajas, usd: a.usd + f.usd }), { cajas: 0, usd: 0 });

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">Detalle (SKU)</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Las 2.329 filas reales de la hoja &quot;Datos&quot; de Budget_Dinamico.xlsx (SKU × Canal × Mercado). Es la fuente real -- editar acá recalcula Total y Por Línea de la tabla de arriba.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm">
            {periodos.map((p) => <option key={p} value={p}>{labelPeriodo(p)}</option>)}
          </select>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar SKU, canal o mercado…"
            className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-56"
          />
        </div>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8] max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="bg-[#f7f5f0]">
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">SKU</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Canal</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Mercado</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Caja de 9</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">USD</th>
                {puedeEditar && <th className="w-20" />}
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 6 : 5} className="py-12 text-center text-[#847c68]">Sin filas para este período/búsqueda</td></tr>
              ) : (
                <>
                  {filtradas.map((f) => (
                    <FilaDetalleEditable key={f.id} fila={f} puedeEditar={puedeEditar} onGuardado={guardarFila} />
                  ))}
                  <tr className="border-t border-[#ece6d8] bg-[#fdf3ea] font-medium">
                    <td className="py-1.5 px-3" colSpan={3}>Total ({filtradas.length} filas)</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtCajas(total.cajas)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtNum(total.usd)}</td>
                    {puedeEditar && <td />}
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

export default function BudgetPage() {
  const [lineas, setLineas] = useState<string[]>([]);
  const [filas, setFilas] = useState<FilaBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setPuedeEditar(u?.role === "admin"))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/budget")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el Budget");
        return r.json();
      })
      .then((d) => { if (d) { setLineas(d.lineas); setFilas(d.periodos); } })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const periodos = filas.map((f) => f.periodo);
  const [sub, setSub] = useState<"resumen" | "detalle">("resumen");

  return (
    <AppShell current="/budget/" title="Budget">
      <div className="flex gap-1.5 mt-6 mb-5">
        {(["resumen", "detalle"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSub(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              sub === t ? "bg-[#7D4E5B] text-white" : "bg-[#f7f5f0] text-[#1c1811] hover:bg-[#ece6d8]"
            }`}
          >
            {t === "resumen" ? "Total y Por Línea" : "Detalle (SKU)"}
          </button>
        ))}
      </div>

      {sub === "resumen" && (
        <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[#1c1811]">Budget 2026-2027</h3>
            <p className="text-[11px] text-[#847c68] mt-0.5">
              Fuente: Budget_Dinamico.xlsx de Ariel Culasso. USD en miles, consistente con Panel de Ventas y Sales Performance. Total y Por Línea son de solo lectura -- se calculan sumando el Detalle (SKU) (otra pestaña), que es la fuente real editable.
            </p>
          </div>
          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
          {loading ? <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" /> : <TablaResumen lineas={lineas} filas={filas} />}
        </div>
      )}

      {sub === "detalle" && !loading && periodos.length > 0 && (
        <SeccionDetalle periodos={periodos} puedeEditar={puedeEditar} onCambio={load} />
      )}
    </AppShell>
  );
}
