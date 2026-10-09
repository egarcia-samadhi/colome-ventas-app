"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

// Hoja Auditoría (2026-10-09) -- patrón replicable (regla de oro #33, ver
// memoria feedback_patron_pantalla_auditoria_linea_a_linea.md): pantalla
// admin-only, solo 2 inputs de fecha (rango libre) + botón "Descargar
// Excel", sin grilla en pantalla -- el objetivo es el archivo para respaldar
// cualquier número de cualquier pantalla, línea por línea, no una vista.
const hoyISO = () => new Date().toISOString().slice(0, 10);
const DESDE_HISTORICO = "2025-09-01";

export default function AuditoriaPage() {
  const [role, setRole] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [desde, setDesde] = useState(DESDE_HISTORICO);
  const [hasta, setHasta] = useState(hoyISO());

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRole(d.role))
      .catch(() => setRole(null))
      .finally(() => setChecked(true));
  }, []);

  const descargar = () => {
    window.location.href = `/api/auditoria/export?desde=${desde}&hasta=${hasta}`;
  };

  return (
    <AppShell current="/auditoria/" title="Auditoría">
      <div className="border border-[#ece6d8] rounded-md p-5 bg-white max-w-xl">
        <h2 className="text-base font-semibold text-[#1c1811] mb-1">Descarga línea a línea</h2>
        <p className="text-[11px] text-[#847c68] mb-4">
          Exporta el 100% de las líneas de ig_ventas del rango elegido, sin ningún filtro de alcance de los que sí aplican las pantallas operativas (incluye todo tipo de comprobante y todo grupo, no solo &quot;Ventas&quot;) -- respalda cualquier número de cualquier pantalla del sistema.
        </p>

        {!checked ? (
          <div className="h-16 w-full rounded-md bg-[#f7f5f0] animate-pulse" />
        ) : role !== "admin" ? (
          <p className="text-[#b8860b] text-sm">Esta sección es solo para administradores.</p>
        ) : (
          <>
            <div className="flex items-end gap-3 mb-4">
              <div>
                <label className="block text-[11px] text-[#847c68] mb-1">Desde</label>
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  className="border border-[#ece6d8] rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#847c68] mb-1">Hasta</label>
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                  className="border border-[#ece6d8] rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <button
              onClick={descargar}
              disabled={!desde || !hasta || hasta < desde}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-[#7D4E5B] text-white hover:bg-[#9F6375] transition disabled:opacity-50"
            >
              Descargar Excel
            </button>
          </>
        )}
      </div>
    </AppShell>
  );
}
