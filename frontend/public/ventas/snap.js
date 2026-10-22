let RAW = JSON.parse(document.getElementById('colome-data').textContent);

function fmtUsd(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return v;
  const n = Math.round(v);
  if (n === 0) return '-'; // norma: un cero real en una tabla se muestra "-"
  return n.toLocaleString('en-US');
}
function fmtNum(v, dec) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return v;
  if (Math.round(v * Math.pow(10, dec || 0)) === 0) return '-'; // norma: un cero real en una tabla se muestra "-"
  return v.toLocaleString('en-US', {minimumFractionDigits: dec||0, maximumFractionDigits: dec||0});
}
function fmtPct(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === 'N/A') return 'N/A';
  if (typeof v !== 'number') return v;
  return (v*100).toFixed(1) + '%';
}
function pctClass(v) {
  if (typeof v !== 'number') return 'na';
  return v >= 0 ? 'pos' : 'neg';
}
function td(content, cls) {
  return `<td class="${cls||''}">${content}</td>`;
}

// ---------- Sales by Line of Business (conectado en vivo 2026-10-19 a
// /api/ventas/snap -- ver backend/snap.py. Sin Budget/Forecast, decisión
// confirmada 2026-10-09: "nunca existió un dato real, se saca". Last Year
// solo si hay dato real del mismo rango un año atrás.) ----------
const SBL_TOTAL_ROWS = new Set(['TOTAL SALES TO THIRD PARTIES', 'TOTAL SALES', 'Total Grupo Colome Brand', 'Total Buyers Own Brand (BOB)', 'Total Intercompany Sales', 'Direct-to-consumer Channel']);

function renderSbl(rows) {
  let html = `<table><thead>
    <tr class="grp">
      <th></th>
      <th class="grp" colspan="3">Sales Value (USD 000s)</th>
      <th></th>
      <th class="grp" colspan="3">9 Litre Equivalent</th>
    </tr>
    <tr>
      <th>Línea de negocio</th>
      <th>Actual</th><th>Last Year</th><th>% vs LY</th>
      <th></th>
      <th>Actual</th><th>Last Year</th><th>% vs LY</th>
    </tr>
  </thead><tbody>`;

  rows.forEach(r => {
    if (r === null) { html += `<tr class="spacer"><td colspan="8"></td></tr>`; return; }
    const isTotal = SBL_TOTAL_ROWS.has(r.label);
    html += `<tr class="${isTotal ? 'total' : ''}">`;
    html += td(`<a href="#" class="sbl-link" data-label="${r.label.replace(/"/g, '&quot;')}">${r.label}</a>`, 'label');
    html += td(fmtUsd(r.usd_act));
    html += td(fmtUsd(r.usd_ly));
    html += td(fmtPct(r.usd_vs_ly), pctClass(r.usd_vs_ly));
    html += `<td></td>`;
    html += td(fmtNum(r.lit_act));
    html += td(fmtNum(r.lit_ly));
    html += td(fmtPct(r.lit_vs_ly), pctClass(r.lit_vs_ly));
    html += `</tr>`;
  });

  html += `</tbody></table>
  <div class="legend-inline">
    <span><span class="swatch" style="background:var(--good)"></span> Por encima de LY</span>
    <span><span class="swatch" style="background:var(--bad)"></span> Por debajo de LY</span>
  </div>`;
  return html;
}

// ---------- Stat tiles ----------
function statTile(label, value, delta, deltaLabel) {
  const cls = delta === null || delta === 'N/A' ? '' : (delta >= 0 ? 'up' : 'down');
  const arrow = delta === null || delta === 'N/A' ? '' : (delta >= 0 ? '▲' : '▼');
  const deltaHtml = (delta === null || delta === 'N/A') ? '' : `<div class="delta ${cls}">${arrow} ${(Math.abs(delta)*100).toFixed(1)}% ${deltaLabel}</div>`;
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value">${value}</div>${deltaHtml}</div>`;
}

function renderStats(period) {
  const rows = period === 'mes' ? RAW.sbl_mes : RAW.sbl_ytd;
  const total = rows.find(r => r && r.label === 'TOTAL SALES');
  const domestic = rows.find(r => r && r.label === 'Grupo Colome Domestic');
  const exportRow = rows.find(r => r && r.label === 'Grupo Colome Export');
  let html = '';
  html += statTile('Total Sales (USD 000s)', '$' + fmtUsd(total.usd_act), total.usd_vs_ly, 'vs LY');
  html += statTile('9L Equivalent (cajas)', fmtNum(total.lit_act), total.lit_vs_ly, 'vs LY');
  html += statTile('Doméstico (USD 000s)', '$' + fmtUsd(domestic.usd_act), domestic.usd_vs_ly, 'vs LY');
  html += statTile('Export (USD 000s)', '$' + fmtUsd(exportRow.usd_act), exportRow.usd_vs_ly, 'vs LY');
  document.getElementById('statRow').innerHTML = html;
}

let periodoActivo = 'mes';

function render(period) {
  periodoActivo = period;
  renderStats(period);
  document.getElementById('sblTable').innerHTML = renderSbl(period === 'mes' ? RAW.sbl_mes : RAW.sbl_ytd);
}

