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

// SNAP -> Sales by Line of Business (2026-10-19, pedido explícito de
// Ezequiel: "configurar desde datos maestros que se expone en cada linea
// del snap"). Clasifica combinaciones de centro_costo/categoria/
// canal_venta de ig_ventas a una línea nombrada de "Direct-to-consumer
// Channel" -- ver backend/snap.py para la jerarquía completa de totales.
// Un campo vacío = no filtra por ese campo. Combinaciones que no matchean
// ninguna regla caen en "Otro DTC/Hospitalidad" (se siguen sumando al
// total, solo sin nombre propio) -- se listan abajo para que el admin
// agregue la regla que falta.
interface FilaSnapMapa { id: number; centro_costo: string | null; categoria: string | null; canal_venta: string | null; linea_negocio: string }
interface ComboSinClasificar { centro_costo: string; categoria: string; canal_venta: string; filas: number }

// Líneas de negocio válidas para el campo "Línea de negocio" -- pedido
// explícito de Ezequiel 2026-11-02 ("no le queda claro a la gente como
// corregirlo... deberian ser un poco mas claros"): antes era un
// `<input>` de texto libre sin ninguna pista de qué escribir, así que
// quien corrige un control no sabe qué valores existen -- mismo
// conjunto cerrado que `DTC_LINEAS_FIJAS` en snap.py (backend), las
// únicas líneas que puede resolver una combinación de DTC/HOSPITALIDAD
// (Domestic/Export se deciden por `d_categoria` directo, no pasan por
// esta tabla). Si se agrega una línea nueva a futuro, agregarla acá Y en
// `DTC_LINEAS_FIJAS` de snap.py.
const LINEAS_NEGOCIO_VALIDAS = ["Employees", "E-commerce", "Colome Hotel", "Colome Visitor Center", "Cafayate Visitor Center"];

