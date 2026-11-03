"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

// Budget (2026-11-03, pedido explícito de Ezequiel: "la hoja Budget no esta
// mostrando la tabla con el Budget actual cargado. La idea es que se lea y
// edite desde ahí") -- esta pantalla era un <Placeholder> sin datos reales
// atrás, pese a que el Budget SÍ existe y se usa en vivo (Panel de Ventas,
// tabla comparativa; Sales Performance, Budget por línea). Ver backend/
// budget.py para el detalle de la migración de 2 archivos JSON estáticos a
// 2 tablas editables en DB.
//
// 1 sola tabla (Total + las 7 líneas de negocio, cada una USD/Cajas9l),
// 12 filas (un período del ejercicio 2026-2027 por fila) -- mismo criterio
// visual que la tabla pivot de Otros Análisis -> Por Vendedor (grupos de
// columnas con sub-columnas, scroll horizontal). Edición inline: admin
// edita un número y al salir del campo (blur) se guarda solo, sin botón
// "Guardar" aparte -- igual que el resto de Datos Maestros.

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function labelPeriodo(p: string): string {
  const [anio, mes] = p.split("-").map(Number);
  return `${MESES[mes - 1]} ${anio}`;
}

const fmtNum = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Cajas9l con 2 decimales (mismo criterio que el drill-down de Otros
// Análisis, ver proyecto_colome_ventas_drilldown_cliente_marca_producto en
// memoria de Claude) -- los valores de Budget por línea vienen con
// decimales reales (ej. 115.5, 8.08), 0 decimales los distorsionaba.
const fmtCajas = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface FilaBudget {
  periodo: string;
  usd: number;
  cajas: number;
  por_linea: Record<string, [number, number]>;
}

function CeldaEditable({ valor, onGuardar, puedeEditar, fmt = fmtNum }: {
  valor: number; onGuardar: (v: number) => Promise<void>; puedeEditar: boolean; fmt?: (n: number) => string;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(String(valor));
  const [guardando, setGuardando] = useState(false);

  if (!puedeEditar) {
    return <span className="tabular-nums">{fmt(valor)}</span>;
  }
  if (!editando) {
    return (
      <button
        onClick={() => { setTexto(String(valor)); setEditando(true); }}
        className="tabular-nums w-full text-right hover:bg-[#f0e9d8] rounded px-1 -mx-1"
        title="Click para editar"
      >
        {fmt(valor)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      step="any"
      value={texto}
      disabled={guardando}
      onChange={(e) => setTexto(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditando(false); }}
      onBlur={async () => {
        const n = parseFloat(texto);
        setEditando(false);
        if (Number.isNaN(n) || n === valor) return;
        setGuardando(true);
        await onGuardar(n);
        setGuardando(false);
      }}
      className="w-24 text-right px-1 py-0.5 rounded border border-[#d9b38c] text-sm tabular-nums"
    />
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

  const guardarTotal = async (periodo: string, usd: number, cajas: number) => {
    const r = await fetch(`/api/budget/${encodeURIComponent(periodo)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usd, cajas }),
    });
    if (r.ok) load();
  };

  const guardarLinea = async (periodo: string, linea: string, usd: number, cajas: number) => {
    const r = await fetch(`/api/budget/${encodeURIComponent(periodo)}/linea/${encodeURIComponent(linea)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usd, cajas }),
    });
    if (r.ok) load();
  };

  const total = filas.reduce(
    (a, f) => ({ usd: a.usd + f.usd, cajas: a.cajas + f.cajas }),
    { usd: 0, cajas: 0 },
  );

  return (
    <AppShell current="/budget/" title="Budget">
      <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6 mt-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1c1811]">Budget 2026-2027</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Fuente: Budget_Dinamico.xlsx de Ariel Culasso, clasificado por línea de negocio (ver ARQUITECTURA.md). USD en miles, consistente con Panel de Ventas y Sales Performance.
            {puedeEditar ? " Click en un número para editarlo -- se guarda solo al salir del campo." : " Solo lectura (rol admin para editar)."}
          </p>
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {loading ? (
          <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
        ) : (
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
                        <td className="py-1.5 px-3 text-right border-l border-[#f3efe4]">
                          <CeldaEditable valor={f.usd} puedeEditar={puedeEditar} onGuardar={(v) => guardarTotal(f.periodo, v, f.cajas)} />
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <CeldaEditable valor={f.cajas} puedeEditar={puedeEditar} fmt={fmtCajas} onGuardar={(v) => guardarTotal(f.periodo, f.usd, v)} />
                        </td>
                        {lineas.map((l) => {
                          const [usdL, cajasL] = f.por_linea[l] ?? [0, 0];
                          return (
                            <Fragment key={l}>
                              <td className="py-1.5 px-3 text-right border-l border-[#f3efe4]">
                                <CeldaEditable valor={usdL} puedeEditar={puedeEditar} onGuardar={(v) => guardarLinea(f.periodo, l, v, cajasL)} />
                              </td>
                              <td className="py-1.5 px-3 text-right">
                                <CeldaEditable valor={cajasL} puedeEditar={puedeEditar} fmt={fmtCajas} onGuardar={(v) => guardarLinea(f.periodo, l, usdL, v)} />
                              </td>
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
        )}
      </div>
    </AppShell>
  );
}
