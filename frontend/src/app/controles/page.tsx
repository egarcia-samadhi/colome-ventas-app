"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

// Panel de Controles (2026-10-08) -- pedido explícito de Ezequiel: "igual
// que en chakana-ventas necesito que en la hoja de controles se informe, si
// el control de afip no da, y si hay jurisdicciones sin clasificar", y
// después: "en cada uno de los controles se tiene que poder hacer la acción
// correctiva desde allí". Mismo patrón visual que Proviva - Ventas
// Chakana/frontend/src/app/controles (semáforo + items + botón "Corregir"),
// acotado a los 2 únicos chequeos que hoy aplican a Colomé (ver
// backend/controles.py) -- paleta dorado/bordó de Colomé en vez de navy.
//
// Acción correctiva por control:
// - cruce_afip: no es un alta de fila (como en Chakana) -- el fix real es
//   cargar/revisar Info AFIP, así que el botón lleva directo a esa
//   sub-pestaña de Ctrl AFIP (?tab=info), no abre un modal acá.
// - jurisdiccion_sin_clasificar: sí es un alta de fila en Datos Maestros →
//   Jurisdicción -- el botón abre un modal mínimo (mismo endpoint POST que
//   datos-maestros/page.tsx) con el valor ya precargado, para no tener que
//   copiarlo a mano.
interface Item { valor: string; filas: number }
interface Control {
  id: string;
  label: string;
  descripcion?: string;
  ok: boolean;
  detalle?: string;
  cantidad?: number;
  items?: Item[];
}
interface ControlesData { desde: string; hasta: string; controles: Control[] }

const fmtFecha = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function CorregirJurisdiccionModal({ valorApi, onClose, onSaved }: { valorApi: string; onClose: () => void; onSaved: () => void }) {
  const [tipo, setTipo] = useState<"Provincia" | "Exterior">("Exterior");
  const [concepto, setConcepto] = useState(tipo === "Exterior" ? "Exterior" : valorApi);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    const r = await fetch("/api/datos-maestros/jurisdiccion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valor_api: valorApi, tipo, concepto }),
    });
    setGuardando(false);
    if (r.ok) { onSaved(); onClose(); } else {
      const d = await r.json().catch(() => null);
      setError(d?.detail || "No se pudo guardar");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-md p-5 w-[420px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[#1c1811] mb-3">Clasificar &quot;{valorApi}&quot;</h3>
        <label className="block text-[11px] text-[#847c68] mb-1">Tipo</label>
        <select
          value={tipo}
          onChange={(e) => {
            const t = e.target.value as "Provincia" | "Exterior";
            setTipo(t);
            setConcepto(t === "Exterior" ? "Exterior" : valorApi);
          }}
          className="w-full border border-[#ece6d8] rounded px-2 py-1.5 text-sm mb-3"
        >
          <option value="Exterior">Exterior</option>
          <option value="Provincia">Provincia</option>
        </select>
        <label className="block text-[11px] text-[#847c68] mb-1">Concepto</label>
        <input
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          className="w-full border border-[#ece6d8] rounded px-2 py-1.5 text-sm mb-3"
        />
        {error && <p className="text-[11px] text-[#c9772c] mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-[11px] text-[#847c68] hover:text-[#5a5342] px-3 py-1.5">Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando || !concepto.trim()}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#7D4E5B] text-white hover:bg-[#9F6375] transition disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ControlesPage() {
  const [data, setData] = useState<ControlesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/controles")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (r.status === 403) { setError("Esta sección es solo para administradores."); return null; }
        if (!r.ok) throw new Error("Error cargando Controles");
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <AppShell current="/controles/" title="Controles">
      <div className="border border-[#ece6d8] rounded-md p-5 bg-white">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-[#1c1811]">Completitud de datos</h2>
          <button onClick={load} className="text-[11px] text-[#7D4E5B] hover:text-[#9F6375] underline">
            Actualizar
          </button>
        </div>
        <p className="text-[11px] text-[#847c68] mb-4">
          Chequeos de completitud de datos, desde el {data ? fmtFecha(data.desde) : "…"} hasta el {data ? fmtFecha(data.hasta) : "…"} — no son bugs de código, son huecos de datos a cargar. Cada control explica su propio alcance al expandirlo.
        </p>

        {loading ? (
          <div className="h-40 w-full rounded-md bg-[#f7f5f0] animate-pulse" />
        ) : error ? (
          <p className="text-[#b8860b] text-sm">{error}</p>
        ) : !data ? (
          <p className="text-[#847c68] text-sm">No se pudo cargar.</p>
        ) : (
          <div className="space-y-2">
            {data.controles.map((c) => (
              <div key={c.id} className="rounded-md border border-[#ece6d8] overflow-hidden">
                <button
                  onClick={() => setExpandido(expandido === c.id ? null : c.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left transition ${
                    c.ok ? "bg-[#f2f9f2] hover:bg-[#e8f4e8]" : "bg-[#fdf3ea] hover:bg-[#fbe9d9]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${c.ok ? "bg-[#3a9a5c]" : "bg-[#c9772c]"}`} />
                    <span className="text-sm font-medium text-[#1c1811]">{c.label}</span>
                  </div>
                  <span className={`text-[12px] font-medium ${c.ok ? "text-[#3a9a5c]" : "text-[#c9772c]"}`}>
                    {c.ok ? "Al día" : c.detalle || `${c.cantidad} faltante${c.cantidad === 1 ? "" : "s"}`}
                  </span>
                </button>
                {expandido === c.id && (
                  <div className="px-4 py-3 border-t border-[#f3efe4] bg-white">
                    {c.descripcion && (
                      <p className="text-[11px] text-[#847c68] mb-3">{c.descripcion}</p>
                    )}

                    {c.id === "cruce_afip" && !c.ok && (
                      <a
                        href="/ctrl-afip/?tab=info"
                        className="inline-block text-[11px] text-[#7D4E5B] hover:text-[#9F6375] underline mb-3"
                      >
                        Ir a cargar / revisar Info AFIP →
                      </a>
                    )}

                    {c.items && c.items.length > 0 && (
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-[#847c68] uppercase tracking-wide text-[10px]">
                            <th className="text-left py-1">Valor sin mapear</th>
                            <th className="text-right py-1">Filas afectadas</th>
                            {c.id === "jurisdiccion_sin_clasificar" && <th className="w-20" />}
                          </tr>
                        </thead>
                        <tbody>
                          {c.items.map((it) => (
                            <tr key={it.valor} className="border-t border-[#f3efe4]">
                              <td className="py-1.5 text-[#1c1811]">{it.valor}</td>
                              <td className="py-1.5 text-right text-[#847c68]">{it.filas}</td>
                              {c.id === "jurisdiccion_sin_clasificar" && (
                                <td className="py-1.5 text-right">
                                  <button
                                    onClick={() => setCorrigiendo(it.valor)}
                                    className="text-[11px] text-[#7D4E5B] hover:text-[#9F6375] underline"
                                  >
                                    Corregir
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {c.items && c.cantidad && c.cantidad > c.items.length && (
                      <p className="text-[11px] text-[#847c68] mt-2">…y {c.cantidad - c.items.length} más (se muestran los 15 con más filas afectadas).</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {corrigiendo && (
        <CorregirJurisdiccionModal
          valorApi={corrigiendo}
          onClose={() => setCorrigiendo(null)}
          onSaved={load}
        />
      )}
    </AppShell>
  );
}
