"use client";
import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { nombrePropio } from "@/lib/nombrePropio";

// 2026-10-07 -- "Info AFIP" replicado de chakana-ventas (backend/app/afip.py
// + frontend/src/app/ctrl-afip/page.tsx), mismo mecanismo de carga (plantilla
// Excel descargable -> pegar el export de AFIP -> subir). Las otras 4
// sub-hojas de Chakana (Cruce AFIP, Ventas por Jurisdicción, Duplicados
// Facturante, Composición Vino/Otros) cruzan contra el ERP en vivo, que acá
// todavía no está conectado -- quedan pendientes a propósito (ver
// ARQUITECTURA.md), esto es deliberadamente solo la carga.
interface FilaJurisdiccion {
  periodo: string;
  jurisdiccion: string;
  ars: number;
  usd: number;
}

interface FilaAfip {
  id: number;
  fecha: string;
  tipo: string;
  punto_venta: string;
  numero_desde: string;
  numero_hasta: string;
  cod_autorizacion: string;
  tipo_doc_receptor: string;
  nro_doc_receptor: string;
  denominacion_receptor: string;
  tipo_cambio: number;
  moneda: string;
  imp_neto_gravado: number;
  imp_neto_no_gravado: number;
  imp_op_exentas: number;
  otros_tributos: number;
  iva: number;
  imp_total: number;
  periodo: string;
  credito: string;
  monto: number;
  valor_doc: number;
}

