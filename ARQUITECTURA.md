# Colomé Ventas — Arquitectura

Backend FastAPI (Python) + Frontend Next.js/TypeScript (export estático),
conectado en vivo a la API ORDS/Oracle de Redline (`ig_ventas`, módulo
`redline_bi`). Identidad visual: shell "Web App moderna" de Colomé (nav en
pill flotante, sidebar oscuro `#2b2d31`, acento dorado/bordó) — ver
`Colome/ARQUITECTURA.md`. Primer `ARQUITECTURA.md` de este repo (no existía
antes, creado 2026-10-19 al cerrar la sesión de Otros Análisis — ver norma
de trabajo "Actualizar ARQUITECTURA.md al cerrar").

Última actualización: 2026-10-19.

## Estructura

```
backend/
  app.py              -- FastAPI app, routers, SSO (cookie del portal
                          colome-web), CORS
  database.py         -- SQLite propio del servicio (/data/colome-ventas.db)
  ig_ventas.py         -- cliente a la API ORDS de Redline (ig_ventas) +
                           TODA la lógica de agregación en vivo: cache por
                           día en disco (/data/ig_ventas_cache, persistente
                           en meses cerrados), dedupe global por (id,det_id),
                           Panel de Ventas, Cruce AFIP, Jurisdicción,
                           Auditoría, Desglose por Grupo y Otros Análisis
                           (Por Cliente/SKU/Vendedor) -- ver detalle abajo
  panel_ventas.py       -- Panel de Ventas / Ventas por Región (facts_panel_ventas)
  jurisdiccion.py         -- Ctrl AFIP -> Ventas por Jurisdicción (un mes a la vez)
  afip.py                  -- Ctrl AFIP -> Info AFIP (carga manual de export)
  controles.py              -- Panel de Controles (completitud de datos)
  datos_maestros.py          -- Jurisdicción (mapa valor_api -> concepto)
  auditoria.py                -- descarga línea a línea (regla de oro #33)
  otros_analisis.py             -- endpoints de Otros Análisis (ver abajo)
frontend/
  src/app/
    page.tsx                -- Ventas (mock portado: Panel/Región/SNAP por hash)
    ctrl-afip/page.tsx        -- Cruce AFIP / Info AFIP / Ventas por Jurisdicción
    controles/page.tsx          -- Panel de Controles
    otros-analisis/page.tsx       -- Por Cliente / Por SKU / Por Vendedor (ver abajo)
    budget/page.tsx                -- placeholder "en desarrollo"
    datos-maestros/page.tsx          -- Jurisdicción (alta/edición de mapeos)
    auditoria/page.tsx                 -- descarga línea a línea, admin-only
  src/components/AppShell.tsx           -- shell + Sidebar + Header + nav (NAV[])
  public/ventas/app.js, ventas.css       -- mock original portado (Panel/Región/SNAP)
```

## Otros Análisis -> Por Cliente / Por SKU / Por Vendedor (agregado 2026-10-19)

Réplica en vivo de 3 hojas de `Operaciones_de_Ventas.xlsx` (cuadro mensual
que Colomé recibe de Redline): **Por Cliente** (Vendedor→Cliente: Cajas9l/
Cantidad/Venta Neta ARS), **Por SKU** (Rubro→Artículo × Mercado Externo/
Interno: Cajas9l) y **Por Vendedor** (Rubro→Artículo × Vendedor: Cantidad/
Venta Neta ARS). Las 3 filtran `d_grupo == "VINOS **"` (mismo universo que
Panel de Ventas, NO el 100% AFIP que usa Desglose por Grupo). "% Desc C" y
"% MG" se decidió NO mostrarlos (el backend sigue calculando `mg_pct`, por
si se vuelve a pedir — ver `ig_ventas.py`).

- **Backend:** `ig_ventas.py::_lineas_vinos()` (generador compartido,
  filtra TIPOS_VALIDOS+VINOS**, aplica signo -1 en notas de crédito a
  TODAS las magnitudes) + `ventas_por_cliente/sku/vendedor()`. Endpoints en
  `otros_analisis.py`: `/api/otros-analisis/por-{cliente,sku,vendedor}
  ?periodo=YYYY-MM`, un mes calendario a la vez (mismo patrón que
  `jurisdiccion.py`), sin cache de agregado histórico propio (ya es barato,
  reusa el cache por-día compartido).
