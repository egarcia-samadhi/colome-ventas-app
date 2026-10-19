const RAW = JSON.parse(document.getElementById('colome-data').textContent);

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
      <th></th>
      <th class="grp" colspan="1">GM %</th>
    </tr>
    <tr>
      <th>Línea de negocio</th>
      <th>Actual</th><th>Last Year</th><th>% vs LY</th>
      <th></th>
      <th>Actual</th><th>Last Year</th><th>% vs LY</th>
      <th></th>
      <th>Act</th>
    </tr>
  </thead><tbody>`;

  rows.forEach(r => {
    if (r === null) { html += `<tr class="spacer"><td colspan="10"></td></tr>`; return; }
    const isTotal = SBL_TOTAL_ROWS.has(r.label);
    html += `<tr class="${isTotal ? 'total' : ''}">`;
    html += td(r.label, 'label');
    html += td(fmtUsd(r.usd_act));
    html += td(fmtUsd(r.usd_ly));
    html += td(fmtPct(r.usd_vs_ly), pctClass(r.usd_vs_ly));
    html += `<td></td>`;
    html += td(fmtNum(r.lit_act));
    html += td(fmtNum(r.lit_ly));
    html += td(fmtPct(r.lit_vs_ly), pctClass(r.lit_vs_ly));
    html += `<td></td>`;
    html += td(fmtPct(r.gm_act));
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
  html += statTile('GM % Actual', fmtPct(total.gm_act), null, '');
  html += statTile('Doméstico (USD 000s)', '$' + fmtUsd(domestic.usd_act), domestic.usd_vs_ly, 'vs LY');
  html += statTile('Export (USD 000s)', '$' + fmtUsd(exportRow.usd_act), exportRow.usd_vs_ly, 'vs LY');
  document.getElementById('statRow').innerHTML = html;
}

function render(period) {
  renderStats(period);
  document.getElementById('sblTable').innerHTML = renderSbl(period === 'mes' ? RAW.sbl_mes : RAW.sbl_ytd);
}

// Labels del toggle de período (Mes cerrado actual / YTD del ejercicio
// fiscal) -- antes decían "Agosto 2026" fijo, ahora vienen del backend
// (RAW.periodo/desde_ytd/hasta_ytd, ver snap.py).
(function etiquetarPeriodos() {
  const radios = document.querySelectorAll('input[name="snapPeriod"]');
  radios.forEach(r => {
    const label = r.closest('label');
    if (!label) return;
    if (r.value === 'aug') {
      r.value = 'mes';
      label.lastChild.textContent = ' ' + RAW.periodo;
    } else if (r.value === 'ytd') {
      label.lastChild.textContent = ` YTD (${RAW.desde_ytd} a ${RAW.hasta_ytd})`;
    }
  });
})();

document.querySelectorAll('.period-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-toggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render(btn.dataset.period);
  });
});

// El cambio de período (radios "snapPeriod") ya lo escucha app.js por
// delegación en #sbSnap (`$('sbSnap').addEventListener('change', ...)`) --
// no duplicar el listener acá.
render('mes');
