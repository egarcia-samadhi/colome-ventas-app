# Colomé Ventas — Arquitectura

Backend FastAPI (Python) + Frontend Next.js/TypeScript (export estático),
conectado en vivo a la API ORDS/Oracle de Redline (`ig_ventas`, módulo
`redline_bi`). Identidad visual: shell "Web App moderna" de Colomé (nav en
pill flotante, sidebar oscuro `#2b2d31`, acento dorado/bordó) — ver
`Colome/ARQUITECTURA.md`. Primer `ARQUITECTURA.md` de este repo (no existía
antes, creado 2026-10-19 al cerrar la sesión de Otros Análisis — ver norma
de trabajo "Actualizar ARQUITECTURA.md al cerrar").

Última actualización: 2026-10-22 (formato del popup "Sales by Market" mejorado + FdelMotte llevado al mismo formato que Consolidado en Sales Performance).

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
                                      se sacó de la hoja (pedido Ezequiel 2026-10-19)
frontend/
  src/app/
    page.tsx                -- Ventas (mock portado: Panel/Región/SNAP por hash;
                                SNAP consume /api/ventas/snap en vivo directo)
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
  filtra TIPOS_VALIDOS+VINOS**+fecha real dentro del rango pedido -- SIN
  flip de signo manual, ver corrección 2026-10-19/20 más abajo) +
  `ventas_por_cliente/sku/vendedor()`. Endpoints en
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
   criterio ya confirmado para Panel de Ventas). Desde 2026-10-22 FdelMotte
   tiene su PROPIO Sales by Line of Business (ver sección "FdelMotte al
   mismo formato que Consolidado" más abajo) -- la exclusión de acá sigue
   aplicando tal cual al consolidado de Colomé, FdelMotte ahora es un
   universo paralelo, no una exclusión sin reemplazo.
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

**Sales by Market** (54 filas, ~40 países con subtotales por región, mock
estático que nunca se conectó): sacado de la hoja Sales Performance a
pedido explícito de Ezequiel (2026-10-19) en vez de conectarlo en vivo --
sección eliminada de `content.html`/`snap.js`/`sidebar.html`, `fetchSnap()`
ya no depende de `colome-data.json`.

**Filas ocultas en el SNAP real, replicado 2026-10-19**: Ezequiel compartió
`SNAP I September 2026 - NM - VSP 2.xls` (hoja "Sales by line of
bussines") con filas depuradas por Ariel -- confirmado con xlrd leyendo el
flag `hidden` de cada fila que el Excel real OCULTA (no borra):
"Grupo Colome Domestic - AirLines" (informativo, sigue sumado dentro de
Domestic), todo "Total Buyers Own Brand (BOB)" (Ascension
Malbec/Reserva/Torrontes/Others + subtotal -- 0 fijo) y todo "Total
Intercompany Sales" (GC Wines Uruguay S.A. -- 0 fijo). `ventas_sbl()` en
`snap.py` replica esto: sigue CALCULANDO esas líneas (entran en
`tercero_total`/`total` igual que en el SNAP real) pero no las devuelve en
la lista de filas mostradas -- filas visibles finales: Domestic, Export,
Total Grupo Colome Brand, Employees/E-commerce/Colome Hotel/Colome Visitor
Center/Cafayate Visitor Center, Direct-to-consumer Channel, TOTAL SALES TO
THIRD PARTIES, TOTAL SALES.

**Pestañas Monthly/YTD movidas del sidebar al contenido** (pedido explícito
2026-10-19): antes vivían como chips de radio en `sidebar.html`
(`name="snapPeriod"`, español, "Agosto 2026"/"YTD Jul–Ago"); ahora son
botones `.period-toggle` dentro de `#snapConsolidado` en `content.html`,
en inglés ("Monthly"/"YTD (rango real)"), mismo patrón visual `.seg` que
el toggle Consolidado/FdelMotte. CSS nueva en `ventas.css` (`.seg button`)
porque `.seg` original solo estilaba `label`+`input` (radios), no
`button`. Listener muerto sacado de `app.js` (escuchaba los radios
`snapPeriod` que ya no existen).

**Selector de mes en el sidebar** (pedido explícito 2026-10-19: "en el
sidebar tiene que decir qué mes querés ver... en el caso de ytd, hasta qué
mes"): `<select id="snapMesSel">` en `sidebar.html`, poblado por
`snap.js` con `RAW.meses_disponibles` (`_meses_disponibles()` en
`snap.py`, lista "YYYY-MM" desde `DESDE_HISTORICO` 2025-09 hasta el
último mes CERRADO). Un solo selector controla ambas pestañas: Monthly
muestra ese mes, YTD va desde el inicio del ejercicio fiscal hasta ese
mismo mes (así lo arma `snap()` en snap.py). Cambiar el selector dispara
`fetch('/api/ventas/snap?mes=YYYY-MM')` (nuevo query param opcional en el
endpoint, default al último mes cerrado si no se pasa o no está en la
lista de disponibles) y reemplaza `RAW` completo en memoria -- no hace
falta recargar la página.

**Fila "Sin clasificar" SIEMPRE visible** (pedido explícito 2026-10-19:
"tiene que ir a una línea sin clasificar, PERO SIEMPRE TIENE QUE MOSTRAR
EL TOTAL. LA CLASIFICACION Y CRITERIO TIENE QUE ESTAR DE MANERA EDITABLE
EN DATOS MAESTROS"): reemplaza el bucket silencioso "Otro
DTC/Hospitalidad" -- ahora es una fila propia en `ventas_sbl()`,
HERMANA de Brand/DTC Channel/BOB dentro de `TOTAL SALES TO THIRD
PARTIES` (no anidada en Direct-to-consumer Channel), siempre presente
aunque esté en 0. De paso corrige un bug real: un `d_categoria` fuera de
las 6 conocidas caía a un bucket "Otro" que ningún `_fila()` leía, esa
plata se perdía en silencio de TODOS los totales. Ahora cae en el mismo
"Sin clasificar". El criterio de clasificación YA era 100% editable
desde Datos Maestros antes de este pedido (CRUD completo en
`datos_maestros.py` sobre `snap_linea_negocio_mapa`, UI en
`datos-maestros/page.tsx` componente `SnapLineaNegocioMapa`, con el
endpoint `/api/datos-maestros/snap-linea-negocio/sin-clasificar` listando
las combinaciones pendientes) -- se confirmó que seguía funcionando, no
hizo falta tocar nada ahí.

**3er control en Panel de Controles: Sales by Line of Business sin
clasificar** (pedido explícito 2026-10-19: "si hay una línea sin
clasificar, tiene que saltar en controles"): `controles.py` importa
`combos_sin_clasificar` de `snap.py` y agrega el control `sbl_sin_clasificar`
a la lista -- mismo patrón que `jurisdiccion_sin_clasificar` (mismo rango
`_rango_a_chequear()`, ok=sin combos, items con centro_costo/categoria/
canal_venta + filas afectadas). Acción correctiva: a diferencia de
jurisdicción (que abre un modal inline en Controles), acá el link lleva a
`/datos-maestros/?tab=snap`.

**Datos Maestros con pestañas** (pedido explícito 2026-10-19: "SNAP —
Línea de negocio tiene que ser otra pestaña en datos maestros"): antes
eran 2 secciones (`JurisdiccionMapa`+`SnapLineaNegocioMapa`) apiladas en
una sola página larga; ahora son sub-pestañas "Jurisdicción"/"SNAP — Línea
de negocio", mismo patrón `SUB_TABS`+`?tab=` que Ctrl AFIP (deep-linking
desde Controles).

**BUG REAL encontrado y corregido 2026-10-19: navegación rota después de
visitar Panel de Ventas** (reportado por Ezequiel: "marco una hoja y me
muestra el snap"). Causa raíz en `public/ventas/app.js`, función
`snapRef()`: seguía leyendo `RAW['sbl_aug']` (clave vieja, renombrada a
`sbl_mes` cuando Sales by Line of Business pasó a vivo) y campos
`usd_bud`/`lit_bud` que `/api/ventas/snap` ya no manda (Budget sacado del
SNAP, decisión 2026-10-09). `RAW['sbl_aug']` daba `undefined`, `.find`
sobre `undefined` tiraba `TypeError` SIN CAPTURAR -- esto corría dentro de
la ejecución top-level de `app.js` al entrar a Panel de Ventas (`renderPanel`
-> `snapRef` -> `tot`), así que cortaba el resto del script a mitad de
camino, incluido el `window.addEventListener('hashchange', ...)` que es
el que hace que el nav superior (Panel/Región/Sales Performance) cambie de
vista. Una vez pisado ese error, el nav seguía resaltando el pill correcto
(eso lo maneja React en `AppShell.tsx`, independiente) pero el contenido
quedaba congelado en lo que fuera que content.html tenía por default
(`view-snap` visible, sin `hidden`, en el HTML crudo). Fix: `snapRef` usa
`sbl_mes`, devuelve `bud: null` explícito, y la tabla comparativa de Panel
de Ventas muestra "n/d" en la columna Budget en vez de `NaN` (`hasBud`
separado de `has`/LY).

**Segundo hallazgo verificando el fix de arriba**: después de deployar,
una pestaña YA ABIERTA seguía tirando el mismo error -- el navegador
servía una copia VIEJA de `app.js` desde su cache HTTP (confirmado con
`curl -sv` sin sesión: la ruta redirige a SSO, así que no fue eso; el
problema era la pestaña con sesión real sirviendo el `app.js` cacheado de
antes del deploy) pese al `Cache-Control: no-cache` del backend -- mismo
patrón ya documentado en la norma de trabajo "Cache-Control en FastAPI
FileResponse". `page.tsx` ahora usa un helper `fetchFresh()` con
`{cache: "reload"}` para los 6 fetches de assets estáticos de `/ventas/`
(sidebar.html, content.html, snap.js, app.js) -- fuerza al navegador a
revalidar contra el servidor siempre, no solo confiar en el header de
respuesta.

**Footer viejo sacado de Sales Performance**: `content.html` tenía un
`<footer class="meta">` con la leyenda original del mock ("Mock de
referencia — dato estático... Próximo paso: conectar todo al endpoint en
vivo"), señalado por Ezequiel como "esto esta de mas" -- obsoleto desde
que Sales by Line of Business y Panel de Ventas/Región están en vivo.

**Deep-link "Corregir" por fila en el control `sbl_sin_clasificar`**
(pedido explícito 2026-10-19: "acordate que desde controles debe poder
resolverse cada problema" -- el link genérico a `/datos-maestros/?tab=snap`
no alcanzaba, había que resolver CADA combinación puntual sin copiar a
mano). `controles.py` manda `centro_costo`/`categoria`/`canal_venta`
estructurados en cada item (no solo el string concatenado `valor`);
`controles/page.tsx` arma un link por fila a
`/datos-maestros/?tab=snap&cc=...&cat=...&cv=...`; `datos-maestros/page.tsx`
(`SnapLineaNegocioMapa`) lee esos query params al montar y abre el
formulario de alta ya precargado -- mismo resultado que
`precargarDesdeCombo()` (usado también desde la propia pestaña de Datos
Maestros), pero disparado por URL en vez de un click local.

**Columna/stat tile "GM %" sacados de Sales by Line of Business** (pedido
explícito 2026-10-19): `renderSbl()` en `snap.js` ya no pinta la columna
"GM %" (quedaba el grupo de 1 columna "Act"), el stat tile "GM % Actual"
(para TOTAL SALES mezclaba líneas con y sin costeo, siempre daba N/A de
todos modos) y la mención en "Cómo leer" del sidebar. El backend
(`snap.py` `_fila()`/`gm_act`) sigue calculando el dato -- no se tocó,
solo se dejó de mostrar.

**BUG REAL encontrado y corregido 2026-10-19: doble-signo en Notas de
Crédito, DENTRO del grupo VINOS ** únicamente** (reportado por Ezequiel:
"1695 hoja vs 1676 hoja de ventas, no coincide la venta en dolares en el
ytd"). Investigación con muestras reales de `_fetch_dia` confirmó que
Redline YA manda `valor_venta_mon_alt`/`valor_venta_mon_ext`/
`valor_mon_loc`/`cantidad`/`cantidad_cajas9l` con signo negativo para una
NOTA CREDITO VENTA -- pero **solo dentro del grupo "VINOS **"**. Varios
lugares del código aplicaban ADEMÁS un flip manual (`signo = -1 if
NC...`), duplicando el signo y convirtiendo la Nota de Crédito en venta
POSITIVA en vez de restarla.

Validado con 3 fuentes de verdad independientes antes de tocar nada:
1. **`snap.py`** (`_agregado_sbl`, Sales by Line of Business): comparado
   contra el SNAP real de Ariel (`SNAP I September 2026 - NM - VSP 2.xls`,
   fila TOTAL SALES YTD = USD 1.676,68 miles) -- el cálculo en vivo daba
   USD 1.694,56 (doble-signo), corregido a USD 1.685,29 (0,5% de
   diferencia residual, dentro de la tolerancia ya aceptada en la
   investigación original de agosto-2026). **CORREGIDO.**
2. **`_lineas_vinos()`** (`ig_ventas.py`, compartida por Otros Análisis →
   Por Cliente/SKU/Vendedor): comparado contra el total ARS de Panel de
   Ventas (`facts_panel_ventas`, que NUNCA tuvo este flip) para el mismo
   rango jul-sep 2026 -- match EXACTO tras sacar el doble-signo
   (2.561.308.999,35 ambos lados, hasta el centavo). **CORREGIDO.**
3. **`neto_por_jurisdiccion()`/`_agregado_crudo_desglose()`** (Ventas por
   Jurisdicción, Otros Análisis → desglose por grupo): acá el universo NO
   se filtra a VINOS ** (incluye INSUMOS/SERVICIOS/etc). Sacar el flip acá
   ROMPÍA el Cruce AFIP real: recalculando el cruce completo con el campo
   tal cual viene (sin flip), el error contra el total real de AFIP pasaba
   de $0,74 a **~$180.000.000** sobre ~$2.057M ARS. Conclusión: el
   pre-firmado de Redline es específico de VINOS **, no universal -- en
   el resto de los grupos el flip manual SIGUE HACIENDO FALTA. **NO
   TOCADO** (se probó revertir y volver a aplicar, quedó como estaba
   originalmente).
4. **`neto_y_cae_por_comprobante()`** (Cruce AFIP, universo completo):
   nunca se tocó -- ya estaba validado por el match real contra AFIP
   ($0,74 de diferencia sobre $2.057M ARS, $0 sobre USD 459k).

Metodología replicable para auditar el resto del código si aparece otra
sospecha de descuadre: comparar contra una fuente de verdad INDEPENDIENTE
del propio código (un Excel real del cliente, o un total ya validado
contra AFIP) -- el patrón de código "se ve igual" no implica que el bug
sea el mismo; acá dos funciones con el MISMO código fuente tenían
comportamiento correcto opuesto según si filtraban VINOS ** o no.

**Residuo sin cerrar, investigado a fondo 2026-10-19**: después del fix de
arriba, YTD en vivo = USD 1.685,29 (miles) vs. USD 1.676,68 real de Ariel
-- 0,5% de diferencia (dentro de la tolerancia ya aceptada en agosto, pero
Ezequiel pidió seguir investigando: "sigo viendo los 1685 vs 1676").
Desglosado línea por línea: Domestic/Export/Hotel cierran casi exacto
(Colome Hotel exacto al centavo); el 82% del residuo (7 de 8,6k) está en
**E-commerce**, repartido en ~1.150 facturas chicas bajo el cliente
genérico "CLIENTE NO HABITUAL CANAL ONLINE" (no en 2-3 outliers). Se
descartó tipo de cambio (Domestic usa el mismo tipo de cambio implícito y
sí cierra) y duplicados (coincidencias fecha+monto repetidas son precios
de catálogo iguales entre compradores distintos, no duplicados). Hipótesis
de trabajo sin confirmar: e-commerce postea con demora en Redline (pedidos
online tardan más en facturarse que el mayorista), así que el Excel
estático de Ariel pudo haberse generado antes de que esos pedidos
terminaran de cargarse -- el número en vivo sería MÁS completo, no
erróneo. **No se puede confirmar sin el detalle transacción por
transacción de Ariel** (Ezequiel prefirió no pedirlo todavía: "no
entendemos que tiene que ver, si lo que es venta es venta").

**Refactor estructural en respuesta** (pedido explícito: "no tenemos que
partir de cosas distintas, los mismos 1676 asignandole la clasificacion
tienen que ir al snap"): `_agregado_sbl()` y `combos_sin_clasificar()` en
`snap.py` tenían su PROPIO loop `_fetch_dia`+dedupe+filtro
TIPOS_VALIDOS/GRUPO_VALIDO, duplicado en paralelo al de `_lineas_vinos()`
(ig_ventas.py, ya usado por Otros Análisis). Refactorizado para que ambas
funciones CONSUMAN `_lineas_vinos()` directamente -- la clasificación en
líneas de negocio ahora es una capa sobre las MISMAS filas que usa el
resto de la app, no una reconsulta independiente. Validado que el total
no cambió (1685,2861 antes y después, solo redondeo) -- el refactor
elimina la posibilidad de que las dos funciones diverjan a futuro por
mantenerse por separado, pero NO cierra el residuo de 0,5% contra Ariel
(que no es un problema de pipeline duplicado, ya que Otros Análisis daba
el mismo número).

**CERRADO 2026-10-20: el residuo de 0,5% (USD 8,63k, "1676 vs 1685") era
un BUG REAL, no una diferencia de timing contra el Excel de Ariel como se
había hipotetizado el día anterior.** Causa: `_lineas_vinos()` no tenía el
fix de "corte de fecha no limpio" de la API que `_periodo_de_fila()` (usada
por Panel de Ventas/Jurisdicción) ya tenía desde el 2026-10-08. Al pedir el
día 30/09, la API ORDS devuelve además líneas cuya `fecha` real es 01/10
(confirmado con el fetch real de ese día: 87 líneas de 30/09 + 80 líneas de
01/10, USD 8.625,32 exactos) -- Panel de Ventas las reubicaba bien en
octubre, `_lineas_vinos` las contaba de más en septiembre, inflando snap Y
Otros Análisis por igual. Fix: se agregó dentro de `_lineas_vinos()` el
mismo filtro por fecha real (`it.get("fecha")` contra `[desde, hasta_incl]`,
nunca el día del loop) -- corrige ambos consumidores de una sola vez, sin
reconstruir snap sobre otro pipeline. Validado en el VPS antes y después
del deploy: snap sin FdelMotte converge EXACTO con el cache de Panel de
Ventas (USD 1.676,661k ambos lados, jul-sep 2026). Commit
`cac5270078e11269fc51ffb4ab228eab0d6706dc`. Detalle completo de la
investigación en memoria de Claude, `proyecto_colome_sales_performance_en_vivo`.

**MISMO DÍA, continuación: LY completo + Budget real en Panel de Ventas.**
Dos fixtures estáticas nuevas en `backend/` (JSON, commiteadas, agregar al
`COPY` del Dockerfile si se tocan):
- `lfy_jul_ago_2025.json` -- jul-ago 2025 (el hueco antes de
  `DESDE_HISTORICO`), extraído de `LFY.xlsx` que mandó Ariel, agregado por
  (periodo, línea de negocio). Clasificación de línea INFERIDA del campo
  `Centro` del archivo (no trae línea explícita) -- validada después con
  el SNAP real de Ariel (`YTD - Snap - ly.xlsx`), coincide exacto.
- `budget_2026_2027.json` -- presupuesto real del ejercicio ACTUAL
  2026-2027 (jul-2026 a jun-2027), extraído de `Budget_Dinamico.xlsx`,
  agregado a TOTAL por mes (sin desglose por línea). Revierte la decisión
  del 2026-10-09 ("Budget sacado, nunca existió un dato real"). **El
  archivo etiqueta su columna `Año_Fiscal` como "2025-2026", pero Ariel
  confirmó que esa etiqueta está mal -- es el ejercicio en curso.** Se
  reextrajo mapeando `Nro_Mes` directo a 2026-07..2027-06, ignorando esa
  columna del archivo.

`snap.py::_agregado_sbl_con_lfy()` combina la fixture LFY con
`_agregado_sbl()` mes a mes -- reemplaza a `_agregado_sbl()` SOLO en el
cálculo de LY de `ventas_sbl()`. `snap.py::_ly_mensual()` expone TOTAL
SALES actual+LY+Budget por mes calendario (campo `ly_mensual` en
`/api/ventas/snap`) para que Panel de Ventas (`app.js::snapRef()`) pueda
sumar cualquier combinación de períodos tildados en el sidebar -- antes
`snapRef()` solo reconocía P01/P02/P01+P02 fijos.

**3 gotchas reales encontrados en el camino:**
1. `_cero()` (BOB/Intercompany, fijos en 0) devolvía `usd_ly=None` en vez
   de `0.0` -- `_sumar()` exige TODAS las filas con LY no-nulo, así que
   TOTAL SALES mostraba "n/d" SIEMPRE, incluso con LY real disponible.
2. La vista default de Panel de Ventas siempre incluye el período EN
   CURSO (nunca tiene LY) -- `snapRef()` ahora filtra a los meses YA
   CERRADOS de la selección y recalcula el "Actual" de esa tabla sobre el
   MISMO subconjunto (nunca comparar rangos de distinta longitud).
3. LY y Budget tienen disponibilidad INDEPENDIENTE por mes -- no asumir
   que un rango con una tiene necesariamente la otra (hoy jul-sep 2026
   tiene ambas, pero jul-ago 2025, antes del histórico en vivo, solo
   tiene LY vía LFY, nunca Budget del ejercicio actual). Cada métrica se
   calcula con su propia condición de completitud, no una sola.

Detalle completo en memoria de Claude,
`proyecto_colome_sales_performance_en_vivo`.

## Performance -- precalentamiento del mes en curso (agregado 2026-10-21)

`ig_ventas.py::_fetch_dia()` cachea para siempre los días de meses YA
CERRADOS, pero los del mes EN CURSO solo tienen un TTL corto
(`TTL_MES_EN_CURSO`, 6hs) -- necesario porque el ERP puede seguir cargando
comprobantes tarde hasta que el mes cierre. Esto significa que, cada vez
que ese TTL vence, la PRIMERA persona que entra a Panel de Ventas después
dispara un refetch SECUENCIAL a la API externa de todos los días
transcurridos del mes (medido 2026-10-21: ~20 días, ~2-3s cada uno, ~45s
total bloqueando esa carga). Reportado por Ezequiel como "al entrar por
primera vez, sigue tardando bastante".

**Fix:** cron nuevo en el VPS (NO en git, mismo patrón que
`precalentar_mes_cerrado.sh`): `crontab` de `root`,
`0 */5 * * * /root/colome-ventas-build/precalentar_mes_actual.sh` --
cada 5hs (antes de que venza el TTL de 6hs) llama a
`facts_panel_ventas(DESDE_HISTORICO, hoy)` dentro del contenedor vía
`docker cp` + `docker exec`, dejando el cache del mes en curso siempre
tibio. Ningún usuario real vuelve a pagar el refetch en vivo. Scripts:
`/root/colome-ventas-build/precalentar_mes_actual.sh` y `.py` (junto a
`precalentar_mes_cerrado.*`, mismo criterio: tooling del VPS, no
commiteado al repo).

## Panel de Ventas -> filtro previo "Agrupante de Canal" (agregado 2026-10-21)

Pedido explícito de Ariel Culasso vía Ezequiel: el filtro de Canal (18
valores crudos de `d_canal_venta`) tiene demasiados campos para uso diario
-- se agrega un filtro PREVIO que agrupa esos 18 valores en 7 agrupantes
(Vinotecas, Distribuidores, Gastronomía / Hospitality, Retail masivo,
Ecommerce, Aeropuertos, Venta directa / interna), SIN sacar el filtro de
Canal detallado, que sigue existiendo igual.

- **Catálogo:** `canal_agrupante_mapa` (`database.py`) -- 1 `canal_venta`
  -> 1 `agrupante`, catálogo fijo editable a mano desde Datos Maestros
  (mismo criterio que `jurisdiccion_mapa`, no auto-sincronizado). Sembrado
  con la propuesta de 7 agrupantes validada por Ezequiel 2026-10-21 sobre
  los 18 valores reales vistos en ig_ventas ese día -- un canal nuevo que
  aparezca después no se auto-clasifica, hay que cargarlo a mano (ver
  control de integridad abajo).
- **Backend:** `panel_ventas.py::panel_ventas()` agrega
  `dims["canal_agrupante"]` a la respuesta de `/api/ventas/panel` --
  array PARALELO a `dims["canal"]` (mismo índice), con el agrupante de
  cada canal o `"Sin agrupar"` si no está en el mapa. `ig_ventas.py` en sí
  no se tocó -- el agrupante es una capa de presentación encima del dato
  crudo, no cambia DIMS_PANEL/facts.
- **Frontend (`app.js`):** sidebar agrega una sección "Agrupante de
  Canal" ARRIBA de "Canal" -- tildar un agrupante agrega/saca de una todos
  los índices de canal de ese grupo en `st.canal` (el mismo Set que ya usa
  el filtro de Canal) y rebuildea el sidebar (`buildSidebar()` +
  `renderPeriodoChips()`) para reflejar el estado. Es un atajo de
  conveniencia puramente de UI, no un dato nuevo -- no hay sincronía
  inversa automática (si el usuario tilda canales sueltos a mano, el chip
  del agrupante no se recalcula hasta el próximo rebuild del sidebar,
  aceptado como limitación menor).
- **Datos Maestros:** nueva pestaña "Agrupante de Canal"
  (`frontend/src/app/datos-maestros/page.tsx::CanalAgrupanteMapa`), alta/
  edición/baja, mismo patrón visual que Jurisdicción.
- **Controles:** 4to chequeo `canal_sin_agrupante`
  (`ig_ventas.py::canales_sin_agrupante()` + `controles.py`) -- cuenta
  filas de GRUPO_VALIDO ("VINOS \*\*", mismo universo que Panel de Ventas)
  con `d_canal_venta` que no está en `canal_agrupante_mapa`. Botón
  "Corregir" abre modal inline (POST directo, sin deep-link a otra
  pestaña, porque es un mapeo de 1 solo campo -- mismo patrón que
  Jurisdicción, no el de SBL que necesita 3 campos).

Detalle completo en memoria de Claude,
`proyecto_colome_ventas_agrupante_canal`.

## Sales by Line of Business -> popup "Sales by Market" por línea (agregado 2026-10-21)

Pedido explícito de Ezequiel: poder hacer clic en una línea de Sales by
Line of Business (ej. "Colome Hotel") y ver un popup con el desglose de
ESA línea por mercado, en vivo -- reemplaza conceptualmente la vieja hoja
"Sales by Market" mock (~40 países, sacada el 2026-10-19 por no estar
conectada, ver sección de arriba), pero NO es una reactivación de esa
tabla: es un desglose nuevo, por línea, construido desde cero.

- **Granularidad de "mercado":** NO países sueltos como el mock viejo --
  se decidió reusar el catálogo YA VALIDADO de `jurisdiccion_mapa` (mismo
  que arma "Ventas por Jurisdicción" en Ctrl AFIP): provincia argentina
  real, o "Exterior" agregado para todo el resto. Evita construir una
  segunda fuente de verdad geográfica.
- **Backend (`snap.py`):**
  - `_clasificar_leaf(it, reglas)`: extraído de la partición que ya usaba
    `_agregado_sbl` (por `d_categoria`, sub-clasificando DTC/HOSPITALIDAD
    vía `_clasificar_dtc`) -- mismo criterio que el refactor 2026-10-19
    (una sola fuente de clasificación, nunca dos implementaciones
    paralelas que puedan divergir).
  - `_label_matches(label, it, leaf)`: dado el label de una fila/total del
    SNAP, dice si una fila cruda entra ahí -- soporta tanto líneas hoja
    (Colome Hotel, Grupo Colome Export, etc.) como totales/subtotales
    (Direct-to-consumer Channel, TOTAL SALES TO THIRD PARTIES, TOTAL
    SALES, Total Grupo Colome Brand) agregando los leaves que los
    componen. BOB/Intercompany devuelven siempre `False` (0 fijo, sin
    filas reales, ver docstring del módulo).
  - `desglose_mercado(label, desde, hasta_incl)`: recorre `_lineas_vinos`
    (misma fuente que `_agregado_sbl`, FdelMotte excluido) y agrega por
    `jurisdiccion._mapa_jurisdiccion()` las filas que matchean el label.
  - Endpoint `GET /api/ventas/snap/mercado?label=...&desde=...&hasta=...`.
- **Frontend (`snap.js`):** cada fila de la tabla SBL es un link
  (`.sbl-link`, clase nueva en `ventas.css`) que abre un modal (`.modal-
  overlay`/`.modal-box`, CSS nuevo, mismo lenguaje visual que el resto)
  con el desglose. El rango que se pide (`desde`/`hasta`) es SIEMPRE el
  de la pestaña activa (Monthly: el mes completo de `RAW.periodo`; YTD:
  `RAW.desde_ytd`/`RAW.hasta_ytd` tal cual los da el backend) -- pedido
  explícito de Ezequiel: el popup tiene que respetar qué período se está
  mirando, no un rango fijo.

Detalle completo en memoria de Claude,
`proyecto_colome_ventas_sales_by_market_popup`.

**Formato del popup mejorado (2026-10-22):** fila TOTAL al pie (mismo
estilo que el resto de tablas), filas ordenadas por USD descendente, barra
de participación por mercado (`.mkt-bar`/`.mkt-bar-fill`, gradiente
dorado), barra dorada superior en el modal (`.modal-box::before`, igual
que los stat-tiles) y header de tabla con fondo dorado suave. Fix de
scroll horizontal: `.mkt-table` usa `table-layout:fixed`/`min-width:0` en
vez del `min-width:520px` fijo de `table.tight` (que desbordaba el modal).

## FdelMotte al mismo formato que Consolidado (agregado 2026-10-22)

Pedido explícito de Ezequiel: "porque el sales performance de Fdelmotte es
distinto al consolidado? deberias llevarlo al mismo formato que
consolidado" -- eligió paridad completa (no solo piel visual) cuando se le
preguntó el alcance.

Antes FdelMotte se armaba con un pipeline de render completamente
separado, viejo, en `app.js` (`rowsFdelMotte()`/`renderSnapFdelMotte()`):
KPIs sin comparativo LY + 2 gráficos de barras SVG (Top clientes/
productos), sin tabla "Sales by Line of Business" ni popup de mercado.
Consolidado en cambio ya corría 100% en vivo sobre `snap.py` desde
2026-10-19. Esa divergencia es la misma clase de bug estructural que el
refactor de `_agregado_sbl` del 2026-10-19 (dos pipelines del mismo
universo de datos que pueden desalinearse) -- la solución fue la misma:
unificar en una sola fuente.

- **Backend (`snap.py`):** `_filas_universo(desde, hasta_incl, fdelmotte)`
  es ahora el ÚNICO punto que decide qué filas de `_lineas_vinos` entran
  (antes `_agregado_sbl`/`desglose_mercado` tenían cada una su propio `if
  d_rubro == "FDELMOTTE **": continue` hardcodeado). `_agregado_sbl`,
  `desglose_mercado` y `ventas_sbl` reciben `fdelmotte: bool = False`. La
  clasificación por línea de negocio (`snap_linea_negocio_mapa`) filtra
  por centro_costo/categoria/canal_venta, NO por marca -- aplica igual de
  bien a FdelMotte sin reglas nuevas; lo que no matchea cae en "Sin
  clasificar" (visible, mismo criterio de siempre).
  - **Gotcha de LY:** la fixture `lfy_jul_ago_2025.json` (tapa el hueco
    anterior a `DESDE_HISTORICO` 2025-09-01) es un volcado puntual que
    Ariel mandó SOLO para la marca Colomé -- no existe el equivalente para
    FdelMotte. Con `fdelmotte=True`, el LY se apoya SOLO en histórico real
    en vivo; un LY que cae antes de 2025-09-01 queda en "n/d", no se
    inventa ni se aproxima con la fixture de otra marca.
  - `GET /api/ventas/snap` y `GET /api/ventas/snap/mercado` aceptan
    `fdelmotte: bool = False` como query param. `ly_mensual` (solo lo usa
    la tabla comparativa de Panel de Ventas, exclusiva de Colomé) se omite
    cuando `fdelmotte=True`.
- **Frontend (`snap.js`):** reescrito de script con estado global único a
  **fábrica** `crearSnapInstance({dataElId, rootElId, qs})` -- dos
  instancias independientes corriendo en paralelo (Consolidado y
  FdelMotte), cada una con su propio `RAW`/`periodoActivo`, apuntando a
  `#snapConsolidado`/`#snapFdelMotte` y escaneando sus hijos por CLASE
  (`.stat-row`/`.sbl-table-mount`/`.period-toggle`, no por id, para poder
  repetir el mismo markup dos veces en `content.html`). El `<select
  id="snapMesSel">` del sidebar sigue siendo uno solo, compartido -- ahora
  refetchea las DOS instancias al cambiar de mes.
- **`content.html`:** `#snapFdelMotte` pasó a tener la MISMA estructura
  que `#snapConsolidado` (period-toggle + stat-row + tabla), con el
  `<h2>` aclarando "— FdelMotte".
- **`page.tsx`:** segundo fetch a `/api/ventas/snap?fdelmotte=1` y segundo
  `<script id="colome-data-fm">` inyectado antes de `snap.js`, en los dos
  `Promise.all` (fast path de Sales Performance y full path de Panel/
  Región).
- **`app.js`:** se eliminaron `rowsFdelMotte()`/`renderSnapFdelMotte()` y
  su invocación -- el toggle de pestañas (mostrar/ocultar
  `#snapConsolidado`/`#snapFdelMotte`) se mantiene, ya no dispara un
  render propio.

Detalle completo en memoria de Claude,
`proyecto_colome_ventas_fdelmotte_paridad_consolidado`.

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
