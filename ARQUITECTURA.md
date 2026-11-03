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
que Colomé recibe de Redline): **Por Cliente** (ranking de clientes),
**Por SKU** (ranking de productos) y **Por Vendedor** (Rubro→Artículo ×
Vendedor, pivot) -- las 3 rediseñadas 2026-11-02, ver subsecciones más
abajo. Filtran `d_grupo == "VINOS **"` (mismo universo que Panel de
Ventas, NO el 100% AFIP que usa Desglose por Grupo). "% MG" se decidió NO
mostrarlo (el backend sigue calculando `mg_pct`, por si se vuelve a pedir
— ver `ig_ventas.py`).

- **Backend:** `ig_ventas.py::_lineas_vinos()` (generador compartido,
  filtra TIPOS_VALIDOS+VINOS**+fecha real dentro del rango pedido -- SIN
  flip de signo manual, ver corrección 2026-10-19/20 más abajo) +
  `ventas_por_cliente/sku/vendedor()`. Las 3 pasaron a `?desde=&hasta=`
  (YYYY-MM-DD, rango libre, 2026-11-02) en `otros_analisis.py` -- `periodo`
  mensual queda solo como el default cuando no se manda rango. Sin cache
  de agregado histórico propio (ya es barato, reusa el cache por-día
  compartido).
- **Frontend:** 3 sub-pestañas en `otros-analisis/page.tsx`, cada una con
  su propio período/buscador/chips de filtro reportados al padre vía un
  callback `onFiltros` + `useEffect`, que los renderiza en el `sidebar=`
  de `AppShell` (nunca arriba de la tarjeta — ver norma de trabajo
  "Toda pantalla con layout de sidebar..."). Rubro/Vendedor son columnas
  propias con `rowSpan` por grupo en Por Vendedor (no solo texto en la
  fila de Total). Chips = checkbox real dentro de un `<label>` con pinta
  de chip (mismo patrón que `public/ventas/app.js`/`ventas.css`, clase
  `.chip`), nunca un `<button>` que solo cambia de color -- `ChipsFiltro`
  ahora también tiene un link **"solo"** por valor (`onSoloEste`, ver Por
  Vendedor más abajo), compartido por las 3 vistas.

### Por Cliente rediseñado (2026-11-02, pedido de Ariel Culasso vía Ezequiel)

