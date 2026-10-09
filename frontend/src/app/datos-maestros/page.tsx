"use client";
import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { nombrePropio } from "@/lib/nombrePropio";

// Datos Maestros -> Jurisdicción (2026-10-07, pedido explícito de Ezequiel:
// "la tabla debería llevar el campo [n_provincia de ig_ventas], a una
// provincia si es una provincia Argentina. y al campo exterior, si es un
// país" -- corregido el mismo día: "no, tiene que ser una base de datos
// fija y editable por el usuario"). Es un catálogo fijo, sembrado con las
// 24 provincias argentinas (backend/database.py), con alta/edición/baja a
// mano para el admin -- NO se auto-completa desde ig_ventas.
interface FilaMapa {
  valor_api: string;
  tipo: "Provincia" | "Exterior";
  concepto: string;
}

function JurisdiccionMapa() {
  const [rows, setRows] = useState<FilaMapa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<{ tipo: string; concepto: string }>({ tipo: "", concepto: "" });
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [alta, setAlta] = useState<{ valor_api: string; tipo: string; concepto: string }>({ valor_api: "", tipo: "Provincia", concepto: "" });
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setPuedeEditar(u?.role === "admin"))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/datos-maestros/jurisdiccion")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el mapa de Jurisdicción");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const startEdit = (r: FilaMapa) => {
    setEditando(r.valor_api);
    setForm({ tipo: r.tipo, concepto: r.concepto });
  };

  const guardar = async (valor_api: string) => {
    const r = await fetch(`/api/datos-maestros/jurisdiccion/${encodeURIComponent(valor_api)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { setEditando(null); load(); }
  };

  const eliminar = async (valor_api: string) => {
    if (!window.confirm(`¿Eliminar "${valor_api}" del catálogo de Jurisdicción?`)) return;
    const r = await fetch(`/api/datos-maestros/jurisdiccion/${encodeURIComponent(valor_api)}`, { method: "DELETE" });
    if (r.ok) load();
  };

  const agregar = async () => {
    setErrorAlta(null);
    if (!alta.valor_api.trim() || !alta.concepto.trim()) {
      setErrorAlta("Completá valor y concepto");
      return;
    }
    const r = await fetch("/api/datos-maestros/jurisdiccion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    if (r.ok) {
      setMostrarAlta(false);
      setAlta({ valor_api: "", tipo: "Provincia", concepto: "" });
      load();
    } else {
      const d = await r.json().catch(() => null);
      setErrorAlta(d?.detail || "Error al agregar");
    }
  };

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">Jurisdicción</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Catálogo fijo: cada valor de provincia/país que aparece en <code>ig_ventas</code> (hoja Ctrl AFIP → Ventas por Jurisdicción), clasificado como Provincia (Argentina) o Exterior. Se carga y edita a mano.
          </p>
        </div>
        {puedeEditar && (
          <button
            onClick={() => setMostrarAlta((v) => !v)}
            className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#7D4E5B] text-white hover:bg-[#9F6375] transition"
          >
            {mostrarAlta ? "Cerrar" : "+ Agregar"}
          </button>
        )}
      </div>

      {puedeEditar && mostrarAlta && (
        <div className="mb-4 p-4 rounded-md border border-[#ece6d8] bg-[#f7f5f0] flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Valor (ig_ventas)</label>
            <input
              value={alta.valor_api}
              onChange={(e) => setAlta((s) => ({ ...s, valor_api: e.target.value }))}
              placeholder="ej. SAO PAULO"
              className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-48"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Tipo</label>
            <select
              value={alta.tipo}
              onChange={(e) => setAlta((s) => ({ ...s, tipo: e.target.value }))}
              className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm bg-white"
            >
              <option value="Provincia">Provincia</option>
              <option value="Exterior">Exterior</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Concepto</label>
            <input
              value={alta.concepto}
              onChange={(e) => setAlta((s) => ({ ...s, concepto: e.target.value }))}
              placeholder="ej. Exterior"
              className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-40"
            />
          </div>
          <button
            onClick={agregar}
            className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#7D4E5B] text-white hover:bg-[#9F6375] transition"
          >
            Agregar
          </button>
          {errorAlta && <p className="text-red-600 text-xs w-full">{errorAlta}</p>}
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
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Valor (ig_ventas)</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Tipo</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Concepto</th>
                {puedeEditar && <th className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 4 : 3} className="py-12 text-center text-[#847c68]">No hay filas cargadas</td></tr>
              ) : rows.map((r) => {
                const isEditing = editando === r.valor_api;
                return (
                  <tr key={r.valor_api} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{nombrePropio(r.valor_api)}</td>
                    <td className="py-1.5 px-3 whitespace-nowrap">
                      {isEditing ? (
                        <select
                          value={form.tipo}
                          onChange={(e) => setForm((s) => ({ ...s, tipo: e.target.value }))}
                          className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm bg-white"
                        >
                          <option value="Provincia">Provincia</option>
                          <option value="Exterior">Exterior</option>
                        </select>
                      ) : (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${r.tipo === "Provincia" ? "bg-[#f2f9f2] text-[#3a9a5c]" : "bg-[#fdf3ea] text-[#c9772c]"}`}>
                          {r.tipo}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-[#1c1811]">
                      {isEditing ? (
                        <input
                          value={form.concepto}
                          onChange={(e) => setForm((s) => ({ ...s, concepto: e.target.value }))}
                          className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-40"
                        />
                      ) : (
                        nombrePropio(r.concepto)
                      )}
                    </td>
                    {puedeEditar && (
                      <td className="py-1.5 px-3 text-center whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button onClick={() => guardar(r.valor_api)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-2">Guardar</button>
                            <button onClick={() => setEditando(null)} className="text-[#847c68] hover:text-[#5a5342] text-xs">Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(r)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-3">Editar</button>
                            <button onClick={() => eliminar(r.valor_api)} className="text-[#b8860b] hover:text-[#8a6a1f] text-xs">Eliminar</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DatosMaestrosPage() {
  return (
    <AppShell current="/datos-maestros/" title="Datos Maestros">
      <div className="mt-6">
        <JurisdiccionMapa />
      </div>
    </AppShell>
  );
}
