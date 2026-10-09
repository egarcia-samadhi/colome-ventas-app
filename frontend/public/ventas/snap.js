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
// Budget placeholder detector: flag any budget cell that equals exactly 23 (the literal placeholder found in the sheet)
function isPlaceholder(v) {
  return v === 23;
}
function td(content, cls) {
  return `<td class="${cls||''}">${content}</td>`;
}

// ---------- Sales by Line of Business ----------
const SBL_TOTAL_ROWS = new Set(['TOTAL SALES TO THIRD PARTIES', 'TOTAL SALES', 'Total Grupo Colome Brand', 'Total Buyers Own Brand (BOB)', 'Total Intercompany Sales']);

function renderSbl(rows) {
  let html = `<table><thead>
    <tr class="grp">
      <th></th>
      <th class="grp" colspan="5">Sales Value (USD 000s)</th>
      <th></th>
      <th class="grp" colspan="6">9 Litre Equivalent</th>
      <th></th>
      <th class="grp" colspan="2">GM %</th>
    </tr>
    <tr>
      <th>Línea de negocio</th>
      <th>Actual</th><th>Budget</th><th>Last Year</th><th>% vs Bud</th><th>% vs LY</th>
      <th></th>
      <th>Actual</th><th>Budget</th><th>Last Year</th><th>Forecast</th><th>FY Budget</th><th>% vs Bud</th><th>% vs LY</th>
      <th></th>
      <th>Act</th><th>Bud</th>
    </tr>
  </thead><tbody>`;

  rows.forEach(r => {
    if (r === null) { html += `<tr class="spacer"><td colspan="17"></td></tr>`; return; }
    const isTotal = SBL_TOTAL_ROWS.has(r.label);
    html += `<tr class="${isTotal ? 'total' : ''}">`;
    html += td(r.label, 'label');
    html += td(fmtUsd(r.usd_act));
    html += td(fmtUsd(r.usd_bud), isPlaceholder(r.usd_bud) ? 'flagged' : '');
    html += td(fmtUsd(r.usd_ly));
    html += td(fmtPct(r.usd_vs_bud), pctClass(r.usd_vs_bud));
    html += td(fmtPct(r.usd_vs_ly), pctClass(r.usd_vs_ly));
    html += `<td></td>`;
    html += td(fmtNum(r.lit_act));
    html += td(fmtNum(r.lit_bud), isPlaceholder(r.lit_bud) ? 'flagged' : '');
    html += td(fmtNum(r.lit_ly));
    html += td(fmtNum(r.lit_fcst));
    html += td(fmtNum(r.lit_fybud));
    html += td(fmtPct(r.lit_vs_bud), pctClass(r.lit_vs_bud));
    html += td(fmtPct(r.lit_vs_ly), pctClass(r.lit_vs_ly));
    html += `<td></td>`;
    html += td(fmtPct(r.gm_act));
    html += td(fmtPct(r.gm_bud), isPlaceholder(r.gm_bud) ? 'flagged' : '');
    html += `</tr>`;
  });

  html += `</tbody></table>
  <div class="legend-inline">
    <span><span class="swatch" style="background:var(--good)"></span> Por encima de Budget/LY</span>
    <span><span class="swatch" style="background:var(--bad)"></span> Por debajo de Budget/LY</span>
    <span><span class="swatch" style="background:var(--warn-border)"></span> Budget placeholder sin confirmar</span>
  </div>`;
  return html;
}

// ---------- Sales by Market (solo bloque Agosto) ----------
const SBM_TOTAL_ROWS = new Set(['Total Domestic', 'Total Caribbean', 'Total Latin America', 'Europe', 'Total Export', 'Total Branded Wine', 'Total Buyers Own Brand', 'TOTAL ', 'TOTAL']);
const SBM_GROUP_HEADERS = new Set(['Domestic', 'Export', 'Buyers Own Brand']);

function renderSbm(rows) {
  let html = `<table><thead>
    <tr class="grp">
      <th></th>
      <th class="grp" colspan="3">Sales Value (USD 000s)</th>
      <th></th>
      <th class="grp" colspan="3">9 Litre Equivalent</th>
      <th></th>
      <th class="grp" colspan="2">GM %</th>
    </tr>
    <tr>
      <th>Mercado</th>
      <th>Actual</th><th>Budget</th><th>Last Year</th>
      <th></th>
      <th>Actual</th><th>Budget</th><th>Last Year</th>
      <th></th>
      <th>Act</th><th>Bud</th>
    </tr>
  </thead><tbody>`;

  rows.forEach(r => {
    if (r === null) { html += `<tr class="spacer"><td colspan="11"></td></tr>`; return; }
    const label = r.label.trim();
    const isTotal = SBM_TOTAL_ROWS.has(r.label) || SBM_TOTAL_ROWS.has(label);
    const isGroupHeader = SBM_GROUP_HEADERS.has(label) && r.usd_act === null;
    html += `<tr class="${isTotal ? 'total' : ''} ${isGroupHeader ? 'group-header' : ''}">`;
    html += td(r.label, 'label');
    if (isGroupHeader) {
      html += `<td colspan="10"></td></tr>`;
      return;
    }
    html += td(fmtUsd(r.usd_act));
    html += td(fmtUsd(r.usd_bud), isPlaceholder(r.usd_bud) ? 'flagged' : '');
    html += td(fmtUsd(r.usd_ly));
    html += `<td></td>`;
    html += td(fmtNum(r.lit_act));
    html += td(fmtNum(r.lit_bud), isPlaceholder(r.lit_bud) ? 'flagged' : '');
    html += td(fmtNum(r.lit_ly));
    html += `<td></td>`;
    html += td(fmtPct(r.gm_act));
    html += td(fmtPct(r.gm_bud), isPlaceholder(r.gm_bud) ? 'flagged' : '');
    html += `</tr>`;
  });

  html += `</tbody></table>
  <div class="legend-inline">
    <span><span class="swatch" style="background:var(--warn-border)"></span> Budget placeholder sin confirmar</span>
  </div>`;
  return html;
}

// ---------- Stat tiles ----------
function statTile(label, value, delta, deltaLabel) {
  const cls = delta === null ? '' : (delta >= 0 ? 'up' : 'down');
  const arrow = delta === null ? '' : (delta >= 0 ? '▲' : '▼');
  const deltaHtml = delta === null ? '' : `<div class="delta ${cls}">${arrow} ${(Math.abs(delta)*100).toFixed(1)}% ${deltaLabel}</div>`;
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value">${value}</div>${deltaHtml}</div>`;
}

function renderStats(period) {
  const rows = period === 'aug' ? RAW.sbl_aug : RAW.sbl_ytd;
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
  document.getElementById('sblTable').innerHTML = renderSbl(period === 'aug' ? RAW.sbl_aug : RAW.sbl_ytd);
  document.getElementById('sbmTable').innerHTML = renderSbm(RAW.sbm);
}

document.querySelectorAll('.period-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-toggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render(btn.dataset.period);
  });
});

render('aug');