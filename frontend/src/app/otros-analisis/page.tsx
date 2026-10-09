"use client";
import { Fragment, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

// Otros Análisis -> Desglose por grupo (2026-10-08, pedido explícito de
// Ezequiel: "llevemos a un desglose de ventas a otros análisis... enviemos
// ahí el desglose del 100% de las ventas que cruzan con AFIP"). Panel de
// Ventas filtra `d_grupo == "VINOS **"` (el universo oficial de "Ventas"
// para la empresa, confirmado contra Operaciones_de_Ventas.xlsx -> hoja
// "Base de Ventas Colome", 100% D Grupo = VINOS sin excepción). Acá se
// muestra el 100% real (VINOS + INSUMOS + SERVICIOS) que concilia con
// AFIP, para que se vea explícito qué queda afuera de "Ventas" y por qué
// el total facturado no coincide con el Panel.
interface Fila { periodo: string; grupo: string; ars: number; usd: number }
interface Data { desde: string; rows: Fila[] }

const fmtNum = (n: number) =>
  n === 0 ? "-" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPeriodo = (p: string) => {
  const [y, m] = p.split("-");
  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${MESES[parseInt(m, 10) - 1]} ${y}`;
};

export default function OtrosAnalisisPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/otros-analisis/desglose-grupo")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el desglose");
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const periodos = data ? [...new Set(data.rows.map((r) => r.periodo))].sort() : [];
  const grupos = data ? [...new Set(data.rows.map((r) => r.grupo))].sort() : [];
  const find = (p: string, g: string) => data?.rows.find((r) => r.periodo === p && r.grupo === g);
  const totalPeriodo = (p: string, campo: "ars" | "usd") =>
    (data?.rows.filter((r) => r.periodo === p).reduce((a, r) => a + r[campo], 0)) || 0;

  return (
    <AppShell current="/otros-analisis/" title="Otros Análisis">
      <div className="border border-[#ece6d8] rounded-md p-5 bg-white mt-6">
        <h2 className="text-base font-semibold text-[#1c1811] mb-1">Desglose por grupo — 100% conciliado con AFIP</h2>
        <p className="text-[11px] text-[#847c68] mb-4">
          Panel de Ventas muestra solo el grupo VINOS (el universo oficial de &quot;Ventas&quot; de la empresa). Esta tabla muestra el 100% de las líneas facturadas (VINOS + INSUMOS + SERVICIOS) que concilian con AFIP, para ver qué queda afuera del Panel y por qué el total facturado no coincide.
        </p>

        {loading ? (
          <div className="h-48 w-full rounded-md bg-[#f7f5f0] animate-pulse" />
        ) : error ? (
          <p className="text-[#b8860b] text-sm">{error}</p>
        ) : !data || periodos.length === 0 ? (
          <p className="text-[#847c68] text-sm">Sin datos todavía.</p>
        ) : (
          <div className="scroll-x" style={{ overflowX: "auto" }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[#847c68] uppercase tracking-wide text-[10px]">
                  <th className="text-left py-1.5 pr-3">Período</th>
                  <th className="text-left py-1.5 pr-3">Grupo</th>
                  <th className="text-right py-1.5 pr-3">ARS</th>
                  <th className="text-right py-1.5">USD</th>
                </tr>
              </thead>
              <tbody>
                {periodos.map((p) => (
                  <Fragment key={p}>
                    {grupos.map((g, i) => {
                      const f = find(p, g);
                      return (
                        <tr key={`${p}-${g}`} className="border-t border-[#f3efe4]">
                          {i === 0 && (
                            <td className="py-1.5 pr-3 text-[#1c1811] font-medium" rowSpan={grupos.length}>
                              {fmtPeriodo(p)}
                            </td>
                          )}
                          <td className={`py-1.5 pr-3 ${g === "VINOS **" ? "text-[#7D4E5B] font-medium" : "text-[#847c68]"}`}>
                            {g}{g === "VINOS **" && <span className="ml-1 text-[10px]">(= Panel de Ventas)</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-right text-[#1c1811]">{fmtNum(f?.ars || 0)}</td>
                          <td className="py-1.5 text-right text-[#1c1811]">{fmtNum(f?.usd || 0)}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-[#ece6d8] bg-[#f7f5f0] font-medium">
                      <td className="py-1.5 pr-3 text-[#1c1811]" colSpan={2}>Total {fmtPeriodo(p)}</td>
                      <td className="py-1.5 pr-3 text-right text-[#1c1811]">{fmtNum(totalPeriodo(p, "ars"))}</td>
                      <td className="py-1.5 text-right text-[#1c1811]">{fmtNum(totalPeriodo(p, "usd"))}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
