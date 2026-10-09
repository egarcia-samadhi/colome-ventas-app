/* ================= Panel de Ventas + Ventas por Región + shell (estilo Chakana-Ventas) ================= */
(function () {
  'use strict';
  const FACTS = JSON.parse(document.getElementById('colome-facts').textContent);
  const D = FACTS.dims, F = FACTS.facts;
  const I = { periodo: 0, mercado: 1, categoria: 2, canal: 3, zona: 4, pais: 5, provincia: 6, brand: 7, producto: 8, cliente: 9 };
  const MESES = ['Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'];
  const PERIODOS = Array.from({ length: 12 }, (_, i) => 'P' + String(i + 1).padStart(2, '0'));
  // Ejercicio fiscal Colomé: cierre en junio -> P01 = julio ... P12 = junio.
  const perCode = s => PERIODOS[(parseInt(s.slice(5, 7), 10) - 7 + 12) % 12];
  const PER_DATA = D.periodo.map(perCode);
  // 2026-10-08 -- Panel de Ventas conectado en vivo ahora trae >1 ejercicio
  // fiscal (jul-2025 a hoy, 13 meses). El código de período (P01..P12) NO
  // distingue año -- sin esto, filtrar "P01" mezclaría julio-2025 con
  // julio-2026 en la misma fila. `ejercicioFiscal()` deriva el ejercicio
  // real ("2026-2027") de la fecha cruda de cada hecho, y el selector "Año
  // Fiscal" (antes deshabilitado, fijo en un solo valor) ahora filtra por
  // ejercicio real ANTES de aplicar el filtro de período -- pedido explícito
  // de Ezequiel: "panel de ventas tiene que venir pre filtrado por el P en
  // el que estamos. si empieza en jul, tiene que venir pre filtrado por p1,
  // p2, p3 y p4 ahora en octubre" (fiscal 2026-2027 arrancó julio-2026).
  const ejercicioFiscal = s => {
    const anio = parseInt(s.slice(0, 4), 10), mes = parseInt(s.slice(5, 7), 10);
    return mes >= 7 ? `${anio}-${anio + 1}` : `${anio - 1}-${anio}`;
  };
  const EJ_DATA = D.periodo.map(ejercicioFiscal);
  const hoyISO = new Date().toISOString().slice(0, 10);
  const PERIODO_ACTUAL = perCode(hoyISO);
  const EJERCICIO_ACTUAL = ejercicioFiscal(hoyISO);
  const EJERCICIOS_DISPONIBLES = [...new Set(EJ_DATA)].sort();
  // Períodos con dato real DENTRO de un ejercicio dado (un período puede
  // tener datos en un ejercicio pero no en otro, ej. recién arrancando uno).
  function periodosConDato(ej) {
    const disp = new Set();
    D.periodo.forEach((raw, i) => { if (EJ_DATA[i] === ej) disp.add(PER_DATA[i]); });
    return disp;
  }
  // Default: si es el ejercicio actual, solo hasta el período en curso (P01
  // a P04 si estamos en octubre de un ejercicio que arrancó en julio) -- un
  // ejercicio ya cerrado por defecto muestra los 12.
  function periodosDefaultPara(ej) {
    const disp = periodosConDato(ej);
    const limite = ej === EJERCICIO_ACTUAL ? PERIODOS.indexOf(PERIODO_ACTUAL) : 11;
    return new Set(PERIODOS.slice(0, limite + 1).filter(p => disp.has(p)));
  }

  // ---------- formato / exposición (la base nunca se toca, norma 4.quinquies) ----------
  const NP_KEEP = new Set(['SV', 'DTC', 'NOA', 'NEA', 'UK', 'CABA', 'SA', 'SAS', 'SRL', 'S.A.', 'S.A.S', 'S.R.L.', 'SAU', 'SCA', 'SH', 'INC', 'LTD', 'SPA', 'LLC', 'ML', 'PT', 'II', 'III', 'IV', 'UE', 'USA']);
  const NP_LOWER = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'en', 'con', 'e', 'al']);
  const ACENTOS = { 'RIO NEGRO': 'Río Negro', 'ENTRE RIOS': 'Entre Ríos', 'SIN PAIS': 'Sin País', 'SIN PROVINCIA': 'Sin Provincia' };
  // Tildes que el ERP no carga (solo exposición, la base queda intacta)
  const ACENTO_W = { 'COLOME': 'Colomé', 'MAXIMA': 'Máxima', 'MEXICO': 'México', 'CANADA': 'Canadá', 'CORDOBA': 'Córdoba', 'TUCUMAN': 'Tucumán',
    'NEUQUEN': 'Neuquén', 'PAIS': 'País', 'TORRONTES': 'Torrontés', 'AUTENTICO': 'Auténtico', 'UNICO': 'Único' };
  function cap(w) {
    if (ACENTO_W[w.toUpperCase()]) return ACENTO_W[w.toUpperCase()];
    if (/\d/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }
  function nombrePropio(s) {
    if (s === null || s === undefined) return '';
    const raw = String(s).replace(/\*+/g, '').trim().replace(/\s+/g, ' '); // el ERP marca rubros/grupos con '**'
    if (ACENTOS[raw.toUpperCase()]) return ACENTOS[raw.toUpperCase()];
    return raw.split(' ').map((w, i) => {
      const core = w.replace(/^[(\[]+|[)\],;:]+$/g, '').toUpperCase();
      // siglas legales: con puntos (S.A., S.A.S., S.A.U., M.A.S.) o sin ellos (SA, SRL, SAS), con o sin punto final
      if (NP_KEEP.has(core) || NP_KEEP.has(core.replace(/\.+$/, '')) || /^[A-Z](\.[A-Z])+\.?$/.test(core)) return w.toUpperCase();
      if (i > 0 && NP_LOWER.has(w.toLowerCase())) return w.toLowerCase();
      return w.split(/(['-])/).map(p => (p === '-' || p === "'") ? p : cap(p)).join('');
    }).join(' ');
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moneyRaw = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  const intRaw = n => Math.round(n).toLocaleString('en-US');
  const priceRaw = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Norma (01-Normas-Tecnicas, "Formato de ceros"): un cero real en una tabla se muestra "-", nunca "0".
  // Los ejes de los gráficos usan las versiones "Raw" (el $0 del eje sí se dibuja).
  const money = n => (Math.round(n) === 0 ? '-' : moneyRaw(n));
  const int = n => (Math.round(n) === 0 ? '-' : intRaw(n));
  const price = n => (Math.round(n * 100) === 0 ? '-' : priceRaw(n));
  const pct = n => (n * 100).toFixed(1) + '%';
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const ND = '<span class="na" title="Sin dato de comparación disponible">n/d</span>';
  const $ = id => document.getElementById(id);

  // ---------- paleta Colomé ----------
  // Sitio bodegacolome.com: negro / blanco / dorado #DCBE84. Series de datos: bordó de la etiqueta Estate.
  // Colores de etiqueta = color dominante medido de las imágenes de botella de bodegacolome.com (Colomé, Altura Máxima, Lote Especial).
  // Los tonos crema (1831, Lote Especial) se toman de su segundo color dominante, más oscuro, para que se lean sobre fondo claro.
  // Amalaya y Mix: sin paleta cargada todavía (pedido: "por ahora solo Colomé") -> gris neutro.
  const C = { wine: '#7D4E5B', wine2: '#9F6375', wineD: '#5F3D4A', gold: '#DCBE84', goldD: '#b8975a', neutro: '#a8a08c' };
  const LABEL = {
    'COLOME ESTATE': '#7D4E5B', 'COLOME AUTENTICO': '#1d4148', 'COLOME TORRONTES': '#6e6d30', 'COLOME EL ARENAL': '#513726',
    'COLOME 1831 MALBEC': '#7d6b40', 'COLOME 1831 CAB SAUV': '#72643f',
    'ALTURA MAXIMA - MALBEC': '#b28954', 'ALTURA MAXIMA - PINOT NOIR': '#c89557', 'ALTURA MAXIMA - SAUV BLANCO': '#a87103', 'ALTURA MAXIMA - SAUV BLANC': '#a87103',
    'LOTE ESPECIAL MALBEC': '#8b764d', 'LOTE ESPECIAL BONARDA': '#8b764d', 'LOTE ESPECIAL SYRAH': '#8b764d', 'LOTE ESPECIAL CRIOLLA': '#8b764d', 'LOTE ESPECIAL MISTERIOSO': '#8b764d',
  };
  const BRAND_COL = { 'COLOME': '#b8975a', 'ALTURA MAXIMA': '#b28954' };
  const keyNorm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const prodColor = raw => LABEL[keyNorm(raw)] || C.neutro;
  const brandColor = raw => BRAND_COL[keyNorm(raw)] || C.neutro;
  const swatch = col => `<i class="sw" style="background:${col}"></i>`;

  // ---------- agregación ----------
  const zero = () => ({ usd: 0, cajas: 0, ars: 0, mg: 0 });
  function add(a, f) { a.usd += f[10]; a.cajas += f[11]; a.ars += f[12]; a.mg += f[13]; return a; }
  function total(rows) { const t = zero(); rows.forEach(f => add(t, f)); return t; }
  function groupBy(rows, idx) {
    const m = new Map();
    rows.forEach(f => { let a = m.get(f[idx]); if (!a) { a = zero(); a.k = f[idx]; m.set(f[idx], a); } add(a, f); });
    return [...m.values()];
  }
  const gm = a => (a.ars ? a.mg / a.ars : null);
  const avgPrice = a => (a.cajas ? a.usd / a.cajas : 0);

  // ---------- estado (filtros compartidos por Panel de Ventas y Ventas por Región) ----------
  const FILTROS = [
    { key: 'mercado', label: 'Mercado', dim: 'mercado' },
    { key: 'canal', label: 'Canal', dim: 'canal' },
    { key: 'brand', label: 'Brand', dim: 'brand' },
    { key: 'producto', label: 'Producto', dim: 'producto' },
    { key: 'zona', label: 'Región', dim: 'zona' },
    { key: 'pais', label: 'País', dim: 'pais' },
  ];
  const DIMS_DESGLOSE = [['cliente', 'Cliente'], ['brand', 'Brand'], ['producto', 'Producto'], ['pais', 'País'], ['canal', 'Canal'], ['zona', 'Región']];
  // FdelMotte: marca presente en ig_ventas (dim "brand" = d_rubro) pero
  // ausente del Excel real de "Ventas" que usa la empresa (ver
  // ig_ventas.py) -- confirmado por Ariel Culasso 2026-10-09: va separada,
  // no mezclada en el número consolidado de Panel de Ventas (ver pestaña
  // aparte en Sales Performance, más abajo). Por eso el chip de Brand
  // arranca con TODAS las marcas tildadas MENOS FdelMotte, al revés del
  // resto de los filtros (nada tildado = sin filtro) -- se suma tildando
  // su chip si alguna vez hace falta verla adentro del consolidado.
  const FDELMOTTE_IDX = D.brand.findIndex(v => keyNorm(v).replace(/[^A-Z]/g, '').includes('DELMOTTE'));
  const DEFAULT_BRAND = new Set(D.brand.map((_, i) => i).filter(i => i !== FDELMOTTE_IDX));
  const brandEsDefault = () => st.brand.size === DEFAULT_BRAND.size && [...DEFAULT_BRAND].every(i => st.brand.has(i));
  const ejercicioInicial = EJERCICIOS_DISPONIBLES.includes(EJERCICIO_ACTUAL) ? EJERCICIO_ACTUAL : EJERCICIOS_DISPONIBLES[EJERCICIOS_DISPONIBLES.length - 1];
  const st = { ejercicio: ejercicioInicial, periodos: periodosDefaultPara(ejercicioInicial), metrica: 'usd', comparar: true, dim: 'cliente', vista: 'snap', dgSort: 'usd', dgDir: 'desc' };
  FILTROS.forEach(f => { st[f.key] = f.key === 'brand' ? new Set(DEFAULT_BRAND) : new Set(); });
  const filtrosActivos = () => FILTROS.some(f => f.key === 'brand' ? !brandEsDefault() : st[f.key].size > 0);
  const okFiltros = f => FILTROS.every(fl => st[fl.key].size === 0 || st[fl.key].has(f[I[fl.dim]]));
  const okEjercicio = f => EJ_DATA[f[0]] === st.ejercicio;
  const rowsSinPeriodo = () => F.filter(f => okEjercicio(f) && okFiltros(f));
  const rowsFiltradas = () => F.filter(f => okEjercicio(f) && st.periodos.has(PER_DATA[f[0]]) && okFiltros(f));

  // ---------- referencia SNAP (LY / Budget solo a nivel total Grupo) ----------
  function snapRef(periodosSel) {
    const tot = k => RAW[k].find(r => r && r.label === 'TOTAL SALES');
    const y = tot('sbl_ytd'), a = tot('sbl_aug');
    const sel = [...periodosSel].filter(p => PER_DATA.includes(p)).sort().join(',');
    const modo = sel === 'P01,P02' ? 'ytd' : sel === 'P02' ? 'aug' : sel === 'P01' ? 'jul' : null;
    if (!modo) return null;
    const g = f => (modo === 'ytd' ? y[f] : modo === 'aug' ? a[f] : y[f] - a[f]);
    return { usd: { ly: g('usd_ly') * 1000, bud: g('usd_bud') * 1000 }, cajas: { ly: g('lit_ly'), bud: g('lit_bud') } };
  }

  // ---------- tooltip global (estilo Recharts) ----------
  const tip = $('tip');
  const tipAttr = html => ` data-tip="${esc(html)}"`;
  document.addEventListener('mousemove', e => {
    const t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!t) { tip.style.display = 'none'; return; }
    tip.innerHTML = t.getAttribute('data-tip');
    tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  });
  const tipRow = (name, r) => `<b>${esc(name)}</b><br><span class="k">Ingresos</span> ${money(r.usd)}<br><span class="k">Cajas 9L</span> ${int(r.cajas)}<br><span class="k">Precio prom.</span> ${price(avgPrice(r))}` +
    (gm(r) !== null ? `<br><span class="k">% GM</span> ${pct(gm(r))}` : '');

  // ---------- sidebar ----------
  function optionsFor(dim) {
    return D[dim].map((v, i) => ({ i, label: nombrePropio(v) })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }
  // Chips de período: dependen del ejercicio seleccionado (un período puede
  // tener datos en un ejercicio y no en otro) -- se regeneran solos cuando
  // cambia el selector de Año Fiscal, sin tocar el resto del sidebar.
  function renderPeriodoChips() {
    const disp = periodosConDato(st.ejercicio);
    let h = '<div class="per-grid">';
    PERIODOS.forEach((p, i) => {
      const has = disp.has(p);
      h += `<label class="chip" title="${MESES[i]}${has ? '' : ' — sin datos'}"><input type="checkbox" data-p="${p}" ${has && st.periodos.has(p) ? 'checked' : ''} ${has ? '' : 'disabled'}>${p}</label>`;
    });
    $('pvPeriodos').innerHTML = h + '</div>';
  }
  function buildSidebar() {
    let h = '';
    h += '<div class="fs"><span class="fl">Año Fiscal</span><select id="pvEjercicio">' +
      EJERCICIOS_DISPONIBLES.map(ej => `<option value="${ej}"${ej === st.ejercicio ? ' selected' : ''}>${ej}</option>`).join('') +
      '</select></div>';
    h += '<div class="fs"><span class="fl">Período</span><div id="pvPeriodos"></div></div>';
    FILTROS.forEach(fl => {
      h += `<div class="fs"><span class="fl">${fl.label}</span><div class="fl-list">`;
      optionsFor(fl.dim).forEach(o => { h += `<label class="chip"><input type="checkbox" data-f="${fl.key}" data-v="${o.i}"${st[fl.key].has(o.i) ? ' checked' : ''}>${esc(o.label)}</label>`; });
      h += '</div></div>';
    });
    h += '<div class="fs"><span class="fl">⚙️ Opciones de visualización</span>' +
      '<label class="opt" title="El ERP entrega el valor en USD (moneda alterna) además de ARS"><input type="checkbox" checked disabled> Mostrar en USD</label>' +
      '<label class="opt"><input type="checkbox" id="pvBud" checked> Comparar con Budget</label>' +
      '<p style="margin:12px 0 0"><button class="clear" id="pvClear" type="button">Limpiar filtros</button></p></div>';
    $('sbFilt').innerHTML = h;
  }

  // ---------- gráficos SVG (degradés, ejes, grilla y tooltips como en Chakana) ----------
  const fmtM = () => (st.metrica === 'usd' ? moneyRaw : intRaw);
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x || 1))), n = x / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  // Curva suave (Catmull-Rom -> Bézier cúbica) para líneas de evolución con
  // varios puntos -- pedido explícito de Ezequiel ("asi sean 12 meses, lo
  // veo desprolijo"): con hasta 12 puntos, una polyline recta se ve quebrada
  // y las etiquetas de valor fijas en cada punto se pisaban entre sí. Acá se
  // reemplaza por una curva suave + se sacan las etiquetas estáticas (el
  // valor exacto queda en el tooltip al pasar el mouse, igual que el resto
  // de los gráficos del tablero).
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    if (pts.length === 2) return `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]}`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
    }
    return d;
  }
  function evolucionSvg() {
    const base = rowsSinPeriodo(), key = st.metrica;
    // Solo se dibuja hasta el último período CON DATO dentro del ejercicio
    // elegido -- antes comparaba contra PER_DATA.includes(p) (¿existe este
    // P-code en ALGÚN ejercicio?), así que un ejercicio recién arrancado
    // (ej. 2026-2027, solo P01-P04 con datos) terminaba mostrando P05-P12 en
    // $0 -- esos períodos SÍ tienen dato en el ejercicio ANTERIOR, por eso
    // "existían" globalmente aunque acá no haya nada todavía. Pedido
    // explícito de Ezequiel: "lo veo bastante tosco" (línea plana en $0 +
    // etiquetas de valor pisándose). Fix: acotar al ejercicio actual.
    const dispEj = periodosConDato(st.ejercicio);
    const act = PERIODOS.map(p => (dispEj.has(p) ? total(base.filter(f => PER_DATA[f[0]] === p))[key] : null));
    const ly = PERIODOS.map(p => {
      if (filtrosActivos()) return null;
      const r = (p === 'P01' || p === 'P02') ? snapRef(new Set([p])) : null;
      return r ? r[key].ly : null;
    });
    const vals = act.concat(ly).filter(v => v !== null);
    if (!vals.length) return '<div class="empty">Sin datos para la selección.</div>';
    const f = fmtM();
    const W = 1160, H = 460, ml = 70, mr = 20, mt = 26, mb = 40, iw = W - ml - mr, ih = H - mt - mb;
    const step = niceStep(Math.max.apply(null, vals) * 1.12 / 4), top = step * 4;
    const x = i => ml + (iw * i) / 11, y = v => mt + ih - (Math.max(v, 0) / top) * ih;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución por período"><defs><linearGradient id="ge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7D4E5B" stop-opacity=".55"/><stop offset="1" stop-color="#7D4E5B" stop-opacity=".03"/></linearGradient></defs>`;
    for (let g = 0; g <= 4; g++) {
      const yy = y(step * g);
      s += `<line x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}" stroke="#f0ebdf" stroke-dasharray="3 3"/><text x="${ml - 10}" y="${yy + 4}" text-anchor="end">${f(step * g)}</text>`;
    }
    // Períodos sin dato en este ejercicio (ej. el resto del año que falta
    // transcurrir): etiqueta del eje más tenue, para que se note que el año
    // sigue pero sin pretender que ya hay venta ahí.
    PERIODOS.forEach((p, i) => { s += `<text x="${x(i)}" y="${H - 14}" text-anchor="middle"${dispEj.has(p) ? '' : ' opacity="0.4"'}>${p} · ${MESES[i]}</text>`; });
    const idx = arr => arr.map((v, i) => (v === null ? null : i)).filter(i => i !== null);
    const ia = idx(act), il = idx(ly);
    if (ia.length) {
      const ptsAct = ia.map(i => [x(i), y(act[i])]);
      const path = smoothPath(ptsAct);
      s += `<path d="${path} L${x(ia[ia.length - 1])},${y(0)} L${x(ia[0])},${y(0)} Z" fill="url(#ge)" stroke="none"/>`;
      s += `<path d="${path}" fill="none" stroke="#7D4E5B" stroke-width="2.5" stroke-linecap="round"/>`;
    }
    if (il.length) s += `<path d="${smoothPath(il.map(i => [x(i), y(ly[i])]))}" fill="none" stroke="#b8975a" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>`;
    il.forEach(i => { s += `<circle cx="${x(i)}" cy="${y(ly[i])}" r="3.5" fill="#fff" stroke="#b8975a" stroke-width="2"/>`; });
    ia.forEach(i => { s += `<circle cx="${x(i)}" cy="${y(act[i])}" r="4" fill="#7D4E5B" stroke="#fff" stroke-width="1.5"/>`; });
    // zonas de hover por período con dato
    PERIODOS.forEach((p, i) => {
      if (act[i] === null) return;
      const t = `<b>${p} · ${MESES[i]}</b><br><span class="k">Actual</span> ${f(act[i])}` + (ly[i] !== null ? `<br><span class="k">Last Year (SNAP)</span> ${f(ly[i])}` : '');
      s += `<rect class="hotspot" x="${x(i) - iw / 22}" y="${mt}" width="${iw / 11}" height="${ih}"${tipAttr(t)}/>`;
    });
    s += '</svg><div class="lg"><span><i></i>Actual</span>' + (il.length ? '<span><i class="ly"></i>Last Year (SNAP)</span>' : '') + '</div>';
    if (!il.length) s += '<div class="hint" style="text-align:center">Last Year no se muestra: solo existe a nivel total Grupo (SNAP) y hay filtros activos.</div>';
    return s;
  }
  function svgVBars(list, nameFn) {
    const key = st.metrica, f = fmtM();
    const L = list.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 10);
    if (!L.length) return '<div class="empty">Sin datos para la selección.</div>';
    const W = 1160, H = 500, ml = 70, mr = 14, mt = 28, mb = 76, iw = W - ml - mr, ih = H - mt - mb;
    const step = niceStep(L[0][key] * 1.12 / 4), top = step * 4, band = iw / L.length, bw = Math.min(band * 0.6, 58);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9F6375"/><stop offset="1" stop-color="#5F3D4A"/></linearGradient></defs>`;
    for (let g = 0; g <= 4; g++) {
      const yy = mt + ih - (step * g / top) * ih;
      s += `<line x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}" stroke="#f0ebdf" stroke-dasharray="3 3"/><text x="${ml - 10}" y="${yy + 4}" text-anchor="end">${f(step * g)}</text>`;
    }
    L.forEach((r, i) => {
      const h = Math.max(2, (r[key] / top) * ih), cx = ml + band * i + band / 2, nm = nameFn(r);
      s += `<g class="bar-hit"${tipAttr(tipRow(nm, r))}><rect x="${ml + band * i}" y="${mt}" width="${band}" height="${ih}" fill="transparent"/>` +
        `<rect class="bar-r" x="${cx - bw / 2}" y="${mt + ih - h}" width="${bw}" height="${h}" rx="6" fill="url(#gv)"/>` +
        `<text class="val" x="${cx}" y="${mt + ih - h - 7}" text-anchor="middle">${f(r[key])}</text></g>` +
        `<text transform="translate(${cx + 4},${mt + ih + 16}) rotate(-30)" text-anchor="end">${esc(short(nm, 18))}</text>`;
    });
    return s + '</svg>';
  }
  let gradSeq = 0; // ids de degradé únicos por gráfico (dos SVG en la misma página no pueden repetir id)
  function svgHBars(list, nameFn, colorFn) {
    const gp = 'gh' + (++gradSeq) + '_';
    const key = st.metrica, f = fmtM();
    const L = list.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 10);
    if (!L.length) return '<div class="empty">Sin datos para la selección.</div>';
    const W = 560, row = 32, ml = 160, mr = 78, mt = 8, mb = 30, iw = W - ml - mr, H = mt + L.length * row + mb;
    const step = niceStep(L[0][key] * 1.05 / 4), top = step * 4;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img"><defs>` + L.map((r, i) => {
      const c = colorFn ? colorFn(r) : null;
      return c ? `<linearGradient id="${gp}${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset="1" stop-color="${c}"/></linearGradient>`
        : `<linearGradient id="${gp}${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5F3D4A" stop-opacity=".6"/><stop offset="1" stop-color="#9F6375"/></linearGradient>`;
    }).join('') + '</defs>';
    for (let g = 0; g <= 4; g++) {
      const xx = ml + (step * g / top) * iw;
      s += `<line x1="${xx}" x2="${xx}" y1="${mt}" y2="${H - mb}" stroke="#f0ebdf" stroke-dasharray="3 3"/><text x="${xx}" y="${H - 12}" text-anchor="middle">${f(step * g)}</text>`;
    }
    L.forEach((r, i) => {
      const w = Math.max(2, (r[key] / top) * iw), yy = mt + i * row, nm = nameFn(r);
      s += `<g class="bar-hit"${tipAttr(tipRow(nm, r))}><rect x="0" y="${yy}" width="${W}" height="${row}" fill="transparent"/>` +
        `<text x="${ml - 8}" y="${yy + row / 2 + 4}" text-anchor="end" style="fill:#4a4030">${esc(short(nm, 24))}</text>` +
        `<rect class="bar-r" x="${ml}" y="${yy + 7}" width="${w}" height="${row - 14}" rx="5" fill="url(#${gp}${i})"/>` +
        `<text class="val" x="${ml + w + 7}" y="${yy + row / 2 + 4}">${f(r[key])}</text></g>`;
    });
    return s + '</svg>';
  }

  // ---------- Sales Performance — sub-pestaña FdelMotte (datos en vivo) ----------
  function rowsFdelMotte() {
    if (FDELMOTTE_IDX < 0) return [];
    return F.filter(f => f[I.brand] === FDELMOTTE_IDX && EJ_DATA[f[0]] === EJERCICIO_ACTUAL);
  }
  function renderSnapFdelMotte() {
    const box = $('fmBody');
    if (!box) return;
    if (FDELMOTTE_IDX < 0) { box.innerHTML = '<div class="empty">No hay ventas de FdelMotte registradas en ig_ventas.</div>'; return; }
    const rows = rowsFdelMotte();
    if (!rows.length) { box.innerHTML = `<div class="empty">Sin datos de FdelMotte para el ejercicio ${EJERCICIO_ACTUAL}.</div>`; return; }
    const t = total(rows), g = gm(t);
    let h = '<div class="kpis">' +
      [['Ingresos totales (US$)', money(t.usd)], ['Total cajas 9L', int(t.cajas)], ['Precio prom. / caja (US$)', price(avgPrice(t))], ['Margen bruto %', g === null ? '—' : pct(g)]]
        .map(k => `<div class="kpi"><div class="v">${k[1]}</div><div class="l">${k[0]}</div></div>`).join('') + '</div>';
    h += `<div class="card chart"><h3>Top 10 clientes — Ejercicio ${EJERCICIO_ACTUAL}</h3>${svgHBars(groupBy(rows, I.cliente), r => nombrePropio(D.cliente[r.k]))}</div>`;
    h += `<div class="card chart"><h3>Top 10 productos — Ejercicio ${EJERCICIO_ACTUAL}</h3>${svgHBars(groupBy(rows, I.producto), r => nombrePropio(D.producto[r.k]))}</div>`;
    box.innerHTML = h;
  }

  // ---------- render Panel ----------
  function varCell(v, f) { // f = formateador de la métrica; sin f => porcentaje
    if (v === null || v === undefined || !isFinite(v)) return `<td class="n">${ND}</td>`;
    const t = f ? f(Math.abs(v)) : pct(v);
    if (t === '-') return '<td class="n">-</td>'; // variación exactamente cero: guion, sin signo ni color
    return `<td class="n ${v < 0 ? 'neg-t' : 'pos-t'}">${f && v < 0 ? '-' : ''}${t}</td>`;
  }
  function renderPanel() {
    const rows = rowsFiltradas(), body = $('pvBody');
    if (!rows.length) { body.innerHTML = '<div class="card"><div class="empty">Sin datos para la selección de filtros.</div></div>'; return; }
    const t = total(rows), key = st.metrica;
    const ref = filtrosActivos() ? null : snapRef(st.periodos);
    const g = gm(t);
    let h = '<div class="kpis">' +
      [['Ingresos totales (US$)', money(t.usd)], ['Total cajas 9L', int(t.cajas)], ['Precio prom. / caja (US$)', price(avgPrice(t))], ['Margen bruto %', g === null ? '—' : pct(g)]]
        .map(k => `<div class="kpi"><div class="v">${k[1]}</div><div class="l">${k[0]}</div></div>`).join('') + '</div>';
    const defs = [
      { nm: 'Ingresos (US$)', act: t.usd, ly: ref && ref.usd.ly, bud: ref && ref.usd.bud, f: money },
      { nm: 'Cajas 9L', act: t.cajas, ly: ref && ref.cajas.ly, bud: ref && ref.cajas.bud, f: int },
      { nm: 'Precio prom. / caja (US$)', act: avgPrice(t), ly: ref && ref.usd.ly / ref.cajas.ly, bud: ref && ref.usd.bud / ref.cajas.bud, f: price },
    ];
    h += '<div class="card"><h3>Tabla comparativa anual</h3><div class="scroll-x"><table class="tight"><thead><tr><th class="l">Métrica</th><th class="n">Actual</th><th class="n">LY</th><th class="n">Var LY</th><th class="n">% Var LY</th>' +
      (st.comparar ? '<th class="n">Budget</th><th class="n">Var Bud</th>' : '') + '</tr></thead><tbody>';
    defs.forEach(d => {
      const has = d.ly !== null && d.ly !== undefined;
      h += `<tr><td class="l" style="color:var(--ink);font-weight:500">${d.nm}</td><td class="n">${d.f(d.act)}</td><td class="n">${has ? d.f(d.ly) : ND}</td>` +
        varCell(has ? d.act - d.ly : null, d.f) + varCell(has && d.ly ? d.act / d.ly - 1 : null);
      if (st.comparar) h += `<td class="n">${has ? d.f(d.bud) : ND}</td>` + varCell(has ? d.act - d.bud : null, d.f);
      h += '</tr>';
    });
    h += `</tbody></table></div><div class="hint">${ref ? 'LY y Budget tomados del SNAP (total Grupo Colomé, mismo período).' : 'n/d: LY y Budget del SNAP existen solo a nivel total Grupo y para P01, P02 o P01–P02 sin filtros. Redline no tiene datos anteriores a sep-2025.'}</div></div>`;
    h += `<div class="card chart"><h3>Evolución por período — ${key === 'usd' ? 'Ingresos (US$)' : 'Cajas 9L'}</h3>${evolucionSvg()}</div>`;
    h += `<div class="card chart"><h3>Ventas por país — Ejercicio ${st.ejercicio}</h3>${svgVBars(groupBy(rows, I.pais), r => nombrePropio(D.pais[r.k]))}</div>`;
    h += '<div class="grid2">' +
      `<div class="card chart"><h3>Top 10 clientes — Ejercicio ${st.ejercicio}</h3>${svgHBars(groupBy(rows, I.cliente), r => nombrePropio(D.cliente[r.k]))}</div>` +
      `<div class="card chart"><h3>Top 10 productos — Ejercicio ${st.ejercicio}</h3>${svgHBars(groupBy(rows, I.producto), r => nombrePropio(D.producto[r.k]))}</div></div>`;
    // Columnas del Desglose por categoría -- clickeables para ordenar
    // (pedido explícito de Ezequiel: "los encabezados deben poder
    // ordenarse alfabéticamente al hacer clic"). `nombre` ordena
    // alfabético (string), el resto numérico; clickear de nuevo invierte
    // el sentido, cambiar de columna vuelve al sentido por defecto de esa
    // columna (nombre: A→Z: resto: mayor primero).
    const COLS_DESGLOSE = [
      { key: 'nombre', label: DIMS_DESGLOSE.find(d => d[0] === st.dim)[1], val: r => nombrePropio(D[st.dim][r.k]).toLowerCase(), tipo: 'str', defDir: 'asc' },
      { key: 'usd', label: 'Ingresos', val: r => r.usd, tipo: 'num', defDir: 'desc' },
      { key: 'cajas', label: 'Cajas 9L', val: r => r.cajas, tipo: 'num', defDir: 'desc' },
      { key: 'precio', label: 'Precio prom.', val: r => avgPrice(r), tipo: 'num', defDir: 'desc' },
      { key: 'gm', label: '% GM', val: r => { const g = gm(r); return g === null ? -Infinity : g; }, tipo: 'num', defDir: 'desc' },
      { key: 'part', label: '% Part.', val: r => r.usd, tipo: 'num', defDir: 'desc' },
    ];
    const colSort = COLS_DESGLOSE.find(c => c.key === st.dgSort) || COLS_DESGLOSE[1];
    const gr = groupBy(rows, I[st.dim]).sort((a, b) => {
      const va = colSort.val(a), vb = colSort.val(b);
      const cmp = colSort.tipo === 'str' ? String(va).localeCompare(String(vb), 'es') : va - vb;
      return st.dgDir === 'asc' ? cmp : -cmp;
    });
    h += '<div class="card"><div class="card-head"><h3>Desglose por categoría</h3><div class="seg dark" role="radiogroup" aria-label="Dimensión">' +
      DIMS_DESGLOSE.map(d => `<label><input type="radio" name="pvDim" value="${d[0]}" ${st.dim === d[0] ? 'checked' : ''}> ${d[1]}</label>`).join('') + '</div></div>' +
      '<div class="scroll-x" style="border:1px solid var(--line)"><table class="tight"><thead><tr>' +
      COLS_DESGLOSE.map((c, i) => {
        const activa = st.dgSort === c.key;
        const flecha = activa ? (st.dgDir === 'asc' ? ' ▲' : ' ▼') : '';
        return `<th class="${i === 0 ? 'l' : 'n'} sortable" data-sort="${c.key}" style="cursor:pointer;user-select:none"${activa ? ' aria-sort="' + (st.dgDir === 'asc' ? 'ascending' : 'descending') + '"' : ''}>${c.label}${flecha}</th>`;
      }).join('') + '</tr></thead><tbody>';
    gr.slice(0, 50).forEach(r => {
      const gg = gm(r);
      const sw = st.dim === 'producto' ? swatch(prodColor(D.producto[r.k])) : st.dim === 'brand' ? swatch(brandColor(D.brand[r.k])) : '';
      h += `<tr><td class="l">${sw}${esc(nombrePropio(D[st.dim][r.k]))}</td><td class="n">${money(r.usd)}</td><td class="n">${int(r.cajas)}</td><td class="n">${price(avgPrice(r))}</td><td class="n">${gg === null ? '—' : pct(gg)}</td><td class="n">${pct(t.usd ? r.usd / t.usd : 0)}</td></tr>`;
    });
    h += `</tbody></table></div>${gr.length > 50 ? `<div class="hint">Mostrando 50 de ${gr.length}.</div>` : ''}</div>`;
    body.innerHTML = h;
  }

  // ---------- Ventas por Región (usa los mismos filtros del sidebar) ----------
  const openZ = new Set(), openP = new Set();
  let TREE = [];
  function buildTree(rows) {
    return groupBy(rows, I.zona).sort((a, b) => b.usd - a.usd).map(z => {
      const rz = rows.filter(f => f[I.zona] === z.k);
      const ps = groupBy(rz, I.pais).sort((a, b) => b.usd - a.usd).map(p =>
        Object.assign({}, p, { clientes: groupBy(rz.filter(f => f[I.pais] === p.k), I.cliente).sort((a, b) => b.usd - a.usd) }));
      return Object.assign({}, z, { paises: ps });
    });
  }
  function rgRow(cls, label, a, tot, key) {
    const g = gm(a), open = cls === 'rg' ? openZ.has(key) : openP.has(key);
    return `<tr class="${cls}" ${key ? `data-k="${esc(key)}" tabindex="0" aria-expanded="${open}"` : ''}><td class="l">${label}</td><td class="n">${money(a.usd)}</td><td class="n">${int(a.cajas)}</td><td class="n">${price(avgPrice(a))}</td><td class="n">${g === null ? '—' : pct(g)}</td><td class="n">${pct(tot.usd ? a.usd / tot.usd : 0)}</td></tr>`;
  }
  function renderRegion() {
    const rows = rowsFiltradas();
    if (!rows.length) { TREE = []; $('rgTable').innerHTML = '<div class="empty">Sin datos para la selección de filtros.</div>'; syncRgToggle(); return; }
    TREE = buildTree(rows);
    const tot = total(rows), g = gm(tot);
    let h = '<table class="tight" style="min-width:680px"><thead><tr><th class="l">Nivel / detalle</th><th class="n">US$ Ingresos</th><th class="n">Cajas 9L</th><th class="n">Precio prom.</th><th class="n">% GM</th><th class="n">% Part.</th></tr></thead><tbody>';
    TREE.forEach(z => {
      const zk = 'z:' + z.k, zo = openZ.has(zk);
      h += rgRow('rg', `${zo ? '▼' : '▶'} ${esc(nombrePropio(D.zona[z.k]))}`, z, tot, zk);
      if (!zo) return;
      z.paises.forEach(p => {
        const pk = `p:${z.k}::${p.k}`, po = openP.has(pk);
        h += rgRow('ps', `${po ? '▼' : '▶'} 📍 ${esc(nombrePropio(D.pais[p.k]))}`, p, tot, pk);
        if (po) p.clientes.forEach(c => { h += rgRow('cl', `👤 ${esc(nombrePropio(D.cliente[c.k]))}`, c, tot, null); });
      });
    });
    h += `</tbody><tfoot><tr class="total"><td class="l">Total</td><td class="n">${money(tot.usd)}</td><td class="n">${int(tot.cajas)}</td><td class="n">${price(avgPrice(tot))}</td><td class="n">${g === null ? '—' : pct(g)}</td><td class="n">${pct(1)}</td></tr></tfoot></table>`;
    $('rgTable').innerHTML = h;
    syncRgToggle();
  }
  const todoAbierto = () => TREE.length > 0 && TREE.every(z => openZ.has('z:' + z.k) && z.paises.every(p => openP.has(`p:${z.k}::${p.k}`)));
  function syncRgToggle() {
    const b = $('rgToggle'), ab = todoAbierto();
    b.textContent = ab ? '▶ Colapsar todo' : '▼ Expandir todo';
    b.disabled = TREE.length === 0;
  }
  function toggleKey(k) {
    const s = k.indexOf('z:') === 0 ? openZ : openP;
    if (s.has(k)) s.delete(k); else s.add(k);
    renderRegion();
  }

  // ---------- mapa (Leaflet cargado bajo demanda; si no hay conexión el resto sigue andando) ----------
  const COORD_PAIS = { 'ARGENTINA': [-38.4, -63.6], 'REINO UNIDO': [54, -2], 'FRANCIA': [46.6, 2.4], 'LETONIA': [56.9, 24.6], 'MEXICO': [23.6, -102.5],
    'PARAGUAY': [-23.4, -58.4], 'ALEMANIA': [51.2, 10.4], 'COSTA RICA': [9.9, -84.1], 'CANADA': [56.1, -106.3] };
  const COORD_PROV = { 'CABA': [-34.61, -58.44], 'BUENOS AIRES': [-36.5, -60.3], 'SALTA': [-24.79, -65.41], 'LA PAMPA': [-36.62, -64.29], 'ENTRE RIOS': [-31.75, -59.2],
    'MENDOZA': [-32.89, -68.84], 'MISIONES': [-27.37, -55.9], 'CORRIENTES': [-28.0, -58.0], 'SANTA FE': [-31.0, -60.9], 'CORDOBA': [-31.42, -64.18],
    'CHACO': [-26.5, -60.5], 'NEUQUEN': [-38.95, -68.06], 'JUJUY': [-23.0, -65.6], 'TUCUMAN': [-26.82, -65.22], 'SAN JUAN': [-31.54, -68.52],
    'RIO NEGRO': [-40.8, -67.5], 'CHUBUT': [-43.3, -68.5], 'SAN LUIS': [-33.3, -66.34], 'TIERRA DEL FUEGO': [-54.0, -67.9] };
  let map = null, layer = null, mapModo = 'pais', lfState = 'idle';
  const lfWait = [];
  function loadLeaflet(cb) {
    if (window.L) { cb(true); return; }
    lfWait.push(cb);
    if (lfState === 'loading') return;
    lfState = 'loading';
    const done = ok => { lfState = ok ? 'ready' : 'failed'; lfWait.splice(0).forEach(fn => fn(ok)); };
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
    document.head.appendChild(css);
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    sc.onload = () => done(true); sc.onerror = () => done(false);
    document.head.appendChild(sc);
  }
  function mapPoints(all) {
    const isProv = mapModo === 'prov';
    const rows = isProv ? all.filter(f => D.pais[f[I.pais]] === 'ARGENTINA') : all;
    const idx = isProv ? I.provincia : I.pais, dimName = isProv ? 'provincia' : 'pais', coords = isProv ? COORD_PROV : COORD_PAIS;
    const pts = [], sin = zero();
    groupBy(rows, idx).forEach(a => {
      const raw = D[dimName][a.k];
      const top = groupBy(rows.filter(f => f[idx] === a.k), I.cliente).sort((x, y) => y.usd - x.usd)[0];
      if (coords[raw]) pts.push({ raw, a, top }); else { sin.usd += a.usd; sin.cajas += a.cajas; }
    });
    return { pts, sin, rows };
  }
  function drawMap() {
    const box = $('mapBox'), isProv = mapModo === 'prov';
    const mp = mapPoints(rowsFiltradas()), pts = mp.pts, sin = mp.sin, totR = total(mp.rows);
    $('mapTitle').textContent = isProv ? 'Mapa — Argentina por provincia' : 'Mapa Mundial — Ventas por País';
    $('mapNote').textContent = !mp.rows.length ? 'Sin datos para la selección de filtros.' : (isProv ? 'Provincias de Argentina. ' : '') + (sin.usd === 0
      ? (isProv ? 'Todas las ventas de Argentina tienen provincia cargada.' : 'Todas las ventas tienen país cargado.')
      : `Sin ubicación en el mapa (${isProv ? 'sin provincia cargada en Redline' : 'sin país cargado en Redline, zona DTC'}): ${money(sin.usd)} — ${pct(totR.usd ? sin.usd / totR.usd : 0)} de ${isProv ? 'las ventas de Argentina' : 'las ventas del filtro'}.`);
    if (!window.L) return;
    if (!map) {
      box.innerHTML = ''; box.style.display = 'block';
      map = L.map(box, { center: [15, 10], zoom: 2, worldCopyJump: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    const mx = Math.max.apply(null, pts.map(p => p.a.usd).concat([1])), coords = isProv ? COORD_PROV : COORD_PAIS, rmax = isProv ? 17 : 26;
    pts.forEach(p => {
      const top = p.top ? `<div style="margin-top:6px;font-size:11px;color:#5b6b85">Top cliente: <b>${esc(nombrePropio(D.cliente[p.top.k]))}</b> (${money(p.top.usd)})</div>` : '';
      L.circleMarker(coords[p.raw], { radius: 5 + Math.sqrt(Math.max(p.a.usd, 0) / mx) * rmax, color: '#7D4E5B', fillColor: '#DCBE84', fillOpacity: 0.6, weight: 1.8 })
        .bindPopup(`<div><div style="font-weight:600;color:#14110c;margin-bottom:4px">${esc(nombrePropio(p.raw))}</div><div style="font-size:12px;color:#4a4030">Ventas: ${money(p.a.usd)}</div><div style="font-size:12px;color:#33415a">Cajas 9L: ${int(p.a.cajas)}</div><div style="font-size:12px;color:#33415a">Precio prom.: ${price(avgPrice(p.a))}</div>${top}</div>`)
        .addTo(layer);
    });
    if (isProv) map.fitBounds([[-55, -74], [-22, -53]]); else map.setView([15, 10], 2);
    setTimeout(() => map.invalidateSize(), 50);
  }
  function initMap() {
    drawMap(); // deja la nota lista aunque el mapa todavía no cargue
    if (window.L) return;
    loadLeaflet(ok => {
      if (ok) drawMap();
      else $('mapBox').textContent = 'No se pudo cargar el mapa (requiere conexión a internet). La tabla de arriba tiene los mismos datos.';
    });
  }

  // ---------- navegación ----------
  const VIEWS = { snap: 'view-snap', panel: 'view-panel', region: 'view-region' };
  const TITULOS = { snap: 'Sales Performance', panel: 'Panel de Ventas', region: 'Ventas por Región' };
  function refresh() {
    renderPanel();
    if (st.vista === 'region') { renderRegion(); drawMap(); }
  }
  function show(v) {
    if (!VIEWS[v]) v = 'snap';
    st.vista = v;
    Object.keys(VIEWS).forEach(k => { $(VIEWS[k]).hidden = k !== v; });
    $('sbSnap').hidden = v !== 'snap';
    $('sbFilt').hidden = v === 'snap';
    $('sbTitle').textContent = TITULOS[v];
    if (v !== 'region' && map) { map.remove(); map = null; layer = null; $('mapBox').textContent = 'Cargando mapa…'; $('mapBox').style.display = ''; } // libera las capas del mapa al salir de la vista
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    if (v === 'region') { renderRegion(); initMap(); }
    try { history.replaceState(null, '', '#' + v); } catch (e) { /* file:// puede bloquearlo */ }
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  // ---------- eventos ----------
  buildSidebar();
  renderPeriodoChips();
  const side = $('sbFilt');
  side.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.p) { if (t.checked) st.periodos.add(t.dataset.p); else st.periodos.delete(t.dataset.p); }
    else if (t.dataset.f) { const s = st[t.dataset.f], v = Number(t.dataset.v); if (t.checked) s.add(v); else s.delete(v); }
    else if (t.id === 'pvBud') { st.comparar = t.checked; }
    else if (t.id === 'pvEjercicio') {
      st.ejercicio = t.value;
      st.periodos = periodosDefaultPara(st.ejercicio);
      renderPeriodoChips();
    }
    refresh();
  });
  side.addEventListener('click', e => {
    if (e.target.id !== 'pvClear') return;
    FILTROS.forEach(f => { st[f.key].clear(); if (f.key === 'brand') DEFAULT_BRAND.forEach(i => st.brand.add(i)); });
    st.periodos = periodosConDato(st.ejercicio);
    side.querySelectorAll('input[data-f]').forEach(i => { i.checked = st[i.dataset.f].has(Number(i.dataset.v)); });
    renderPeriodoChips();
    refresh();
  });
  $('sbSnap').addEventListener('change', e => { if (e.target.name === 'snapPeriod') render(e.target.value); });
  $('view-panel').addEventListener('change', e => {
    if (e.target.name === 'pvMetrica') { st.metrica = e.target.value; renderPanel(); }
    else if (e.target.name === 'pvDim') { st.dim = e.target.value; st.dgSort = 'usd'; st.dgDir = 'desc'; renderPanel(); }
  });
  $('view-panel').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const col = th.dataset.sort;
    if (st.dgSort === col) { st.dgDir = st.dgDir === 'asc' ? 'desc' : 'asc'; }
    else { st.dgSort = col; st.dgDir = col === 'nombre' ? 'asc' : 'desc'; }
    renderPanel();
  });
  const rgT = $('rgTable');
  rgT.addEventListener('click', e => { const tr = e.target.closest('tr[data-k]'); if (tr) toggleKey(tr.dataset.k); });
  rgT.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('tr[data-k]'); if (tr) { e.preventDefault(); toggleKey(tr.dataset.k); } });
  // Un solo botón cuyo texto y acción dependen del estado real del árbol (norma: nunca "Expandir todo" con todo ya expandido)
  $('rgToggle').addEventListener('click', () => {
    if (todoAbierto()) { openZ.clear(); openP.clear(); }
    else TREE.forEach(z => { openZ.add('z:' + z.k); z.paises.forEach(p => openP.add(`p:${z.k}::${p.k}`)); });
    renderRegion();
  });
  $('view-region').addEventListener('change', e => {
    if (e.target.name === 'mapModo') { mapModo = e.target.value; drawMap(); }
  });
  document.querySelectorAll('input[name="snapTab"]').forEach(r => {
    r.addEventListener('change', e => {
      const fm = e.target.value === 'fdelmotte';
      $('snapConsolidado').hidden = fm;
      $('snapFdelMotte').hidden = !fm;
      if (fm) renderSnapFdelMotte();
    });
  });

  renderPanel();
  renderSnapFdelMotte();
  show((location.hash || '').replace('#', ''));
  // Los 3 pills de Ventas ahora viven en el nav compartido (AppShell, fuera
  // de este script) y navegan por hash plano (<a href="/#snap"> etc, ver
  // colome-ventas-app/frontend/src/components/AppShell.tsx) en vez de los
  // botones .tabs internos de la versión standalone del mock -- escuchar
  // hashchange para que el click en esos pills siga disparando show().
  window.addEventListener('hashchange', () => show((location.hash || '').replace('#', '')));
})();