- **Frontend:** 3 sub-pestañas en `otros-analisis/page.tsx`, cada una con
  su propio período/buscador/chips de filtro reportados al padre vía un
  callback `onFiltros` + `useEffect`, que los renderiza en el `sidebar=`
  de `AppShell` (nunca arriba de la tarjeta — ver norma de trabajo
  "Toda pantalla con layout de sidebar..."). Orden alfabético en las 3
  vistas. Rubro/Vendedor son columnas propias con `rowSpan` por grupo (no
  solo texto en la fila de Total). Chips de Vendedor = checkbox real
  dentro de un `<label>` con pinta de chip (mismo patrón que
  `public/ventas/app.js`/`ventas.css`, clase `.chip`), nunca un `<button>`
  que solo cambia de color.
- **Gotcha de cache (recurrente, atención si se agrega un campo nuevo a
  `CAMPOS_USADOS`):** el cache por-día en disco (`/data/ig_ventas_cache`,
  persistente para siempre en meses cerrados) solo tiene las claves que
  estaban en `CAMPOS_USADOS` al momento de cachear ese día. Agregar una
  clave nueva (pasó dos veces el 2026-10-19: `c_articulo`/`n_vendedor`
  primero, `d_articulo` después porque se había olvidado) requiere **purgar
  todo el directorio** (`rm -rf /data/ig_ventas_cache/*` dentro del
  contenedor) y **reprecalentar el histórico completo** llamando
  `ventas_por_cliente(2025-09-01, <hoy>)` una vez (alcanza para calentar el
  cache compartido que usan las 3 funciones) — si no, el primer usuario que
  pide un mes nuevo paga ~75s de bajada en vivo. **Usar siempre `docker exec
  -d $CID python -c "..."` para ese reprecalentamiento** (detached del lado
  de Docker), nunca `docker exec` en foreground + `&`/`disown` sobre el
  shell SSH -- se cortó una vez con exit 137 a mitad de camino.
- **Cron de precalentamiento automático** (instalado 2026-10-19, fuera de
  git — son archivos de infraestructura del VPS, no del repo): crontab de
  `root` en el VPS, `0 3 2 * * /root/colome-ventas-build/precalentar_mes_cerrado.sh`.
  El `.sh` hace `docker cp` del `.py` (ambos en `/root/colome-ventas-build/`,
  no en la imagen Docker) al contenedor corriendo y lo ejecuta con
  `PYTHONPATH=/app` — precalienta el mes que acaba de cerrar antes de que
  cualquier usuario lo pida. Detalle completo en memoria de Claude
  `proyecto_colome_ventas_otros_analisis`.

## Deploy

- **URL producción:** https://colome-ventas.gruposamadhiai.com
- **VPS:** Easypanel (72.62.141.177), proyecto `colome`, servicio
  `colome_colome-ventas`.
- **Repo:** `github.com/egarcia-samadhi/colome-ventas-app` (privado, Deploy
  Key SSH dedicada — host alias `github-samadhi-colome-ventas`).
- **Checkout en el VPS:** `/root/colome-ventas-build/colome-ventas-src`.
- **`deploy.sh`** (commiteado al repo): verifica git limpio+sincronizado
  con `origin/main`, backup de `/data/colome-ventas.db`, build taggeado
  por SHA, `docker service update --force`, verifica con
  `curl /api/auth/me` (espera 401 sin sesión). El bit +x se pierde en
  algunos `git pull` del VPS — si `./deploy.sh` da "Permission denied",
  correr `bash deploy.sh` directo.
- **Acceso:** SSO con el portal (`colome-web`), cookie de sesión validada
  vía `get_sso_session()` en `app.py`.
- **Cache en disco:** `/data/ig_ventas_cache` (persistente, volumen `/data`
  del servicio) + agregados cacheados (`panel_ventas_agg_cerrado.json`,
  `otros_analisis_agg_cerrado.json` en `/data`).