const fmtMonto = (n: number) =>
  n === 0 ? "" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ultimosPeriodos(cantidad = 24): string[] {
  const hoy = new Date();
  const out: string[] = [];
  for (let i = 0; i < cantidad; i++) {
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

// Replica de "Ventas por Jurisdicción" de chakana-ventas (backend/app/
// jurisdiccion.py + frontend ctrl-afip/page.tsx), misma estructura de UI
// (selector de un solo mes a la vez, tabla Período/Jurisdicción/montos en
// moneda original). Adaptado a la fuente de datos de Colomé: la "provincia"
// viene de ig_ventas (n_provincia), no del ERP Bejerman de Chakana, y no
// hay columna EUR porque ig_ventas solo trae ARS/USD (ver jurisdiccion.py).
function VentasPorJurisdiccion() {
  const [periodo, setPeriodo] = useState(ultimosPeriodos()[1]);
  const [rows, setRows] = useState<FilaJurisdiccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ periodo });
    fetch(`/api/ventas/jurisdiccion?${params.toString()}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando Ventas por Jurisdicción");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [periodo]);

  useEffect(load, [load]);

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">Ventas por Jurisdicción</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Provincia del comprobante (ig_ventas), en moneda original (sin convertir a USD).
          </p>
        </div>
        <PeriodoSelect periodo={periodo} onChange={setPeriodo} />
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f5f0]">
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Período</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Jurisdicción</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">ARS</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">USD</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="py-12 text-center text-[#847c68]">Sin datos para este período</td></tr>
              ) : rows.map((r) => (
                <tr key={`${r.periodo}::${r.jurisdiccion}`} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.periodo}</td>
                  <td className="py-1.5 px-3 text-[#1c1811]">{nombrePropio(r.jurisdiccion)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{fmtMonto(r.ars)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{fmtMonto(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InfoAfip() {
  const [periodo, setPeriodo] = useState(ultimosPeriodos()[1]);
  const [rows, setRows] = useState<FilaAfip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mostrarImportador, setMostrarImportador] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [puedeImportar, setPuedeImportar] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setPuedeImportar(u?.role === "admin"))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ periodo });
    fetch(`/api/afip/comprobantes?${params.toString()}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando Info AFIP");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [periodo]);

  useEffect(load, [load]);

  const borrarPeriodo = async () => {
    if (!window.confirm(`¿Borrar TODA la Info AFIP cargada del período ${periodo}? No se puede deshacer.`)) return;
    setBorrando(true);
    setResultadoImport(null);
    try {
      const r = await fetch(`/api/afip/periodo/${periodo}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Error al borrar");
      setResultadoImport(`Borradas ${d.filas_borradas} filas del período ${periodo}.`);
      load();
    } catch (e) {
      setResultadoImport(`Error: ${(e as Error).message}`);
    } finally {
      setBorrando(false);
    }
  };

  const importar = async () => {
    if (!archivo) return;
    setImportando(true);
    setResultadoImport(null);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      const r = await fetch("/api/afip/importar", { method: "POST", body: formData });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Error al importar");
      setResultadoImport(`Importadas ${d.filas_importadas} filas. Períodos: ${Object.entries(d.periodos).map(([p, n]) => `${p} (${n})`).join(", ")}`);
      setArchivo(null);
      load();
    } catch (e) {
      setResultadoImport(`Error: ${(e as Error).message}`);
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">Info AFIP</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Carga mensual del export de AFIP (&quot;Mis Comprobantes&quot;). Período/Crédito?/Monto/Valor doc se calculan al importar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodoSelect periodo={periodo} onChange={setPeriodo} />
          {puedeImportar && rows.length > 0 && (
            <button
              onClick={borrarPeriodo}
              disabled={borrando}
              className="px-3 py-1.5 rounded-full text-sm font-medium border border-[#d9b38c] bg-white text-[#b8860b] hover:bg-[#fdf3ea] transition disabled:opacity-50"
            >
              {borrando ? "Borrando…" : `Borrar ${periodo}`}
            </button>
          )}
          {puedeImportar && (
            <button
              onClick={() => setMostrarImportador((v) => !v)}
              className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#7D4E5B] text-white hover:bg-[#9F6375] transition"
            >
              {mostrarImportador ? "Cerrar" : "+ Importar"}
            </button>
          )}
        </div>
      </div>

      {puedeImportar && mostrarImportador && (
        <div className="mb-4 p-4 rounded-md border border-[#ece6d8] bg-[#f7f5f0]">
          <p className="text-[11px] text-[#847c68] mb-3">
            1) Descargá la plantilla. 2) Pegá ahí las columnas del export de AFIP (&quot;Mis Comprobantes&quot;), sin cambiar el orden. 3) Subí ese mismo archivo acá.
            Reimportar el mismo comprobante lo actualiza, no lo duplica.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/afip/plantilla"
              className="px-3 py-1.5 rounded-full text-sm font-medium border border-[#ece6d8] bg-white text-[#1c1811] hover:bg-[#f3efe4] transition"
            >
              ⬇ Descargar plantilla
            </a>
            <input
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <button
              onClick={importar}
              disabled={importando || !archivo}
              className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#7D4E5B] text-white hover:bg-[#9F6375] transition disabled:opacity-50"
            >
              {importando ? "Importando…" : "Importar"}
            </button>
          </div>
          {resultadoImport && <p className="text-[12px] text-[#1c1811] mt-2">{resultadoImport}</p>}
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
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Fecha</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Tipo</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Punto de Venta</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Número Desde</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Número Hasta</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Cód. Autorización</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Tipo Doc. Receptor</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Nro. Doc. Receptor</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Denominación Receptor</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Tipo Cambio</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Moneda</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Imp. Neto Gravado</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Imp. Neto No Gravado</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Imp. Op. Exentas</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Otros Tributos</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">IVA</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Imp. Total</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Periodo</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">¿Crédito?</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Monto</th>
                <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342] whitespace-nowrap">Valor doc</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={20} className="py-12 text-center text-[#847c68]">Sin comprobantes cargados para este período</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.fecha}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.tipo}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.punto_venta}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{r.numero_desde}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{r.numero_hasta}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.cod_autorizacion}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.tipo_doc_receptor}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.nro_doc_receptor}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{nombrePropio(r.denominacion_receptor)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.tipo_cambio)}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.moneda}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.imp_neto_gravado)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.imp_neto_no_gravado)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.imp_op_exentas)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.otros_tributos)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.iva)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.imp_total)}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.periodo}</td>
                  <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{r.credito}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmtMonto(r.monto)}</td>
                  <td className={`py-1.5 px-3 text-right tabular-nums whitespace-nowrap ${r.valor_doc < 0 ? "text-red-600" : ""}`}>{fmtMonto(r.valor_doc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface FilaFaltante {
  fecha: string; tipo: string; punto_venta: string; numero: string;
  cod_autorizacion: string; monto_neto: number;
}
interface FilaCruce { moneda: string; afip: number; api: number; diferencia: number; ok: boolean }
interface FilaCrucePeriodo extends FilaCruce { periodo: string }
interface DataCruce {
  tiene_datos_afip: boolean; detalle: FilaCruce[]; detalle_por_periodo: FilaCrucePeriodo[];
  comprobantes_afip: number; comprobantes_sin_match: number; faltantes: FilaFaltante[];
}

// Implementado 2026-10-07 tras una investigación extensa de reconciliación
// (ver ARQUITECTURA.md) -- bajada día a día de ig_ventas + dedupe global +
// join por CAE con fallback PV+número. Mismo patrón que el Cruce AFIP real
// de chakana-ventas: total acumulado de TODO lo cargado + desglose por
// período debajo (no un selector de un solo mes a la vez, pedido explícito
// de Ezequiel tras mostrar esa pantalla como referencia).
function CruceAfip() {
  const [data, setData] = useState<DataCruce | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/afip/cruce`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el Cruce AFIP");
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1c1811]">Cruce AFIP</h3>
        <p className="text-[11px] text-[#847c68] mt-0.5">
          Compara, por moneda, la suma de Info AFIP contra las ventas reales de <code>ig_ventas</code>, acumulado en todo lo cargado — join por CAE (código de autorización).
        </p>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading || !data ? (
        <div className="h-40 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : !data.tiene_datos_afip ? (
        <p className="text-sm text-[#c9772c] py-8 text-center">Falta cargar Info AFIP (pestaña Info AFIP).</p>
      ) : (
        <div className="space-y-5">
          <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f7f5f0]">
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Moneda</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">AFIP</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">API (ig_ventas)</th>
                  <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Diferencia</th>
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.detalle.map((f) => (
                  <tr key={f.moneda} className="border-t border-[#f3efe4]">
                    <td className="py-1.5 px-3 text-[#1c1811]">{f.moneda}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtMonto(f.afip)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtMonto(f.api)}</td>
                    <td className={`py-1.5 px-3 text-right tabular-nums ${!f.ok ? "text-red-600 font-semibold" : ""}`}>{fmtMonto(f.diferencia)}</td>
                    <td className="py-1.5 px-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${f.ok ? "bg-[#f2f9f2] text-[#3a9a5c]" : "bg-[#fdf3ea] text-[#c9772c]"}`}>
                        {f.ok ? "Al día" : "Diferencia"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="text-[12px] font-semibold text-[#5a5342] mb-2">Desglose por período</h4>
            <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f7f5f0]">
                    <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Período</th>
                    <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Moneda</th>
                    <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">AFIP</th>
                    <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">API (ig_ventas)</th>
                    <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Diferencia</th>
                    <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.detalle_por_periodo.map((f) => (
                    <tr key={`${f.periodo}::${f.moneda}`} className="border-t border-[#f3efe4]">
                      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{f.periodo}</td>
                      <td className="py-1.5 px-3 text-[#1c1811]">{f.moneda}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtMonto(f.afip)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{fmtMonto(f.api)}</td>
                      <td className={`py-1.5 px-3 text-right tabular-nums ${!f.ok ? "text-red-600 font-semibold" : ""}`}>{fmtMonto(f.diferencia)}</td>
                      <td className="py-1.5 px-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${f.ok ? "bg-[#f2f9f2] text-[#3a9a5c]" : "bg-[#fdf3ea] text-[#c9772c]"}`}>
                          {f.ok ? "Al día" : "Diferencia"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[12px] text-[#847c68]">
            {data.comprobantes_afip} comprobantes en Info AFIP, {data.comprobantes_sin_match} sin match por CAE.
          </p>

          {data.faltantes.length > 0 && (
            <div>
              <h4 className="text-[12px] font-semibold text-[#5a5342] mb-2">Comprobantes sin match (primeros {data.faltantes.length})</h4>
              <div className="overflow-x-auto rounded-md border border-[#ece6d8]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#f7f5f0]">
                      <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Fecha</th>
                      <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Tipo</th>
                      <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">PV</th>
                      <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Número</th>
                      <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">CAE</th>
                      <th className="py-2 px-3 text-right text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.faltantes.map((f, i) => (
                      <tr key={i} className="border-t border-[#f3efe4]">
                        <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{f.fecha}</td>
                        <td className="py-1.5 px-3 text-[#1c1811]">{f.tipo}</td>
                        <td className="py-1.5 px-3 text-[#1c1811]">{f.punto_venta}</td>
                        <td className="py-1.5 px-3 text-[#1c1811]">{f.numero}</td>
                        <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{f.cod_autorizacion}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{fmtMonto(f.monto_neto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SUB_TABS = [
  { key: "cruce", label: "Cruce AFIP" },
  { key: "info", label: "Info AFIP" },
  { key: "jurisdiccion", label: "Ventas por Jurisdicción" },
] as const;

export default function CtrlAfipPage() {
  // "Cruce AFIP" abre primero al entrar a la hoja -- pedido explícito de
  // Ezequiel 2026-10-07, antes arrancaba en "Info AFIP". Si llega
  // ?tab=info|jurisdiccion (ej. desde el botón "Corregir" de Controles,
  // 2026-10-08) abre esa sub-pestaña en su lugar.
  const [sub, setSub] = useState<(typeof SUB_TABS)[number]["key"]>("cruce");
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "info" || tab === "jurisdiccion" || tab === "cruce") setSub(tab);
  }, []);

  return (
    <AppShell current="/ctrl-afip/" title="Ctrl AFIP">
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

      {sub === "info" && <InfoAfip />}
      {sub === "cruce" && <CruceAfip />}
      {sub === "jurisdiccion" && <VentasPorJurisdiccion />}
    </AppShell>
  );
}
