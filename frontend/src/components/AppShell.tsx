"use client";
import { useEffect, useState } from "react";

// 2026-10-07 -- AppShell con la variante "Web App moderna" de Colomé (la que
// quedó aprobada para el proyecto: nav superior en pill flotante, tarjetas
// redondeadas 18px, sombras suaves -- ver fuentes-mock-app/estilo-colome-app.css
// ".tabs"/".kpi"/".card"). Corregido 2026-10-07 (mismo día, dos rondas):
// (1) la primera versión copió el patrón de pestañas "carpeta" de
// chakana-ventas -- corregido a pill flotante.
// (2) Ezequiel: "no entiendo porque [ctrl-afip] esta desconectada de [#snap],
// tienen que estar todas las hojas visibles" -- el nav colapsaba las 3 vistas
// de Ventas (mock estático) en un solo ítem "Ventas" que saltaba a una página
// distinta sin el resto de las pestañas. Igual que chakana-ventas (su NAV no
// agrupa "Ventas", cada vista -- Panel/Región/Summary/etc -- es su propio
// ítem plano), acá las 3 vistas del mock pasan a ser 3 ítems planos más,
// linkeando a "/#snap"/"/#panel"/"/#region" (el mock sigue siendo HTML
// estático, pero el nav que lo rodea ahora es idéntico y está siempre
// presente -- ver el mismo array de items espejado en
// fuentes-mock-app/shell-app.html, nav .tabs).
// 2026-10-08 -- orden pedido explícito de Ezequiel: Panel de Ventas primero
// (la vista en vivo que se usa a diario), Sales Performance (SNAP, todavía
// mock) pasa a tercera.
const NAV = [
  { href: "/#panel", label: "Panel de Ventas", icon: "📊" },
  { href: "/#region", label: "Ventas por Región", icon: "🍷" },
  { href: "/#snap", label: "Sales Performance", icon: "📋" },
  { href: "/otros-analisis/", label: "Otros Análisis", icon: "📈" },
  { href: "/ctrl-afip/", label: "Ctrl AFIP", icon: "🧾" },
  { href: "/budget/", label: "Budget", icon: "💰" },
  { href: "/controles/", label: "Controles", icon: "🛡️" },
  { href: "/datos-maestros/", label: "Datos Maestros", icon: "🗂️" },
  { href: "/auditoria/", label: "Auditoría", icon: "🔍" },
];

export function Sidebar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <aside className="fixed top-0 left-0 h-screen w-[272px] bg-[#2b2d31] flex flex-col z-40">
      <div className="px-5 pt-6 pb-5 shrink-0 border-b border-white/10 flex items-center gap-3">
        <div className="w-1.5 h-9 rounded-full bg-gradient-to-b from-[#DCBE84] to-[#b8975a]" />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/40">Grupo Colomé S.A.</p>
          {/* id="sbTitle" -- la página Ventas (app.js portado del mock) retitula esto
              al cambiar de vista (Sales Performance/Panel de Ventas/Región), ver
              app/page.tsx. Las demás páginas no lo tocan, queda estático. */}
          <p id="sbTitle" className="text-sm font-semibold text-white mt-0.5">{title}</p>
        </div>
      </div>
      {children && <div className="flex-1 overflow-y-auto px-5 py-4 text-[#d7d5d2]">{children}</div>}
    </aside>
  );
}

export function Header({ current }: { current: string }) {
  const [user, setUser] = useState<{ email: string; name: string; role: string } | null>(null);
  const [checked, setChecked] = useState(false);
  // Las 3 vistas de Ventas (SNAP/Panel/Región) viven todas en "/" y se
  // distinguen por hash (#snap/#panel/#region, ver app/page.tsx) -- se
  // trackea acá para resaltar el pill correcto sin recargar la página.
  const [hash, setHash] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setUser(d))
      .catch(() => {
        const next = encodeURIComponent(window.location.href);
        window.location.href = `https://colome-web.gruposamadhiai.com/?next=${next}`;
      })
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    const update = () => setHash(window.location.hash || "#snap");
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const logout = () => {
    window.location.href = "https://colome-web.gruposamadhiai.com/";
  };

  return (
    <div className="min-h-[92px] px-9 flex items-center justify-between gap-4 sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#ece6d8]">
      {checked && (
        <nav className="flex items-center gap-1.5 overflow-x-auto max-w-[70vw] bg-[#f7f5f0] rounded-full p-[5px]">
          {NAV.map((item) => {
            const active = item.href.startsWith("/#")
              ? current === "/" && hash === item.href.slice(1)
              : current === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 text-[12.5px] font-semibold px-[18px] py-[9px] rounded-full transition-all duration-150 ${
                  active ? "bg-white text-[#1c1811] shadow-[0_2px_8px_rgba(28,24,17,0.1)]" : "text-[#847c68] hover:text-[#1c1811]"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </a>
            );
          })}
        </nav>
      )}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {/* Logo -> vuelve al portal (colome-web), igual que el mock original
            (logo arriba, datos de sesión debajo, mismo criterio que
            brand-r en shell-app.html) -- se había perdido al portar Ventas
            al nav compartido (reportado por Ezequiel 2026-10-07). */}
        <a href="https://colome-web.gruposamadhiai.com/menu.html" title="Volver al portal">
          <img src="/logo-colome-transparente.png" alt="Bodega Colomé" className="h-9 w-auto" />
        </a>
        {user && (
          <div className="flex items-center gap-2 text-[#847c68] leading-none">
            <span className="text-xs">{user.name || user.email}</span>
            <span className="text-[10px] uppercase tracking-wide text-[#a39a84]">{user.role}</span>
            <button onClick={logout} className="text-[10px] uppercase tracking-wide underline hover:text-[#7D4E5B] transition-colors">
              Salir
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppShell({
  current, title, sidebar, children,
}: { current: string; title: string; sidebar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f7f5f0] flex">
      <Sidebar title={title}>{sidebar}</Sidebar>
      <main className="flex-1 md:ml-[272px] min-w-0">
        <Header current={current} />
        <div className="px-9 pb-10">{children}</div>
      </main>
    </div>
  );
}
