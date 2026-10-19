# Colomé Ventas — Arquitectura

Backend FastAPI (Python) + Frontend Next.js/TypeScript (export estático),
conectado en vivo a la API ORDS/Oracle de Redline (`ig_ventas`, módulo
`redline_bi`). Identidad visual: shell "Web App moderna" de Colomé (nav en
pill flotante, sidebar oscuro `#2b2d31`, acento dorado/bordó) — ver
`Colome/ARQUITECTURA.md`. Primer `ARQUITECTURA.md` de este repo (no existía
antes, creado 2026-10-19 al cerrar la sesión de Otros Análisis — ver norma
de trabajo "Actualizar ARQUITECTURA.md al cerrar").

Última actualización: 2026-10-19 (sesión SNAP -> Sales by Line of Business).

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
  snap.py                         -- SNAP -> Sales by Line of Business EN VIVO
                                      (ver detalle abajo); Sales by Market
                                      sigue siendo mock estático
frontend/
  src/app/
    page.tsx                -- Ventas (mock portado: Panel/Región/SNAP por hash;
                                SNAP mergea /api/ventas/snap en vivo + sbm mock)
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

## SNAP -> Sales by Line of Business (agregado 2026-10-19)

Réplica en vivo de la hoja "Sales by Line of Business" del SNAP real
(`SNAP I Aug 2026 - NM - vsp.xls`), reemplazando `colome-data.json`
estático. Sin Budget/Forecast (decisión 2026-10-09: "nunca existió un
dato real"). Last Year solo si hay dato real del mismo rango un año
atrás. Ejercicio fiscal Colomé: julio a junio (igual que `app.js`).

**Partición completa por `d_categoria`** (6 valores reales posibles):
DBA/DCBA/DNOA → Grupo Colome Domestic (mayorista), EXPORTS → Grupo Colome
Export, DTC/HOSPITALIDAD → Direct-to-consumer Channel (sub-clasificado por
`snap_linea_negocio_mapa`, Datos Maestros -> combinaciones sin clasificar
caen en "Otro DTC/Hospitalidad", se suman igual, solo sin nombre propio).
Jerarquía de totales (reconstruida comparando números reales del mock, no
inventada): `Total Grupo Colome Brand = Domestic + Export`; `DTC Channel =
Employees + E-commerce + Colome Hotel + Colome Visitor Center + Cafayate
Visitor Center + Otro` (subtotal calculado, NO query independiente);
`TOTAL SALES TO THIRD PARTIES = Brand + DTC Channel + BOB`; `TOTAL SALES =
Third Parties + Intercompany`. BOB (Ascension) e Intercompany (GC Wines
Uruguay) en 0 fijo -- investigado, no hay ventas reales de esos canales en
los 13 meses de histórico.

**3 gotchas de calidad de dato encontrados y corregidos** (validar SIEMPRE
contra un mes real antes de avisar que algo está listo -- los primeros
números parecían razonables a simple vista pero tenían 2 bugs reales
escondidos):
1. **FdelMotte** (`d_rubro="FDELMOTTE **"`) hay que excluirla del
   consolidado -- existe en ig_ventas pero no en el Excel/SNAP real (mismo
   criterio ya confirmado para Panel de Ventas).
2. **`costo_unit_mon_alt` corrupto** en ciertos artículos vendidos por
   VENTA AL PERSONAL/HOSPITALIDAD (ej. "AMALAYA BLANCO DULCE" con costo
   ~USD 1.87M/botella contra un precio de ~USD 2.70) -- guard de 2
   condiciones en `snap.py` (costo >10x el ingreso de la línea, O costo
   absoluto >USD 500; la primera condición SOLA no alcanza porque con
   ingreso exactamente $0 -- degustación gratis -- `if usd_linea` es falsy
   y no dispara).
3. **`costo_unit_mon_alt` prácticamente vacío para el canal mayorista**
   (DBA/DCBA/DNOA): verificado, ~USD 2 de costo sobre ~USD 220.000 de
   venta en agosto-2026. Mostrar %MG ahí da un ~100% engañoso -- se marca
   `gm_act="N/A"` explícito (parámetro `sin_costeo=True` en `_fila()`) para
   Domestic/Export/AirLines, no se inventa ni se oculta el hallazgo.

**Pendiente**: Sales by Market (54 filas, ~40 países con subtotales por
región) sigue siendo mock estático, deliberadamente fuera de esta sesión.

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