// ---------- Popup "Sales by Market" por línea (2026-10-21, pedido
// explícito de Ezequiel: poder hacer clic en una línea de Sales by Line of
// Business y ver el desglose de esa línea por mercado -- ver
// backend/snap.py::desglose_mercado). Usa el MISMO rango que la pestaña
// activa (Monthly: el mes de RAW.periodo completo; YTD: RAW.desde_ytd/
// RAW.hasta_ytd tal cual los da el backend). ----------
function rangoActivo() {
  if (periodoActivo === 'ytd') return { desde: RAW.desde_ytd, hasta: RAW.hasta_ytd };
  const [y, m] = RAW.periodo.split('-').map(Number);
  const desde = `${RAW.periodo}-01`;
  const ultimoDia = new Date(y, m, 0).getDate(); // día 0 del mes siguiente = último día de este mes
  const hasta = `${RAW.periodo}-${String(ultimoDia).padStart(2, '0')}`;
  return { desde, hasta };
}

function cerrarModalMercado() {
  const m = document.getElementById('sblMercadoModal');
  if (m) m.remove();
}

async function abrirModalMercado(label) {
  cerrarModalMercado();
  const { desde, hasta } = rangoActivo();
  const overlay = document.createElement('div');
  overlay.id = 'sblMercadoModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box">
    <div class="modal-head"><h3>${label} — Sales by Market</h3><button type="button" class="modal-close">&times;</button></div>
    <p class="modal-sub">${desde} a ${hasta}</p>
    <div class="modal-body"><div class="empty">Cargando…</div></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModalMercado(); });
  overlay.querySelector('.modal-close').addEventListener('click', cerrarModalMercado);

  const r = await fetch(`/api/ventas/snap/mercado?label=${encodeURIComponent(label)}&desde=${desde}&hasta=${hasta}`);
  if (r.status === 401) { window.location.href = '/'; return; }
  const data = await r.json();
  const body = overlay.querySelector('.modal-body');
  if (!data.rows.length) {
    body.innerHTML = '<div class="empty">Sin datos para esta línea en el período.</div>';
    return;
  }
  const totalUsd = data.rows.reduce((s, r) => s + r.usd, 0);
  const totalCajas = data.rows.reduce((s, r) => s + r.cajas, 0);
  const rowsOrdenadas = [...data.rows].sort((a, b) => b.usd - a.usd);
  let html = `<table class="tight mkt-table"><thead><tr>
    <th class="l">Mercado</th><th>USD 000s</th><th>Cajas 9L</th><th>% del total</th>
  </tr></thead><tbody>`;
  rowsOrdenadas.forEach(row => {
    const pct = totalUsd ? row.usd / totalUsd * 100 : 0;
    html += `<tr>
      <td class="label">${row.mercado}</td>
      <td>${fmtUsd(row.usd)}</td>
      <td>${fmtNum(row.cajas)}</td>
      <td class="mkt-pct-cell">
        <div class="mkt-bar"><div class="mkt-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="mkt-pct-val">${totalUsd ? pct.toFixed(1) + '%' : '—'}</span>
      </td>
    </tr>`;
  });
  html += `</tbody><tfoot><tr class="total">
    <td class="label">TOTAL</td>
    <td>${fmtUsd(totalUsd)}</td>
    <td>${fmtNum(totalCajas)}</td>
    <td class="mkt-pct-cell"><span class="mkt-pct-val">100%</span></td>
  </tr></tfoot></table>`;
  body.innerHTML = html;
}

document.getElementById('sblTable').addEventListener('click', (e) => {
  const link = e.target.closest('.sbl-link');
  if (!link) return;
  e.preventDefault();
  abrirModalMercado(link.dataset.label);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModalMercado(); });

// Pestañas Monthly/YTD (movidas del sidebar al contenido -- pedido
// explícito de Ezequiel 2026-10-19, "solo exponer sales by line, en dos
// pestañas monthly/ytd"). El botón YTD muestra el rango real del backend
// (RAW.desde_ytd/hasta_ytd, ver snap.py); Monthly muestra RAW.periodo.
function etiquetarPeriodos() {
  const btnYtd = document.querySelector('.period-toggle button[data-period="ytd"]');
  if (btnYtd) btnYtd.textContent = `YTD (${RAW.desde_ytd} a ${RAW.hasta_ytd})`;
}

document.querySelectorAll('.period-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-toggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render(btn.dataset.period);
  });
});

// ---------- Selector de mes en el sidebar (pedido explícito de Ezequiel
// 2026-10-19: "en el sidebar tiene que decir qué mes querés ver... en el
// caso de ytd, hasta qué mes"). Un solo <select> controla ambas pestañas:
// Monthly muestra ESE mes, YTD va desde el inicio del ejercicio fiscal
// HASTA ese mismo mes (así lo arma snap.py) -- elegir un mes distinto
// dispara un refetch de /api/ventas/snap?mes=YYYY-MM. ----------
const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function labelMes(m) {
  const [a, mm] = m.split('-').map(Number);
  return `${NOMBRES_MES[mm - 1]} ${a}`;
}

function poblarSelectorMes() {
  const sel = document.getElementById('snapMesSel');
  if (!sel) return;
  sel.innerHTML = (RAW.meses_disponibles || [])
    .map(m => `<option value="${m}" ${m === RAW.periodo ? 'selected' : ''}>${labelMes(m)}</option>`)
    .join('');
}
poblarSelectorMes();
etiquetarPeriodos();

const snapMesSel = document.getElementById('snapMesSel');
if (snapMesSel) {
  snapMesSel.addEventListener('change', async (e) => {
    const periodoActivo = document.querySelector('.period-toggle button.active')?.dataset.period || 'mes';
    const r = await fetch('/api/ventas/snap?mes=' + encodeURIComponent(e.target.value));
    if (r.status === 401) { window.location.href = '/'; return; }
    RAW = await r.json();
    etiquetarPeriodos();
    render(periodoActivo);
  });
}

render('mes');