function SnapLineaNegocioMapa() {
  const [rows, setRows] = useState<FilaSnapMapa[]>([]);
  const [sinClasificar, setSinClasificar] = useState<{ desde: string; hasta: string; combos: ComboSinClasificar[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [form, setForm] = useState<{ centro_costo: string; categoria: string; canal_venta: string; linea_negocio: string }>({ centro_costo: "", categoria: "", canal_venta: "", linea_negocio: "" });
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [alta, setAlta] = useState({ centro_costo: "", categoria: "", canal_venta: "", linea_negocio: "" });
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
    Promise.all([
      fetch("/api/datos-maestros/snap-linea-negocio").then((r) => (r.ok ? r.json() : Promise.reject(new Error("Error cargando el mapa de línea de negocio")))),
      fetch("/api/datos-maestros/snap-linea-negocio/sin-clasificar").then((r) => (r.ok ? r.json() : Promise.reject(new Error("Error cargando combinaciones sin clasificar")))),
    ])
      .then(([mapa, sc]) => { setRows(mapa.rows); setSinClasificar(sc); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Deep-link desde Panel de Controles (pedido explícito 2026-10-19:
  // "desde controles debe poder resolverse cada problema" -- no alcanza
  // con linkear a la pestaña general, cada combinación puntual tiene que
  // abrir ya precargada). /datos-maestros/?tab=snap&cc=...&cat=...&cv=...
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("tab") !== "snap") return;
    if (!qs.has("cc") && !qs.has("cat") && !qs.has("cv")) return;
    setMostrarAlta(true);
    setAlta({
      centro_costo: qs.get("cc") || "",
      categoria: qs.get("cat") || "",
      canal_venta: qs.get("cv") || "",
      linea_negocio: "",
    });
  }, []);

  const startEdit = (r: FilaSnapMapa) => {
    setEditando(r.id);
    setForm({ centro_costo: r.centro_costo || "", categoria: r.categoria || "", canal_venta: r.canal_venta || "", linea_negocio: r.linea_negocio });
  };

  const guardar = async (id: number) => {
    const r = await fetch(`/api/datos-maestros/snap-linea-negocio/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { setEditando(null); load(); }
  };

  const eliminar = async (id: number, label: string) => {
    if (!window.confirm(`¿Eliminar la regla "${label}"?`)) return;
    const r = await fetch(`/api/datos-maestros/snap-linea-negocio/${id}`, { method: "DELETE" });
    if (r.ok) load();
  };

  const agregar = async () => {
    setErrorAlta(null);
    if (!alta.linea_negocio.trim() || !(alta.centro_costo.trim() || alta.categoria.trim() || alta.canal_venta.trim())) {
      setErrorAlta("Completá la línea de negocio y al menos un campo para matchear");
      return;
    }
    const r = await fetch("/api/datos-maestros/snap-linea-negocio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    if (r.ok) {
      setMostrarAlta(false);
      setAlta({ centro_costo: "", categoria: "", canal_venta: "", linea_negocio: "" });
      load();
    } else {
      const d = await r.json().catch(() => null);
      setErrorAlta(d?.detail || "Error al agregar");
    }
  };

  const precargarDesdeCombo = (c: ComboSinClasificar) => {
    setMostrarAlta(true);
    setAlta({ centro_costo: c.centro_costo, categoria: c.categoria, canal_venta: c.canal_venta, linea_negocio: "" });
  };

  return (
    <div className="bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1c1811]">SNAP — Línea de negocio</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Clasifica combinaciones de Centro de Costo/Categoría/Canal de Venta de <code>ig_ventas</code> a una línea del reporte Sales Performance (Direct-to-consumer Channel). Campo vacío = no filtra por ese campo.
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
            <label className="block text-[11px] text-[#847c68] mb-1">Centro de Costo</label>
            <input value={alta.centro_costo} onChange={(e) => setAlta((s) => ({ ...s, centro_costo: e.target.value }))} placeholder="ej. HOTEL COLOME" className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-44" />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Categoría</label>
            <input value={alta.categoria} onChange={(e) => setAlta((s) => ({ ...s, categoria: e.target.value }))} placeholder="ej. HOSPITALIDAD" className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-36" />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Canal de Venta</label>
            <input value={alta.canal_venta} onChange={(e) => setAlta((s) => ({ ...s, canal_venta: e.target.value }))} placeholder="ej. ECOMMERCE" className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-36" />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Línea de negocio</label>
            <select value={alta.linea_negocio} onChange={(e) => setAlta((s) => ({ ...s, linea_negocio: e.target.value }))} className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-44">
              <option value="">Elegir…</option>
              {LINEAS_NEGOCIO_VALIDAS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <button onClick={agregar} className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#7D4E5B] text-white hover:bg-[#9F6375] transition">Agregar</button>
          {errorAlta && <p className="text-red-600 text-xs w-full">{errorAlta}</p>}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? (
        <div className="h-64 rounded-md bg-[#f7f5f0] animate-pulse" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-[#ece6d8] mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f7f5f0]">
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Centro de Costo</th>
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Categoría</th>
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Canal de Venta</th>
                  <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Línea de negocio</th>
                  {puedeEditar && <th className="w-32" />}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={puedeEditar ? 5 : 4} className="py-12 text-center text-[#847c68]">No hay reglas cargadas</td></tr>
                ) : rows.map((r) => {
                  const isEditing = editando === r.id;
                  return (
                    <tr key={r.id} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">
                        {isEditing ? <input value={form.centro_costo} onChange={(e) => setForm((s) => ({ ...s, centro_costo: e.target.value }))} className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-40" /> : (r.centro_costo || <span className="text-[#a39a84]">—</span>)}
                      </td>
                      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">
                        {isEditing ? <input value={form.categoria} onChange={(e) => setForm((s) => ({ ...s, categoria: e.target.value }))} className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-32" /> : (r.categoria || <span className="text-[#a39a84]">—</span>)}
                      </td>
                      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">
                        {isEditing ? <input value={form.canal_venta} onChange={(e) => setForm((s) => ({ ...s, canal_venta: e.target.value }))} className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-32" /> : (r.canal_venta || <span className="text-[#a39a84]">—</span>)}
                      </td>
                      <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap font-medium">
                        {isEditing ? (
                          <select value={form.linea_negocio} onChange={(e) => setForm((s) => ({ ...s, linea_negocio: e.target.value }))} className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-40">
                            {LINEAS_NEGOCIO_VALIDAS.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                        ) : r.linea_negocio}
                      </td>
                      {puedeEditar && (
                        <td className="py-1.5 px-3 text-center whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <button onClick={() => guardar(r.id)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-2">Guardar</button>
                              <button onClick={() => setEditando(null)} className="text-[#847c68] hover:text-[#5a5342] text-xs">Cancelar</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(r)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-3">Editar</button>
                              <button onClick={() => eliminar(r.id, r.linea_negocio)} className="text-[#b8860b] hover:text-[#8a6a1f] text-xs">Eliminar</button>
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

          {sinClasificar && sinClasificar.combos.length > 0 && (
            <div className="rounded-md border border-[#f0ddb8] bg-[#fdf3ea] p-4">
              <p className="text-[12px] font-medium text-[#5a5342] mb-2">
                Combinaciones sin clasificar ({sinClasificar.desde} a {sinClasificar.hasta}) — hoy caen en &quot;Otro DTC/Hospitalidad&quot;, se suman al total igual, solo sin nombre propio:
              </p>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[#847c68] uppercase tracking-wide text-[10px]">
                    <th className="text-left py-1">Centro de Costo</th>
                    <th className="text-left py-1">Categoría</th>
                    <th className="text-left py-1">Canal de Venta</th>
                    <th className="text-right py-1">Filas</th>
                    {puedeEditar && <th className="w-20" />}
                  </tr>
                </thead>
                <tbody>
                  {sinClasificar.combos.map((c, i) => (
                    <tr key={i} className="border-t border-[#f0ddb8]">
                      <td className="py-1.5">{c.centro_costo || "—"}</td>
                      <td className="py-1.5">{c.categoria || "—"}</td>
                      <td className="py-1.5">{c.canal_venta || "—"}</td>
                      <td className="py-1.5 text-right">{c.filas}</td>
                      {puedeEditar && (
                        <td className="py-1.5 text-right">
                          <button onClick={() => precargarDesdeCombo(c)} className="text-[11px] text-[#7D4E5B] hover:text-[#9F6375] underline">Clasificar</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Panel de Ventas -> filtro previo "Agrupante de Canal" (2026-10-21, pedido
// explícito de Ariel Culasso vía Ezequiel: "agrupemos en un filtro previo...
// esa asociación de agrupantes, tiene que estar en datos maestros y
// controles"). Catálogo fijo 1 canal_venta -> 1 agrupante, mismo patrón que
// JurisdiccionMapa. Usado por el frontend de Panel de Ventas (app.js) para
// tildar de una el conjunto de canales de un agrupante, SIN reemplazar el
// filtro de Canal existente -- ver backend/panel_ventas.py y controles.py
// (control "Canales sin agrupante").
interface FilaCanalAgrupante { canal_venta: string; agrupante: string }

function CanalAgrupanteMapa() {
  const [rows, setRows] = useState<FilaCanalAgrupante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<{ agrupante: string }>({ agrupante: "" });
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [alta, setAlta] = useState<{ canal_venta: string; agrupante: string }>({ canal_venta: "", agrupante: "" });
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
    fetch("/api/datos-maestros/canal-agrupante")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el mapa de Agrupante de Canal");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const startEdit = (r: FilaCanalAgrupante) => {
    setEditando(r.canal_venta);
    setForm({ agrupante: r.agrupante });
  };

  const guardar = async (canal_venta: string) => {
    const r = await fetch(`/api/datos-maestros/canal-agrupante/${encodeURIComponent(canal_venta)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { setEditando(null); load(); }
  };

  const eliminar = async (canal_venta: string) => {
    if (!window.confirm(`¿Eliminar "${canal_venta}" del catálogo de Agrupante de Canal?`)) return;
    const r = await fetch(`/api/datos-maestros/canal-agrupante/${encodeURIComponent(canal_venta)}`, { method: "DELETE" });
    if (r.ok) load();
  };

  const agregar = async () => {
    setErrorAlta(null);
    if (!alta.canal_venta.trim() || !alta.agrupante.trim()) {
      setErrorAlta("Completá canal y agrupante");
      return;
    }
    const r = await fetch("/api/datos-maestros/canal-agrupante", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    if (r.ok) {
      setMostrarAlta(false);
      setAlta({ canal_venta: "", agrupante: "" });
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
          <h3 className="text-sm font-semibold text-[#1c1811]">Agrupante de Canal</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Agrupa cada valor de Canal de Venta de <code>ig_ventas</code> en un agrupante previo (ej. Vinotecas, Distribuidores). Usado como filtro de conveniencia en Panel de Ventas / Ventas por Región -- el filtro de Canal detallado sigue existiendo igual.
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
            <label className="block text-[11px] text-[#847c68] mb-1">Canal de Venta (ig_ventas)</label>
            <input
              value={alta.canal_venta}
              onChange={(e) => setAlta((s) => ({ ...s, canal_venta: e.target.value }))}
              placeholder="ej. VINOTECAS"
              className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-48"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Agrupante</label>
            <input
              value={alta.agrupante}
              onChange={(e) => setAlta((s) => ({ ...s, agrupante: e.target.value }))}
              placeholder="ej. Vinotecas"
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
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Canal de Venta</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Agrupante</th>
                {puedeEditar && <th className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 3 : 2} className="py-12 text-center text-[#847c68]">No hay filas cargadas</td></tr>
              ) : rows.map((r) => {
                const isEditing = editando === r.canal_venta;
                return (
                  <tr key={r.canal_venta} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{nombrePropio(r.canal_venta)}</td>
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={form.agrupante}
                          onChange={(e) => setForm((s) => ({ ...s, agrupante: e.target.value }))}
                          className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-40"
                        />
                      ) : (
                        r.agrupante
                      )}
                    </td>
                    {puedeEditar && (
                      <td className="py-1.5 px-3 text-center whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button onClick={() => guardar(r.canal_venta)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-2">Guardar</button>
                            <button onClick={() => setEditando(null)} className="text-[#847c68] hover:text-[#5a5342] text-xs">Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(r)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-3">Editar</button>
                            <button onClick={() => eliminar(r.canal_venta)} className="text-[#b8860b] hover:text-[#8a6a1f] text-xs">Eliminar</button>
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

// Panel de Ventas -> filtro previo "Agrupante de Marca" (2026-11-03, pedido
// explícito de Ezequiel: "vienen pre filtradas todas las marcas menos
// familia del monte... generar una categoria y filtro previo como hicimos
// con canal donde esten: Colome & Amalaya y Familia del monte"). Catálogo
// fijo 1 brand -> 1 agrupante sobre los 5 valores crudos de Brand (d_rubro,
// universo GRUPO_VALIDO), mismo patrón que CanalAgrupanteMapa -- ver
// backend/panel_ventas.py (dims.brand_agrupante).
interface FilaMarcaAgrupante { brand: string; agrupante: string }

function MarcaAgrupanteMapa() {
  const [rows, setRows] = useState<FilaMarcaAgrupante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<{ agrupante: string }>({ agrupante: "" });
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [alta, setAlta] = useState<{ brand: string; agrupante: string }>({ brand: "", agrupante: "" });
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
    fetch("/api/datos-maestros/marca-agrupante")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el mapa de Agrupante de Marca");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const startEdit = (r: FilaMarcaAgrupante) => {
    setEditando(r.brand);
    setForm({ agrupante: r.agrupante });
  };

  const guardar = async (brand: string) => {
    const r = await fetch(`/api/datos-maestros/marca-agrupante/${encodeURIComponent(brand)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { setEditando(null); load(); }
  };

  const eliminar = async (brand: string) => {
    if (!window.confirm(`¿Eliminar "${brand}" del catálogo de Agrupante de Marca?`)) return;
    const r = await fetch(`/api/datos-maestros/marca-agrupante/${encodeURIComponent(brand)}`, { method: "DELETE" });
    if (r.ok) load();
  };

  const agregar = async () => {
    setErrorAlta(null);
    if (!alta.brand.trim() || !alta.agrupante.trim()) {
      setErrorAlta("Completá marca y agrupante");
      return;
    }
    const r = await fetch("/api/datos-maestros/marca-agrupante", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    if (r.ok) {
      setMostrarAlta(false);
      setAlta({ brand: "", agrupante: "" });
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
          <h3 className="text-sm font-semibold text-[#1c1811]">Agrupante de Marca</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Agrupa cada valor de Brand de <code>ig_ventas</code> en un agrupante previo (Colomé &amp; Amalaya, Familia del Monte). Usado como filtro de conveniencia en Panel de Ventas / Ventas por Región -- el filtro de Brand detallado sigue existiendo igual.
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
            <label className="block text-[11px] text-[#847c68] mb-1">Brand (ig_ventas)</label>
            <input
              value={alta.brand}
              onChange={(e) => setAlta((s) => ({ ...s, brand: e.target.value }))}
              placeholder="ej. COLOME **"
              className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-48"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Agrupante</label>
            <input
              value={alta.agrupante}
              onChange={(e) => setAlta((s) => ({ ...s, agrupante: e.target.value }))}
              placeholder="ej. Colomé &amp; Amalaya"
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
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Brand</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Agrupante</th>
                {puedeEditar && <th className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 3 : 2} className="py-12 text-center text-[#847c68]">No hay filas cargadas</td></tr>
              ) : rows.map((r) => {
                const isEditing = editando === r.brand;
                return (
                  <tr key={r.brand} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{nombrePropio(r.brand)}</td>
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={form.agrupante}
                          onChange={(e) => setForm((s) => ({ ...s, agrupante: e.target.value }))}
                          className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-40"
                        />
                      ) : (
                        r.agrupante
                      )}
                    </td>
                    {puedeEditar && (
                      <td className="py-1.5 px-3 text-center whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button onClick={() => guardar(r.brand)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-2">Guardar</button>
                            <button onClick={() => setEditando(null)} className="text-[#847c68] hover:text-[#5a5342] text-xs">Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(r)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-3">Editar</button>
                            <button onClick={() => eliminar(r.brand)} className="text-[#b8860b] hover:text-[#8a6a1f] text-xs">Eliminar</button>
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

// Panel de Ventas -> filtro previo "Agrupante de Región" (2026-11-03,
// pedido explícito de Ezequiel: "las regiones no estan diagramadas y
// configuradas mediante datos maestros"). Catálogo fijo 1 zona_comercial
// -> 1 agrupante sobre los 11 valores crudos de zona (d_zona_comercial),
// mismo patrón que CanalAgrupanteMapa/MarcaAgrupanteMapa -- ver
// backend/panel_ventas.py (dims.zona_agrupante).
interface FilaRegionAgrupante { zona_comercial: string; agrupante: string }

function RegionAgrupanteMapa() {
  const [rows, setRows] = useState<FilaRegionAgrupante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<{ agrupante: string }>({ agrupante: "" });
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [alta, setAlta] = useState<{ zona_comercial: string; agrupante: string }>({ zona_comercial: "", agrupante: "" });
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
    fetch("/api/datos-maestros/region-agrupante")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el mapa de Agrupante de Región");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const startEdit = (r: FilaRegionAgrupante) => {
    setEditando(r.zona_comercial);
    setForm({ agrupante: r.agrupante });
  };

  const guardar = async (zona_comercial: string) => {
    const r = await fetch(`/api/datos-maestros/region-agrupante/${encodeURIComponent(zona_comercial)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { setEditando(null); load(); }
  };

  const eliminar = async (zona_comercial: string) => {
    if (!window.confirm(`¿Eliminar "${zona_comercial}" del catálogo de Agrupante de Región?`)) return;
    const r = await fetch(`/api/datos-maestros/region-agrupante/${encodeURIComponent(zona_comercial)}`, { method: "DELETE" });
    if (r.ok) load();
  };

  const agregar = async () => {
    setErrorAlta(null);
    if (!alta.zona_comercial.trim() || !alta.agrupante.trim()) {
      setErrorAlta("Completá zona y agrupante");
      return;
    }
    const r = await fetch("/api/datos-maestros/region-agrupante", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    if (r.ok) {
      setMostrarAlta(false);
      setAlta({ zona_comercial: "", agrupante: "" });
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
          <h3 className="text-sm font-semibold text-[#1c1811]">Agrupante de Región</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Agrupa cada valor de Región de <code>ig_ventas</code> (zona comercial) en un agrupante previo (Doméstico, Exportación). Usado como filtro de conveniencia en Panel de Ventas / Ventas por Región -- el filtro de Región detallado sigue existiendo igual.
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
            <label className="block text-[11px] text-[#847c68] mb-1">Zona Comercial (ig_ventas)</label>
            <input
              value={alta.zona_comercial}
              onChange={(e) => setAlta((s) => ({ ...s, zona_comercial: e.target.value }))}
              placeholder="ej. ASIA"
              className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-48"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Agrupante</label>
            <input
              value={alta.agrupante}
              onChange={(e) => setAlta((s) => ({ ...s, agrupante: e.target.value }))}
              placeholder="ej. Exportación"
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
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Zona Comercial</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Agrupante</th>
                {puedeEditar && <th className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 3 : 2} className="py-12 text-center text-[#847c68]">No hay filas cargadas</td></tr>
              ) : rows.map((r) => {
                const isEditing = editando === r.zona_comercial;
                return (
                  <tr key={r.zona_comercial} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{nombrePropio(r.zona_comercial)}</td>
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={form.agrupante}
                          onChange={(e) => setForm((s) => ({ ...s, agrupante: e.target.value }))}
                          className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-40"
                        />
                      ) : (
                        r.agrupante
                      )}
                    </td>
                    {puedeEditar && (
                      <td className="py-1.5 px-3 text-center whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button onClick={() => guardar(r.zona_comercial)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-2">Guardar</button>
                            <button onClick={() => setEditando(null)} className="text-[#847c68] hover:text-[#5a5342] text-xs">Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(r)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-3">Editar</button>
                            <button onClick={() => eliminar(r.zona_comercial)} className="text-[#b8860b] hover:text-[#8a6a1f] text-xs">Eliminar</button>
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

// País -> Región: pedido explícito de Ezequiel 2026-11-03 ("quiero que
// crees una tabla en datos maestros que sea la regla para esta hoja [que
// Alemania entra en EUROPE]... si ariel culasso quiere hacer un cambio de
// region en un pais lo va a poder editar desde datos maestros"). A
// diferencia de Agrupante de Región (agrupa zonas ya asignadas por
// Redline), esta tabla REEMPLAZA esa asignación -- ver backend/ig_ventas.py
// (facts_panel_ventas con pais_zona_override). Argentina no aparece acá a
// propósito (desglose doméstico interno, 4 zonas, no 1 sola).
interface FilaPaisZona { pais: string; zona: string }

function PaisZonaMapa() {
  const [rows, setRows] = useState<FilaPaisZona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<{ zona: string }>({ zona: "" });
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [alta, setAlta] = useState<{ pais: string; zona: string }>({ pais: "", zona: "" });
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
    fetch("/api/datos-maestros/pais-zona")
      .then((r) => {
        if (r.status === 401) { window.location.href = "/"; return null; }
        if (!r.ok) throw new Error("Error cargando el mapa de País → Región");
        return r.json();
      })
      .then((d) => { if (d) setRows(d.rows); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const startEdit = (r: FilaPaisZona) => {
    setEditando(r.pais);
    setForm({ zona: r.zona });
  };

  const guardar = async (pais: string) => {
    const r = await fetch(`/api/datos-maestros/pais-zona/${encodeURIComponent(pais)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { setEditando(null); load(); }
  };

  const eliminar = async (pais: string) => {
    if (!window.confirm(`¿Eliminar "${pais}" del catálogo de País → Región? (vuelve a tomar la zona cruda del ERP)`)) return;
    const r = await fetch(`/api/datos-maestros/pais-zona/${encodeURIComponent(pais)}`, { method: "DELETE" });
    if (r.ok) load();
  };

  const agregar = async () => {
    setErrorAlta(null);
    if (!alta.pais.trim() || !alta.zona.trim()) {
      setErrorAlta("Completá país y región");
      return;
    }
    const r = await fetch("/api/datos-maestros/pais-zona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alta),
    });
    if (r.ok) {
      setMostrarAlta(false);
      setAlta({ pais: "", zona: "" });
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
          <h3 className="text-sm font-semibold text-[#1c1811]">País → Región</h3>
          <p className="text-[11px] text-[#847c68] mt-0.5">
            Regla real de qué Región (zona comercial) le corresponde a cada país -- hoy viene 100% cruda del ERP (ej. Alemania → EUROPE). Editar acá reemplaza esa asignación en Panel de Ventas / Ventas por Región. Argentina no aparece (desglose doméstico interno: DTC/Buenos Aires/NOA/Interior).
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
            <label className="block text-[11px] text-[#847c68] mb-1">País (ig_ventas)</label>
            <input
              value={alta.pais}
              onChange={(e) => setAlta((s) => ({ ...s, pais: e.target.value }))}
              placeholder="ej. ALEMANIA"
              className="px-2 py-1.5 rounded-md border border-[#ece6d8] text-sm w-48"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#847c68] mb-1">Región</label>
            <input
              value={alta.zona}
              onChange={(e) => setAlta((s) => ({ ...s, zona: e.target.value }))}
              placeholder="ej. EUROPE"
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
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">País</th>
                <th className="py-2 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-[#5a5342]">Región</th>
                {puedeEditar && <th className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 3 : 2} className="py-12 text-center text-[#847c68]">No hay filas cargadas</td></tr>
              ) : rows.map((r) => {
                const isEditing = editando === r.pais;
                return (
                  <tr key={r.pais} className="border-t border-[#f3efe4] hover:bg-[#f7f5f0]">
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">{nombrePropio(r.pais)}</td>
                    <td className="py-1.5 px-3 text-[#1c1811] whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={form.zona}
                          onChange={(e) => setForm((s) => ({ ...s, zona: e.target.value }))}
                          className="px-1.5 py-1 rounded border border-[#d9b38c] text-sm w-40"
                        />
                      ) : (
                        r.zona
                      )}
                    </td>
                    {puedeEditar && (
                      <td className="py-1.5 px-3 text-center whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button onClick={() => guardar(r.pais)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-2">Guardar</button>
                            <button onClick={() => setEditando(null)} className="text-[#847c68] hover:text-[#5a5342] text-xs">Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(r)} className="text-[#7D4E5B] hover:text-[#9F6375] text-xs mr-3">Editar</button>
                            <button onClick={() => eliminar(r.pais)} className="text-[#b8860b] hover:text-[#8a6a1f] text-xs">Eliminar</button>
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

const SUB_TABS = [
  { key: "jurisdiccion", label: "Jurisdicción" },
  { key: "snap", label: "SNAP — Línea de negocio" },
  { key: "canal", label: "Agrupante de Canal" },
  { key: "marca", label: "Agrupante de Marca" },
  { key: "region", label: "Agrupante de Región" },
  { key: "pais-zona", label: "País → Región" },
] as const;

export default function DatosMaestrosPage() {
  // Pestañas separadas (pedido explícito 2026-10-19: "SNAP — Línea de
  // negocio tiene que ser otra pestaña en datos maestros") -- mismo patrón
  // que Ctrl AFIP (SUB_TABS + ?tab= para deep-linking, ej. desde el botón
  // "Ir a clasificar" de Controles). Antes eran 2 secciones apiladas en una
  // sola página larga.
  const [sub, setSub] = useState<(typeof SUB_TABS)[number]["key"]>("jurisdiccion");
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "jurisdiccion" || tab === "snap" || tab === "canal" || tab === "marca" || tab === "region" || tab === "pais-zona") setSub(tab);
  }, []);

  return (
    <AppShell current="/datos-maestros/" title="Datos Maestros">
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

      {sub === "jurisdiccion" && <JurisdiccionMapa />}
      {sub === "snap" && <SnapLineaNegocioMapa />}
      {sub === "canal" && <CanalAgrupanteMapa />}
      {sub === "marca" && <MarcaAgrupanteMapa />}
      {sub === "region" && <RegionAgrupanteMapa />}
      {sub === "pais-zona" && <PaisZonaMapa />}
    </AppShell>
  );
}