Deja de agrupar fijo por Vendedor -- pasa a ser un **ranking de clientes**
(ordenado por Venta Neta desc, agregado por nombre de cliente sumando a
través de vendedor/canal), con **Vendedor/Canal como "segmentador"**: un
toggle que decide qué dimensión alimenta los chips de filtro del sidebar
(reusa `ChipsFiltro`). **Rango de fechas libre** (`RangoFechas`, 2
`<input type="date">`) reemplaza el `PeriodoSelect` de un solo mes.
Columna **"Descuento Comercial"** agregada -- revierte la decisión
2026-10-19 de omitir "% Desc C" ("no hay un campo 1 a 1... no vale la
pena estimarlo sin validar con Ariel"): el campo real es `m_desc_total`
(agregado a `CAMPOS_USADOS`), validado fila por fila contra
`(precio_unit_mon_loc - precio_neto_mon_loc) * cantidad` -- los campos
`pc_desc_uno/dos/...` (tasas % por escalón) NO sirven, vienen en 0 en
facturas que sí tienen descuento real. Cache por-día purgado en el VPS
post-deploy (campo nuevo en `CAMPOS_USADOS`, mismo gotcha de abajo).

### Por SKU rediseñado (2026-11-02, mismo día, 2do pedido de Ariel)

Deja de pivotear por Oficina -- pasa a **ranking de productos** (agregado
por artículo), con **Marca (Rubro) y Mercado (Oficina) como 2
segmentadores INDEPENDIENTES y simultáneos** (a diferencia de Por Cliente,
donde Vendedor/Canal es un toggle excluyente -- acá ambas dimensiones
filtran a la vez, 2 `ChipsFiltro` en paralelo). Rango de fechas libre.
Columnas agregadas: **Descuento Comercial** (mismo `m_desc_total`) y
**Precio Promedio** (Venta Neta ARS / Cajas9l -- criterio propio, Ariel no
especificó la base exacta; si pide otra, ej. por botella, es 1 línea de
cambiar en el frontend). **Confirmado por Ezequiel** ("el resto de la
hoja lo veo ok") salvo el orden de los filtros, corregido el mismo día:
**Mercado antes que Marca** en el sidebar -- "siempre de menos a mas (el
mercado es lo que contiene la venta de la marca)", institucionalizado en
`00-Normas-de-Trabajo.md` como regla general (dimensión contenedora
primero, dimensión contenida después, para cualquier par de filtros
jerárquicamente relacionados en cualquier proyecto).

### Por Vendedor rediseñado (2026-11-02, mismo día, 3er pedido de Ariel)

1. **Bug de UX real corregido**: el criterio de los chips (tildado=
   visible) obligaba a destildar TODOS los demás vendedores a mano para
   ver uno solo (Ariel: "me fue dificultoso seleccionar un vendedor
   particular... debemos cambiar el criterio"). Primer fix (efímero):
   `ChipsFiltro` ganó un link "solo" que aislaba un valor con un click --
   reemplazado el mismo día por la inversión de semántica del punto
   siguiente, que hace innecesario ese link.
2. Rango de fechas libre, **vista acumulada** (la tabla principal sigue
   sumando todo el rango sin desglosar por mes).
3. **Drill-down de tendencia -- intentado y descartado el mismo día.**
   Se probaron 2 variantes (panel "Tendencia por período" visible solo al
   aislar 1 vendedor, después "siempre visible con Total") usando el
   campo `periodo` que viaja en cada fila agregada por
   `ventas_por_vendedor()`. Ezequiel terminó pidiendo sacarlo del todo
   ("no, sacalo del todo") -- Por Vendedor NO tiene drill-down de
   tendencia, solo la tabla principal acumulada. El campo `periodo` sigue
   en el backend por si se retoma a futuro.
4. **Descuento Comercial** agregado como 3ra sub-columna por vendedor.
   Margen queda pendiente para una iteración futura (Ariel: "dps le
   agregaremos el margen"). Orden de columnas corregido el mismo día
   (Ezequiel): Cantidad/Venta Neta/Descuento Comercial (no Cantidad/
   Descuento/Venta Neta), tanto en la tabla principal como en el panel
   de tendencia.
5. **Bug real corregido el mismo día** (Ezequiel: "los subtotales no veo
   que sumen"): la fila "Total {rubro}" dejaba en blanco las celdas de
   Cantidad/Descuento Comercial por vendedor, solo mostraba el total
   general de la derecha -- `totalPorVendedor` (Map por grupo) ahora suma
   cantidad/ars/descuento de cada vendedor a través de las filas del
   rubro.

### `ChipsFiltro`: semántica invertida (2026-11-02, mismo día, pedido de Ezequiel)

Ezequiel, al ver el filtro de Vendedor de Por Cliente recién entregado:
*"deberia venir todo destildado (para mostrar todo). si se filtra 1, 2 o
3, muestre solo de esos vendedores. asi en las 3 pestañas"*. Antes:
tildado=visible, TODO tildado por default (criterio que había motivado el
link "solo" del punto 1 de arriba). Ahora: `seleccionados` (antes
`ocultos`) vacío = sin filtro, se muestra TODO; 1+ valores tildados = se
muestra SOLO esos -- ningún chip arranca tildado. El link "solo" queda
redundante (tildar 1 solo valor ya hace lo mismo) y se saca, reemplazado
por "Limpiar" (visible solo con algo tildado). Aplicado a los 3 filtros de
chips de la pantalla (Por Cliente Vendedor/Canal, Por SKU Marca/Mercado,
Por Vendedor Vendedores). **Institucionalizado en
`00-Normas-de-Trabajo.md`** (regla nueva, aplica a cualquier filtro de
chips de cualquier proyecto, no solo Colomé-Ventas).

### Encabezados ordenables por click (2026-11-02, mismo día, pedido de Ezequiel)

*"sabes que le falta a las 3 pestañas? que se pueda ordenar al hacer clic en el encabezado"*. `SortTh`/`ordenar()` genéricos (helpers al tope de `otros-analisis/page.tsx`) -- 1er click en una columna ordena desc, 2do click invierte a asc, click en otra columna reinicia en desc, indicador ▲/▼ en la columna activa.
- Por Cliente/Por SKU (rankings planos): todas las columnas numéricas + la de nombre son ordenables, sin restricción.
- Por Vendedor (tabla PIVOT, caso distinto): Rubro ordena los GRUPOS; Artículo/Total Venta Neta ordenan las filas DENTRO de cada grupo. Las sub-columnas por vendedor (Cant./Venta Neta/Desc. Com., una tripleta por cada vendedor) **también se hicieron ordenables** (mismo día, 2da vuelta -- Ezequiel: "cantidad, venta neta y desc. no se pueden ordenar?"): no son ambiguas, cada una ordena SOLO su propio vendedor. `ColVendedor` extendido a un template literal type `` `v:${vendedor}:${metrica}` `` para codificarlas como columnas ordenables independientes.

Las 3 verificadas en vivo (Claude-en-Chrome). Detalle completo en memoria
de Claude, `proyecto_colome_ventas_rediseno_por_cliente_ariel`.

### Outage de producción, mismo día (causa raíz NO relacionada con el código de la UI)

Durante la verificación en vivo del punto anterior, el tablero completo quedó inaccesible para todos los usuarios por varios minutos ("no carga el tablero directamente", "no anda el tablero"). Causa raíz: `ig_ventas.py::_fetch_dia_remoto` hace fetch SÍNCRONO (`urllib.request`) a la API externa de Redline dentro de un endpoint `async def` de FastAPI con un solo worker uvicorn -- mientras un request recorre un rango de fechas sin cachear (hasta ~30 días, con reintentos síncronos), bloquea el ÚNICO event loop del proceso para TODOS los requests, de cualquier usuario, de cualquier pantalla (confirmado en logs de Traefik: requests de 180s a 430s en `/`, `/otros-analisis/`, `/api/otros-analisis/por-vendedor`). Mitigado reiniciando el servicio (`docker service update --force colome_colome-ventas`) -- **el riesgo de fondo sigue vigente**, cualquier usuario real que pida un rango sin cachear puede repetirlo. Fix arquitectural pendiente (migrar el fetch a async/`run_in_executor`), no implementado todavía. Detalle completo en memoria de Claude, `proyecto_colome_ventas_outage_blocking_io_otros_analisis`.

### Composición "por factura" en ventana flotante -- agregada 2026-11-02, SACADA del todo 2026-11-03

*"por cliente, por sku y por vendedor, podremos mostrar la composicion en una ventana flotante?"* → *"por factura"* (2026-11-02). Click en una fila/celda abría un popup con las facturas REALES que componían ese total. **El mismo día siguiente (2026-11-03) Ezequiel cambió de criterio en las 3 vistas** -- ver subsección de abajo, "Drill-down agregado (Marca/Producto o Cliente), no por factura": `ig_ventas.py::detalle_por_factura()`, el endpoint `/api/otros-analisis/detalle-facturas` y `ComposicionModal` (frontend) quedaron sin ningún consumidor y se sacaron DEL TODO del repo (no quedó código muerto). Si hace falta reconstruir ese patrón ("por factura"), está completo en el historial de git (commits del 2026-11-02) y en memoria de Claude, `proyecto_colome_ventas_composicion_por_factura`.

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

### Drill-down agregado (Marca/Producto o Cliente), no por factura (agregado 2026-11-03)

3 pedidos de Ezequiel el mismo día, aplicados secuencialmente a las 3
vistas: Por Cliente ("el drill-down, no tiene que ser por factura, tiene
que ser por marca - producto"), Por SKU ("por sku, tenemos que aplicar el
mismo criterio. el drill down es por cliente, no por factura") y Por
Vendedor ("por ultimo, por vendedor, no hagas la apertura por factura" --
el reemplazo concreto, "Desglose por Cliente" igual que Por SKU, se
confirmó con el usuario antes de implementar, el pedido no lo
especificaba).

- **Por Cliente → Marca/Producto:** `ig_ventas.py::ventas_cliente_por_marca_producto(desde,
  hasta_incl, cliente)` -- agrega `_lineas_vinos()` filtrado a UN cliente
  por (Marca=`d_rubro`, `c_articulo`, `d_articulo`). Endpoint `GET
  /api/otros-analisis/por-cliente/marca-producto?desde=&hasta=&cliente=`.
  Frontend: `DesgloseMarcaProductoModal` -- Marca/Producto/Cajas9l/Venta
  Neta/Descuento Comercial/% Desc./Precio Promedio (mismo criterio visual
  que la tabla de Por SKU).
- **Por SKU y Por Vendedor → Cliente:** `ig_ventas.py::ventas_producto_por_cliente(desde,
  hasta_incl, c_articulo, *, vendedor=None)` -- agrega por cliente
  filtrado a 1 `c_articulo` (+ opcionalmente 1 `vendedor`, para la celda
  vendedor×artículo del pivot de Por Vendedor). Endpoint `GET
  /api/otros-analisis/por-sku/cliente?desde=&hasta=&c_articulo=&vendedor=`
  (reusado por las 2 vistas). Frontend: `DesgloseClienteModal` --
  Cliente/Cajas9l/Venta Neta/Descuento Comercial/% Desc.
- Mismo campo real de descuento (`m_desc_total`) y mismo criterio de
  `mg_pct` que `ventas_por_sku` en las 2 funciones nuevas.
- **Bug #1 corregido el mismo día** (Ezequiel: "por vendedor el drill
  down no me esta coincidiendo la cantidad"): `DesgloseClienteModal`
  mostraba "Cajas9l" -- pero la tabla PROPIA de Por Vendedor nunca tuvo
  esa columna, solo "Cant." (unidades sueltas, `ventas_por_vendedor`
  nunca agrega cajas9l). El usuario comparaba magnitudes distintas. Se
  sacó la columna "Cantidad" del modal del todo -- queda 1 sola métrica
  "Caja de 9" en Por SKU y Por Vendedor (Ezequiel: "caja de 9 es lo que
  normaliza el dato, sino no es comparable").
- **Bug #2 corregido el mismo día** (Ezequiel: "no se que hiciste, pero
  sigo viendo inconsistencia"). Verificado primero contra la API real en
  producción (fetch directo) antes de tocar código: `ars`/`descuento`
  coincidían EXACTO entre la celda y la suma del drill-down -- la capa de
  datos estaba bien. La causa real era redondeo: "Caja de 9" seguía
  usando `fmtNum` (0 decimales) -- a nivel de 1 cliente dentro de 1
  producto(+vendedor), `cajas` es fraccionario chico (ej. 0.4998, 0.4166,
  0.4166), cada fila redondeaba a "0" pero el Total (suma real) a "1".
  Fix: `fmtCajas` (2 decimales), usado en los 2 popups de drill-down
  (`DesgloseMarcaProductoModal` y `DesgloseClienteModal`) -- las tablas
  principales siguen con `fmtNum`, ahí `cajas` ya viene agregado a nivel
  producto completo.
- **3er pedido, mismo día** (Ezequiel, citando el subtítulo de la
  pantalla: "sigue sin reemplazar cant. por caja de 9"): el fix #2 solo
  tocó los popups -- la tabla PRINCIPAL de Por Vendedor seguía con su
  columna histórica "Cant." (`cantidad`, unidades sueltas), porque
  `ventas_por_vendedor()` nunca agregaba `cajas9l` (a diferencia de
  `ventas_por_cliente`/`ventas_por_sku`). Fix: `ventas_por_vendedor()`
  ahora agrega también `cantidad_cajas9l` (campo `cajas`, `cantidad` se
  deja en la respuesta por compatibilidad pero ya no se consume en el
  frontend). La sub-columna por vendedor pasa de "Cant." a "Caja de 9"
  (`fmtCajas`, 2 decimales).

Verificado en vivo (Claude-en-Chrome), las 3 vistas: Por Cliente, click en
"MIRAFLORES SRL" abrió AMALAYA/COLOME/ALTURA MAXIMA por producto (%Desc
58-65%, coherente con el 60.4% del ranking). Por SKU, click en "AMALAYA
MALBEC" abrió el desglose por cliente (MIRAFLORES SRL 61.8%, consistente
con lo anterior). Por Vendedor, click en la celda Venta Neta de "ALTURA
MAXIMA MALBEC"×"ANA MOUNIER" abrió el desglose con 3 clientes, Total
$891.956 coincide EXACTO con la celda original de la tabla pivot. Detalle
completo en memoria de Claude,
`proyecto_colome_ventas_drilldown_cliente_marca_producto`.

### Columna "% Descuento" en las 4 tablas con Descuento Comercial (agregado 2026-11-03)

Pedido explícito de Ezequiel: *"en otros analisis, en todas las tablas que
pusimos descuento comercial, debemos agregar una columna con el % de
descuento"*. `ars` (venta neta, `valor_mon_loc`) ya viene DESPUÉS de
aplicar el descuento -- venta bruta = `ars + descuento`, `%Desc =
descuento / (ars + descuento)`. Helper `fmtPct(descuento, ars)` en
`otros-analisis/page.tsx`, 100% frontend (no se tocó `ig_ventas.py`/
`otros_analisis.py` -- `ars`/`descuento` ya viajaban en cada fila).
Columna agregada en Por Cliente, Por SKU, Por Vendedor (pivot -- 4ta
sub-columna por vendedor, `colSpan` por vendedor pasó de 3 a 4) y los
popups de composición por factura que existían en ese momento (desde
2026-11-03 son los popups de drill-down agregado, ver subsección de
arriba). No es ordenable (header plano, no `SortTh`) -- no se pidió.
Detalle completo en memoria de Claude,
`proyecto_colome_ventas_pct_descuento_otros_analisis`.

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

## Filtro previo "Agrupante de Marca" en Panel de Ventas (agregado 2026-11-03)

Pedido explícito de Ezequiel: el Panel de Ventas venía pre-filtrado tildando
a mano todas las marcas menos FdelMotte -- mismo problema conceptual que el
de Canal, resuelto con el mismo patrón: filtro PREVIO que agrupa los 5
valores crudos de Brand (`d_rubro`, universo `GRUPO_VALIDO = "VINOS **"`)
en 2 agrupantes ("Colomé & Amalaya" y "Familia del Monte"), SIN sacar el
filtro de Brand detallado.

- **Valores reales confirmados en vivo (2026-11-03):** `ALTURA MAXIMA **`,
  `COLOME **`, `AMALAYA **` y `TERROTORIO **` (typo real del ERP, no es un
  bug de la app) van a "Colomé & Amalaya"; `FDELMOTTE **` va a "Familia del
  Monte".
- **Catálogo:** `marca_agrupante_mapa` (`database.py`) -- 1 `brand` -> 1
  `agrupante`, mismo criterio que `canal_agrupante_mapa` (catálogo fijo
  editable a mano, no auto-sincronizado).
- **Backend:** `panel_ventas.py::panel_ventas()` agrega
  `dims["brand_agrupante"]` a `/api/ventas/panel` -- array paralelo a
  `dims["brand"]`.
- **Frontend (`app.js`):** sidebar agrega "Agrupante de Marca" ARRIBA de
  "Brand", mismo mecanismo de chips que Agrupante de Canal. El default
  histórico ("todo tildado menos FdelMotte") ahora sale del agrupante
  "Familia del Monte" en vez de buscar el string "DELMOTTE" a mano
  (`FDELMOTTE_IDX` eliminado). El botón "Limpiar filtros" ahora llama
  `buildSidebar()` completo para que los chips de ambos agrupantes
  (Canal y Marca) queden consistentes tras limpiar.
- **Datos Maestros:** nueva pestaña "Agrupante de Marca"
  (`frontend/src/app/datos-maestros/page.tsx::MarcaAgrupanteMapa`), mismo
  patrón visual que Canal/Jurisdicción.
- **Sin control de integridad dedicado** (a diferencia de Canal): con solo
  5 valores fijos no se justificó agregar un chequeo "marcas sin
  agrupante" de oficio -- si aparece una 6ta marca algún día, se clasifica
  a mano desde Datos Maestros.

Detalle completo en memoria de Claude,
`proyecto_colome_ventas_agrupante_marca`.

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

**ESTA DECISIÓN QUEDÓ REVERTIDA el 2026-11-02** -- ver "FdelMotte:
estructura real del SNAP" más abajo. La paridad de INFRAESTRUCTURA
(fábrica `crearSnapInstance`, fetch en vivo, sin pipeline viejo separado)
sigue vigente; lo que cambió es que la pestaña FdelMotte dejó de MOSTRAR
la misma jerarquía Sales by Line of Business que Colomé.

## FdelMotte: estructura real del SNAP (2026-11-02, reemplaza la paridad con Consolidado de arriba)

Ezequiel mostró el SNAP real de FdelMotte (de Ariel): 2 tablas
independientes, cada una con su propio "Grand total" -- nunca la
jerarquía Domestic/Export/DTC sub-líneas/BOB/Intercompany de Colomé, que
hasta ahora se reusaba tal cual para esta pestaña (ver sección de arriba).

- **Por variedad**: agrupa directo por `d_articulo` -- mapea 1 a 1 con
  las 6 variedades reales (FAMILIA DELMOTTE CLASICO/NATURAL/GSM TINTO/
  ASSEMBLAGE BLANCO/BONARDA/CORBEAU NATURAL), sin clasificación manual.
  `d_marca` NO sirve (p. ej. "FDM BONARDA" es el mismo valor para Bonarda
  Y Corbeau Natural).
- **Por canal**: `DOMESTIC_WHOLESALE`->Grupo Colome Domestic,
  `DTC_HOSPITALIDAD`->Familia Delmotte Direct (juntos en 1 solo canal,
  FdelMotte no tiene las sub-líneas propias de Colomé), `EXPORT`->Grupo
  Colome Export. Mapeo de "Direct" CONFIRMADO con Ezequiel (vía
  AskUserQuestion) -- su imagen de referencia tenía un "Direct" de
  $221,6k que no cierra con ningún dato real bajable de Redline en
  oct-2026 (toda la venta de esa fecha cae en "Domestic"); se reclasificó
  igual DTC+HOSPITALIDAD como Direct, sin perseguir ese número puntual.
- **Moneda ARS, no USD** (a diferencia del SNAP de Colomé) -- validado
  que el total reconcilia exacto contra la imagen de referencia
  dividiendo `valor_mon_loc` por 1000.
- **Backend (`snap.py`):** `ventas_fdelmotte(desde, hasta_incl)` ->
  `{"por_variedad": [...], "por_canal": [...]}`. `GET /api/ventas/snap
  ?fdelmotte=1` devuelve `fdelmotte_variedad_mes/ytd` +
  `fdelmotte_canal_mes/ytd` en vez de `sbl_mes/sbl_ytd`.
- **Frontend (`snap.js`):** `crearSnapInstance` gana flag `esFdelMotte`
  -- rama de render separada (`renderFdelmotte`, 2 tablas planas sin
  popup "Sales by Market", que asumía la clasificación SBL de Colomé).
- **Bug real corregido validando en vivo:** el Grand total LY de "Por
  canal" no coincidía con el de "Por variedad" (deberían ser el MISMO
  universo) -- un canal con venta real el año pasado pero CERO en el
  actual ("Grupo Colome Export") perdía su LY de la suma porque el loop
  solo recorría los labels del período actual.
- **Lista de filas FIJA (mismo día, 2da confirmación de Ezequiel):**
  "estas son las lineas que se tienen que ver... no otras... esto es
  solo para la pestaña del snap de familia del monte" -- a diferencia
  del resto del SNAP (una categoría sin mapear cae en "Sin clasificar",
  SIEMPRE visible, para nunca esconder plata), acá Ezequiel pidió
  explícito lo OPUESTO para esta pestaña puntual: lista CERRADA.
  `FDELMOTTE_VARIEDADES_ORDEN`/`FDELMOTTE_CANALES_ORDEN` (listas fijas,
  orden fijo -- no por valor desc) reemplazan el loop dinámico sobre
  `agg.keys()`/unión de labels del bug de arriba; el Grand total suma
  SOLO esas 6/3 filas. Si se agrega/saca una variedad de FdelMotte a
  futuro, hay que tocar estas listas a mano -- ya no es automático.

- **2 fixes más, mismo día:** 1) columnas desalineadas entre las 2
  tablas -- cada una autoajustaba el ancho de su columna de etiqueta
  según su propio texto más largo (variedades más largas que canales).
  Fix: `table-layout:fixed` + `<colgroup>` con el MISMO ancho de 1ra
  columna en las 2. 2) "Fantasma" real (Ezequiel: "me costo que lo
  muestre, me mostraba primero... el sales performance consolidado") --
  el listener del toggle Consolidado/FdelMotte vivía en `app.js`, que
  carga en SEGUNDO PLANO (Etapa 2 de `page.tsx`) al entrar directo a
  Sales Performance; clickear "FdelMotte" antes de que `app.js`
  terminara de cargar no hacía nada (el radio se tildaba pero el `<div>`
  no cambiaba). Fix: el listener se mueve a `snap.js` (Etapa 1, rápido).

Detalle completo en memoria de Claude,
`proyecto_colome_ventas_fdelmotte_estructura_real_snap`.

## Fix: nav Panel/Región/Sales Performance roto (2026-11-02)

El refactor de FdelMotte de arriba (`6d61ebc`, 2026-10-29) convirtió el
`RAW` de `snap.js` en una variable **local** a cada instancia de
`crearSnapInstance`. `app.js` nunca se actualizó: `lyMes()`/`snapRef()`
seguían leyendo un `RAW` global que ya no existía, tirando
`ReferenceError: RAW is not defined` dentro de `renderPanel()` -- llamada
sin `try/catch`, de forma síncrona, **antes** de `show()` y de
`window.addEventListener('hashchange', ...)` al final de la IIFE de
`app.js`. El throw cortaba el resto del script: nunca se registraba el
listener de hashchange, así que clickear cualquier pestaña del nav
(Panel de Ventas/Ventas por Región/Sales Performance) cambiaba la
URL/el resaltado (eso lo maneja `Header` en `AppShell.tsx`, componente
React aparte) pero el contenido quedaba congelado en lo que fuera
visible por defecto en `content.html` (Sales Performance) -- bug real en
producción desde el 2026-10-29 hasta este fix, reportado por un cliente.

**Fix (commit `a4bd749`, 2026-11-02):**
- `app.js` declara su propio `const RAW = JSON.parse(document
  .getElementById('colome-data').textContent)` al tope de la IIFE (mismo
  patrón que ya usa `snap.js::poblarSelectorMes()`) -- siempre lee el
  Consolidado, nunca FdelMotte (Panel de Ventas/Región son cifras
  consolidadas, no tienen vista FdelMotte propia).
- La llamada inicial a `renderPanel()` (antes de `show()`) se envolvió en
  `try/catch` -- un error ahí nunca debe volver a dejar sordo el resto
  del script.

Verificado en vivo (Claude-en-Chrome contra producción): las 3 pestañas
cambian de contenido real, sin errores de consola. Detalle completo en
memoria de Claude, `proyecto_colome_ventas_fix_nav_rota_raw_fdelmotte`.

**Lección para cualquier refactor futuro de `snap.js`/`app.js`:** ambos
archivos comparten estado vía variables globales inyectadas por script
dinámico (no hay un bundler ni imports entre ellos) -- un cambio de
"global" a "scoped" en uno de los dos sin tocar el otro rompe la
navegación COMPLETA de forma silenciosa (sin error visible en pantalla,
solo en consola). Re-clickear el nav de las 3 pestañas en vivo después
de cualquier cambio en estos dos archivos, no alcanza con que compile.

## Budget real por línea en Sales by Line of Business (agregado 2026-11-02)

Revierte la decisión del 2026-10-09 ("Budget sacado, nunca existió un dato
real") -- se basaba en `YTD - Snap - ly.xlsx`, donde esa columna venía
vacía.

**Primer intento (descartado el mismo día):** Ezequiel compartió `SNAP I
September 2026 - NM - VSP 2.xls`, hoja "Sales by line of bussines" (SÍ
trae Budget por línea, Monthly y YTD) -- se extrajo de ahí, pero el TOTAL
no coincidía centavo a centavo con `budget_2026_2027.json` (Budget TOTAL
de Panel de Ventas, fuente `Budget_Dinamico.xlsx`, ~1.5-2% de diferencia).
Ezequiel: *"no podemos usar fuentes distintas"* -- descartado.

**Fuente final, ÚNICA con Panel de Ventas:** `Budget_Dinamico.xlsx`
clasificado por línea de negocio vía el campo `Mercado` (no `Canal`, que
solo distingue "Mercado Local"/"Exportación"): `E-commerce`→E-commerce;
`Distrib. Bs. As.`/`Interior`/`Distrib. NOA`→Grupo Colome Domestic;
`HCVC - Hotel`→Colome Hotel; `HCVC - VC Col`→Colome Visitor Center;
`HCVC - VC Cafa`→Cafayate Visitor Center; el resto (UE/Brasil/Reino
Unido/USA/Suiza/Asia/Canadá/Resto L.A./Caribe/México)→Grupo Colome
Export. `Employees` sin `Mercado` propio en el archivo -- 0 fijo (igual
que en el SNAP real). **Validado exacto**: la suma de las 7 líneas de
cada mes reproduce `budget_2026_2027.json` centavo a centavo (±0.01 de
redondeo) en los 12 meses del ejercicio 2026-2027.

- **Fixture:** `backend/budget_linea_2026_2027.json` -- `{periodo YYYY-MM:
  {línea: [usd, cajas]}}`, cobertura completa jul-2026 a jun-2027 (los 12
  meses de `Budget_Dinamico.xlsx`).
- **Backend (`snap.py`):** `_agregado_budget_linea(desde, hasta_incl)` suma
  por rango de meses calendario -- `None` si falta la fixture de algún mes
  del rango (nunca aproxima un rango parcialmente cubierto). `_fila()`/
  `_sumar()` extendidas con `usd_bud`/`lit_bud`/`usd_vs_bud`/`lit_vs_bud`,
  mismo patrón que ya usan para Last Year. "Sin clasificar" (sin fila
  propia en el SNAP real) queda fijo en Budget=0, igual que BOB/
  Intercompany vía `_cero()` -- si no, el Budget de TOTAL SALES TO THIRD
  PARTIES/TOTAL SALES caería a "n/d" por ese residuo. `fdelmotte=True`
  nunca tiene Budget por línea (no hay reporte SNAP propio de FdelMotte).
- **Frontend (`snap.js::renderSbl`):** columnas Budget/% vs Bud agregadas
  a la tabla de Sales by Line of Business (Sales Value y 9 Litre
  Equivalent), mismo patrón visual que la Tabla comparativa anual de
  Panel de Ventas.

**Si se carga un Budget nuevo a futuro**, regenerar AMBAS fixtures
(`budget_2026_2027.json` y `budget_linea_2026_2027.json`) desde el mismo
archivo con el mismo mapeo -- nunca una sola, para no reabrir el drift.

Verificado en vivo (Claude-en-Chrome): TOTAL SALES Budget de Oct 2026 en
Sales Performance ($846k) exacto contra el Budget TOTAL de Panel de
Ventas para el mismo mes (`budget_2026_2027.json`, $846.460,55). Detalle
completo en memoria de Claude, `proyecto_colome_ventas_budget_por_linea_snap`.

## Panel de Controles — claridad para no-técnicos (2026-11-02, commit `d39d53a`)

Pedido de Ezequiel: *"en controles, no le queda claro a la gente como
corregirlo o que es lo que esta faltando"*. Tres campos de texto libre
sin ninguna pista de los valores válidos (typo = registro nuevo
invisible, nunca se une al real) y un ítem con un string crudo sin
etiquetar:

- `datos-maestros/page.tsx`: campo "Línea de negocio" (alta y edición)
  pasa de `<input>` a `<select>` con `LINEAS_NEGOCIO_VALIDAS` (las 5
  líneas fijas, mismo conjunto que `DTC_LINEAS_FIJAS` en `snap.py`).
- `controles/page.tsx::CorregirCanalAgrupanteModal`: fetch a
  `/api/datos-maestros/canal-agrupante`, `<select>` con los agrupantes
  ya en uso + "Otro (ninguno de estos)…" que revela un `<input>` de
  respaldo.
- `controles/page.tsx`: explicación corta en criollo (👉) debajo de cada
  control con error, específica por `id` (`jurisdiccion_sin_clasificar`,
  `sbl_sin_clasificar`, `canal_sin_agrupante`).
- `controles/page.tsx`: ítem de `sbl_sin_clasificar` pasa de un string
  crudo (`Centro de Costo / Categoría / Canal de Venta` sin etiquetas)
  a 3 líneas etiquetadas, usando campos que el backend ya mandaba
  (`it.centro_costo`/`it.categoria`/`it.canal_venta`, sin tocar backend).

Detalle completo en memoria de Claude,
`proyecto_colome_ventas_controles_mas_claros`.

## Controles: Cruce AFIP avisa mes cerrado sin cargar (agregado 2026-11-03)

Pedido explícito de Ezequiel: *"cruce afip no esta pidiendo la info de
octubre, esta controlando a octubre a pesar que ya estamos en noviembre
y cerró octubre"*. Causa real: `_rango_a_chequear()` arma el rango a
controlar leyendo `MIN/MAX(periodo)` de `afip_comprobantes` -- depende
de lo que YA se cargó a mano a Info AFIP, no del calendario. Si nadie
sube el export del mes recién cerrado, el control seguía "Al día" en
silencio sobre el último mes sí cargado (verificado en vivo antes del
fix: rango hasta `2026-09-30`, `ok: true`, aunque octubre ya había
cerrado).

- **Backend:** `_ultimo_mes_cerrado()` nuevo en `controles.py`
  (duplicado liviano de `_mes_cerrado_anterior()` de `snap.py`). El
  control `cruce_afip` compara el fin del rango ya cargado contra el fin
  del último mes calendario cerrado -- si quedó atrás, `ok=False` y
  `detalle` dice explícito `"Falta cargar Info AFIP de <YYYY-MM> (ya
  cerrado)"`, antepuesto a cualquier diferencia de moneda real.
- No se tocó `_rango_a_chequear()` en sí -- los otros 3 controles de la
  pantalla (Jurisdicciones/SBL/Canal sin clasificar) siguen igual.

Verificado en vivo: tras el fix, `/api/controles` → `{"ok": false,
"detalle": "Falta cargar Info AFIP de 2026-10 (ya cerrado)"}`, visible
en pantalla como fila naranja. Detalle completo en memoria de Claude,
`proyecto_colome_ventas_cruce_afip_mes_pendiente`.

**Pendiente relacionado, del mismo pedido de Ezequiel (NO
implementado, diagnosticado solamente -- ver memoria de Claude
`proyecto_colome_ventas_pendientes_controles_budget_region`):**
Ventas por Región (el mapa) no muestra LY -- recomendación dada:
agregarlo como una 4ta vista "Por Región" en Otros Análisis en vez de
al mapa, para no complicar la lectura geográfica.

## Panel de Ventas: filtro previo "Agrupante de Región" (agregado 2026-11-03)

Pedido explícito de Ezequiel: *"las regiones no estan diagramadas y
configuradas mediante datos maestros"*. "Región" era `zona` =
`d_zona_comercial` crudo de Redline, sin ningún mapeo -- mismo problema
que tenían Canal y Marca antes de sus agrupantes. Relevados en vivo los
11 valores reales (`DTC, BUENOS AIRES, NOA, INTERIOR, UK, EUROPE,
CARIBBEAN, UNITED STATES, LATIN AMERICA, CANADA, ASIA`), agrupados en
Doméstico/Exportación (confirmado por Ezequiel, mismo criterio que ya
usan Budget/SNAP, Grupo Colome Domestic/Export).

- **Backend:** `region_agrupante_mapa` (`database.py`) -- mismo patrón
  que `canal_agrupante_mapa`/`marca_agrupante_mapa`. CRUD en
  `datos_maestros.py` (`/api/datos-maestros/region-agrupante`).
  `panel_ventas.py` agrega `dims["zona_agrupante"]`, paralelo a
  `dims["zona"]`.
- **Frontend:** `app.js` agrega sección "Agrupante de Región" en el
  sidebar, arriba de "Región" -- mismo mecanismo de chips que Canal/
  Marca. `datos-maestros/page.tsx` gana una 5ta pestaña (`?tab=region`).

Verificado en vivo: tildar "Doméstico" tildó automáticamente Buenos
Aires + DTC y filtró el total a $1.489.633. Detalle completo en
memoria de Claude, `proyecto_colome_ventas_agrupante_region`.

### País → Región: tabla editable que reemplaza la asignación cruda del ERP (agregado 2026-11-03, mismo día)

Ezequiel preguntó *"donde veo la parametrizacion de que alemania entra
en europe?"* -- investigado en vivo: `zona` viene 100% crudo del ERP,
NINGUNA regla nuestra decide esa asignación (confirmado: toda fila con
`pais=ALEMANIA` trae `zona=EUROPE` directo de Redline). Pidió entonces:
*"quiero que crees una tabla en datos maestros que sea la regla para
esta hoja... si ariel culasso quiere hacer un cambio de region en un
pais lo va a poder editar desde datos maestros"*.

Relevado en vivo: de 31 países reales, 30 mapean 1 a 1 a una sola zona
-- Argentina es la única excepción (4 zonas por su desglose doméstico
interno, DTC/Buenos Aires/NOA/Interior) y queda FUERA de esta tabla a
propósito (bloqueado explícito en el POST).

- **Backend:** `pais_zona_mapa` (`database.py`), sembrada como espejo
  EXACTO del dato crudo actual (0 cambios de comportamiento al
  desplegar). CRUD en `datos_maestros.py`
  (`/api/datos-maestros/pais-zona`). `ig_ventas.py::facts_panel_ventas()`
  gana el parámetro `pais_zona_override: dict[str, str]`, aplicado
  DENTRO de la función, sustituyendo el campo `zona` de cada fila
  agregada según su `pais` ANTES de codificar a `dims`/`facts` -- corre
  para Panel de Ventas, Ventas por Región y el Agrupante de Región a la
  vez (los 3 consumen el mismo `dims["zona"]` resultante). No requiere
  invalidar ningún cache: `PANEL_AGG_CACHE` sigue guardando la zona
  CRUDA, el override se aplica fresco en cada request. `panel_ventas.py`
  pasa `get_pais_zona_map()` como ese parámetro.
- **Frontend:** `datos-maestros/page.tsx` gana una 6ta pestaña "País →
  Región" (`?tab=pais-zona`).

Verificado con smoke test (datos sintéticos) antes de desplegar, y en
vivo después: total general y zona de Alemania sin cambios (espejo
exacto, como se diseñó). Detalle completo en memoria de Claude,
`proyecto_colome_ventas_pais_zona_mapa`.

## Budget: pantalla editable real (agregado 2026-11-03)

Pedido explícito de Ezequiel: *"La hoja Budget no esta mostrando la tabla
con el Budget actual cargado. La idea es que se lea y edite desde ahí"*.
`budget/page.tsx` era literalmente un `<Placeholder>` -- nunca se
construyó pantalla real, aunque el Budget SÍ se usa en vivo (Panel de
Ventas, tabla comparativa; Sales Performance, Budget por línea). Los
datos vivían en 2 archivos JSON estáticos committeados al repo
(`budget_2026_2027.json`/`budget_linea_2026_2027.json`, fuente
`Budget_Dinamico.xlsx` de Ariel), ilegibles/editables desde la app.

- **`database.py`:** 2 tablas nuevas, `budget_mensual` (`periodo` PK,
  `usd`, `cajas`) y `budget_linea_mensual` (`periodo`+`linea` PK
  compuesta). Sembradas UNA sola vez desde esos mismos JSON en
  `init_db()` -- los JSON quedan en el repo como fixture histórica, ya
  no se leen en runtime.
- **`budget.py`** (módulo nuevo): `get_budget_mensual()`/
  `get_budget_linea_mensual()` (mismo shape de retorno que los JSON
  originales, cache en memoria) + CRUD admin-only (`PUT /api/budget/
  {periodo}`, `PUT /api/budget/{periodo}/linea/{linea}`, UPSERT).
  `LINEAS_VALIDAS` = las 7 líneas fijas de `snap.py`
  (`DTC_LINEAS_FIJAS` + Grupo Colome Domestic/Export).
- **Invalidación de cache en cascada:** cada escritura llama
  `snap.limpiar_snap_cache()` además de limpiar el cache propio -- el
  Budget alimenta filas YA CACHEADAS de `ventas_sbl()` (`usd_bud`/
  `lit_bud`, cacheadas en disco por `SNAP_RANGE_CACHE`, ver sección de
  Sales Performance más abajo) -- sin esto, editar el Budget no se
  reflejaría en Sales Performance hasta que cambiara el mes disponible.
- **`snap.py`:** `_budget_mensual`/`_budget_linea_mensual` pasan a ser
  imports directos de `budget.py` (`from budget import
  get_budget_mensual as _budget_mensual`) -- mismo nombre de función a
  nivel de módulo, CERO cambios en el resto de `snap.py`.
- **`Dockerfile`:** `backend/budget.py` agregado al `COPY` explícito
  (norma del proyecto -- un archivo nuevo que no se agrega ahí crashea
  en runtime, ver gotcha de cache más abajo en este doc).
- **Frontend (`budget/page.tsx`):** 1 tabla, 12 filas (períodos del
  ejercicio 2026-2027), columnas Total + 7 líneas × (USD/Cajas9l) --
  mismo patrón visual que la tabla pivot de Por Vendedor (Otros
  Análisis). Edición inline: admin ve cada número como botón
  clickeable que se vuelve `<input type="number">`, guarda solo al
  perder foco (blur), sin botón "Guardar" aparte. Cajas9l con 2
  decimales (`fmtCajas`).

**Verificado:** smoke test local (`init_db()` siembra 12 meses, UPSERT
de ambas tablas, `import snap` sin ciclo) + lectura real en producción
(Total ejercicio = USD 10.556.951 / 185.062,75 cajas, coincide EXACTO
con el "control" histórico de Ariel; `usd_bud` de octubre en `/api/
ventas/snap` sin cambios). La escritura NO se probó en vivo -- el
clasificador de seguridad bloqueó escribir un valor de prueba en
producción (correcto, es un dato financiero real); la lógica UPSERT se
validó solo contra una DB de prueba local.

### 2da vuelta, mismo día: detalle por SKU (hoja "Datos")

Ezequiel: *"te quedaste corto con la vista del budget, deberiamos
cargar la hoja datos"* -- la hoja "Datos" de `Budget_Dinamico.xlsx`
(ruta real: `Compañias\Colome\Informacion recibida\`, FUERA del repo),
2.329 filas SKU × Mes × Canal × Mercado, la granularidad real detrás
de los 2 JSON agregados. Pedido explícito: *"verificá antes que no nos
cambia el numero actual"* -- comparado (script Python fuera del repo)
contra `budget_2026_2027.json`/`budget_linea_2026_2027.json`: coincide
EXACTO (diferencia máxima $0.12 en 12 meses, redondeo flotante).
Confirmado el OK, pidió *"subamos todo y que cada fila tenga un boton
de editar para cambiar los montos o cantidades"*.

- `budget_detalle_2026_2027.json` (nuevo): las 2.329 filas con
  `periodo` ya calculado.
- `database.py`: tabla `budget_detalle`, sembrada desde ese JSON.
- **`budget_mensual`/`budget_linea_mensual` pasan a estar en desuso**
  -- `get_budget_mensual()`/`get_budget_linea_mensual()` ahora agregan
  EN VIVO sobre `budget_detalle` (clasificación Mercado→línea portada
  a `budget.py::MERCADO_A_LINEA`). Mismo criterio "no podemos usar
  fuentes distintas" que Sales Performance -- Total/Línea nunca pueden
  desincronizarse del detalle real.
- Endpoints nuevos: `GET /api/budget/detalle?periodo=`, `PUT /api/
  budget/detalle/{id}` (admin, invalida cache incluido
  `snap.limpiar_snap_cache()`).
- Frontend: tabla superior (Total + Por Línea) pasa a SOLO LECTURA;
  sección nueva "Detalle (SKU)" -- selector de período, buscador,
  botón "Editar" por fila (Caja de 9 + USD, Guardar/Cancelar).

**Verificado en vivo tras el deploy:** Total ejercicio sin cambios
(USD 10.556.951 / 185.062,75 cajas), tabla de Detalle carga con
acentos correctos. La escritura no se probó en vivo (mismo motivo que
la 1ra vuelta); la propagación edición→total sí se validó con smoke
test local.

**Gotcha de proceso:** el `git push` de este commit fue bloqueado por
el clasificador de seguridad ("Out-of-Place Publication") -- publicar
2.329 filas de datos reales de presupuesto al historial de git es más
sensible que un cambio de código común. Se pidió confirmación
explícita antes de pushear.

### Bug real: faltaban columnas + Período invisible en el Detalle

Ezequiel: *"estoy mirando la hoja detalle sku, y si lo comparo con la
hoja datos del excel, me falta un monton de informacion, lo mas grave
es que detalle sku ninguna linea tiene periodo"*. Investigado antes de
tocar código: el período SÍ estaba guardado correctamente en
`budget_detalle` (verificado en vivo vía fetch directo) -- el
problema real era que la tabla nunca lo mostraba como COLUMNA, solo lo
usaba como filtro invisible. Aparte, la 1ra carga solo había extraído
6 de las 14 columnas reales de la hoja "Datos" (faltaban Mes, Código,
Descripción, Bloque, Medida, Pesos, TC) -- pérdida de información real.

- `budget_detalle_2026_2027.json` regenerado con las 14 columnas
  (totales re-verificados sin cambios).
- `database.py`: migración de la DB ya desplegada vía `ALTER TABLE ADD
  COLUMN` + backfill por posición (`id` 1..2329 == orden del JSON) --
  NUNCA toca `cajas`/`usd`. Verificado con script de prueba aislado
  que una edición preexistente sobrevive la migración intacta.
- Frontend: tabla de Detalle ahora muestra "Período" y "Código" como
  columnas visibles por fila.

**Gotcha de testing:** en este entorno (Windows + git-bash + Python
nativo), `VAR=valor python -c "..."` no propaga confiablemente la env
var al proceso -- usar un archivo `.py` real con `os.environ[...]`
seteado antes de importar el módulo que la lee a nivel de módulo.

### 3ra vuelta, mismo día: 2 pestañas separadas

Ezequiel: *"hacelo en 2 pestañas separadas"* -- Total/Por Línea y Detalle
(SKU) estaban apiladas verticalmente; ahora son 2 pestañas (mismo patrón
que Datos Maestros/Otros Análisis), commit `9ef7d05`.

Detalle completo en memoria de Claude, `proyecto_colome_ventas_budget_editable`.

## Sales Performance: feedback visual + cache de SNAP (agregado 2026-11-03)

Pedido explícito de Ezequiel: elegir un mes anterior en el selector de
Sales Performance (Monthly/YTD) tardaba bastante y no daba ningún
indicador de que estaba cargando.

- **Feedback visual (`snap.js`):** el handler de `#snapMesSel` (`change`)
  ahora es `async`, atenúa ambos roots (`#snapConsolidado`/
  `#snapFdelMotte`, clase `.snap-loading`) y deshabilita el selector
  mientras dura el refetch (`Promise.all` + `finally` sobre
  `snapInstances[].refetch()`), con texto "Actualizando…"
  (`#snapMesStatus`, en `sidebar.html`).
- **Cache en disco (`snap.py`):** todo rango que puede pedir
  `/api/ventas/snap` (mes individual o YTD hasta ese mes) es SIEMPRE un
  mes ya CERRADO -- `mes` solo acepta valores de `_meses_disponibles()`,
  que nunca incluye el mes en curso. El offensor real era
  `_ly_mensual()`: recalculaba `ventas_sbl()` para TODOS los meses
  cerrados desde jul-2025 en CADA request, sin importar qué mes pidió el
  usuario. `SNAP_RANGE_CACHE` (`/data/snap_range_cache.json`) cachea el
  resultado de `ventas_sbl()`/`ventas_fdelmotte()` por rango, sin
  vencimiento (`_ventas_sbl_cached()`/`_ventas_fdelmotte_cached()`,
  usados en `snap()` y `_ly_mensual()`). Única excepción:
  `limpiar_snap_cache()` se llama desde los 3 endpoints CRUD de
  `/api/datos-maestros/snap-linea-negocio` -- esa tabla sí puede
  reclasificar un mes ya cerrado.
- **Verificado en vivo (2026-11-03):** mismo mes pedido 2 veces --
  3073ms la primera, 479ms la segunda (cacheada), ~6x más rápido.

Detalle completo en memoria de Claude,
`proyecto_colome_ventas_sales_performance_feedback_y_cache`.

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
  `otros_analisis_agg_cerrado.json`, `snap_range_cache.json` en `/data`).
