"use client";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";

// 2026-10-07 -- Ventas (Sales Performance/Panel de Ventas/Ventas por Región)
// portado DENTRO del mismo deploy Next.js, ya no un sitio estático separado
// ("es que ya no puede ser mas un mock", pedido explícito de Ezequiel: las 8
// hojas tienen que estar conectadas en un único nav, no un salto entre apps).
//
// No se reescribió la lógica de cero (gráficos SVG propios, mapa Leaflet,
// árbol Región→País→Cliente) -- se portó tal cual desde fuentes-mock-app/
// (mismo HTML/CSS/JS ya validado) vía fetch + inyección de DOM en runtime:
// las piezas viven en public/ventas/ (generadas con
// fuentes-mock-app/extraer_para_nextjs.py a partir de mock-fase1-app.html,
// MISMA fuente que antes, solo partida en archivos). Esto es un puente
// deliberado, no el patrón final -- portar esta lógica a componentes React
// nativos es trabajo de una sesión futura.
//
// 2026-10-08 -- Panel de Ventas y Ventas por Región conectados en vivo a
// ig_ventas (backend/panel_ventas.py): `colome-facts.json` estático
// reemplazado por `/api/ventas/panel`, mismo esquema dims/facts exacto, así
// que `app.js` (portado tal cual del mock) no necesitó cambios. Sales
// Performance (SNAP) sigue leyendo `colome-data.json` estático -- dataset
// distinto, no conectado todavía (próxima sesión).
//
// 2026-10-08 (mismo día, corrección urgente) -- Ezequiel: "entre y sales
// performance tarda muchísimo!". Causa: `/api/ventas/panel` ahora calcula en
// vivo sobre ~13 meses de historia, y mientras el cache en disco de esos
// días se precalienta por primera vez cada request recién cacheado puede
// tardar varios minutos -- pero el Promise.all original esperaba ESE fetch
// antes de mostrar NADA, incluso para ver Sales Performance (que ni siquiera
// usa ese dato, lee `colome-data.json`). Fix: separar en 2 etapas. Etapa 1
// (rápida, bloquea el render inicial): sidebar+content+colome-data+snap.js
// -- alcanza para que Sales Performance se vea de inmediato. Etapa 2 (lenta,
// en background, no bloquea nada): `/api/ventas/panel` + app.js -- se
// inyectan solos cuando están listos, para que cambiar a Panel de
// Ventas/Región funcione apenas terminen de cargar.
//
// 2026-10-08 (mismo día, segunda corrección) -- Ezequiel: "al entrar me
// muestra en fantasma sales performance, y después muestra panel de
// ventas". La separación en 2 etapas de arriba asumía que la vista inicial
// SIEMPRE es Sales Performance -- pero `app.js` (el que lee el hash de la
// URL y decide qué pestaña mostrar) quedó en la Etapa 2, lenta. Si alguien
// entraba directo a `/#panel` o `/#region` (ej. volviendo con el back del
// navegador, o un link guardado), igual se veía Sales Performance primero
// porque recién se corregía cuando terminaba de cargar la Etapa 2. Fix:
// mirar el hash ANTES de decidir -- si apunta a Panel/Región, no hay fast
// path posible (esas vistas SÍ necesitan el dato en vivo), así que se
// cargan todas las piezas juntas de una, como antes de la primera
// corrección. El fast path de 2 etapas queda solo para cuando realmente se
// va a mostrar Sales Performance (hash vacío o "#snap").
export default function VentasPage() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = "/ventas/ventas.css";
    document.head.appendChild(cssLink);

    const hash = (window.location.hash || "").replace("#", "");
    const vaAPanelORegion = hash === "panel" || hash === "region";

    const inyectarSnap = (dataJson: string, snapJs: string) => {
      const dataScript = document.createElement("script");
      dataScript.id = "colome-data";
      dataScript.type = "application/json";
      dataScript.textContent = dataJson;
      document.body.appendChild(dataScript);

      const snapScript = document.createElement("script");
      snapScript.textContent = snapJs;
      document.body.appendChild(snapScript);
    };

    const inyectarPanel = (factsJson: string, appJs: string) => {
      const factsScript = document.createElement("script");
      factsScript.id = "colome-facts";
      factsScript.type = "application/json";
      factsScript.textContent = factsJson;
      document.body.appendChild(factsScript);

      const appScript = document.createElement("script");
      appScript.textContent = appJs;
      document.body.appendChild(appScript);
    };

    const fetchPanel = () => fetch("/api/ventas/panel").then((r) => {
      if (r.status === 401) { window.location.href = "/"; return "{}"; }
      return r.text();
    });

    if (vaAPanelORegion) {
      // Se va directo a una vista en vivo -- no hay fast path posible
      // (necesitan el dato de /api/ventas/panel sí o sí), así que se carga
      // todo junto, orden exacto del documento original: colome-data ->
      // snap.js -> colome-facts -> app.js (éste último es el que lee el
      // hash y decide la pestaña, evitando el flash de Sales Performance).
      Promise.all([
        fetch("/ventas/sidebar.html").then((r) => r.text()),
        fetch("/ventas/content.html").then((r) => r.text()),
        fetch("/ventas/colome-data.json").then((r) => r.text()),
        fetchPanel(),
        fetch("/ventas/snap.js").then((r) => r.text()),
        fetch("/ventas/app.js").then((r) => r.text()),
      ]).then(([sidebarHtml, contentHtml, dataJson, factsJson, snapJs, appJs]) => {
        if (sidebarRef.current) sidebarRef.current.innerHTML = sidebarHtml;
        if (contentRef.current) contentRef.current.innerHTML = contentHtml;
        inyectarSnap(dataJson, snapJs);
        inyectarPanel(factsJson, appJs);
        setLoaded(true);
      });
      return;
    }

    Promise.all([
      fetch("/ventas/sidebar.html").then((r) => r.text()),
      fetch("/ventas/content.html").then((r) => r.text()),
      fetch("/ventas/colome-data.json").then((r) => r.text()),
      fetch("/ventas/snap.js").then((r) => r.text()),
    ]).then(([sidebarHtml, contentHtml, dataJson, snapJs]) => {
      if (sidebarRef.current) sidebarRef.current.innerHTML = sidebarHtml;
      if (contentRef.current) contentRef.current.innerHTML = contentHtml;

      // orden exacto del documento original (shell-app.html): colome-data
      // -> snap.js (lee colome-data), ya con los divs/ids de arriba
      // presentes en el DOM. Sales Performance ya es usable acá.
      inyectarSnap(dataJson, snapJs);
      setLoaded(true);

      // Etapa 2, en paralelo sin bloquear lo de arriba -- Panel de Ventas y
      // Ventas por Región (y la navegación entre pestañas, que maneja
      // app.js) quedan disponibles apenas termine, sin congelar Sales
      // Performance mientras tanto.
      Promise.all([fetchPanel(), fetch("/ventas/app.js").then((r) => r.text())])
        .then(([factsJson, appJs]) => inyectarPanel(factsJson, appJs));
    });
  }, []);

  return (
    <AppShell current="/" title="Sales Performance" sidebar={<div ref={sidebarRef} />}>
      {!loaded && <div className="py-20 text-center text-[#847c68] text-sm">Cargando…</div>}
      <div ref={contentRef} />
      {/* usado por app.js (portado del mock) para los tooltips de los gráficos SVG */}
      <div id="tip" role="tooltip" />
    </AppShell>
  );
}
