// ============================================
// Charts, Calendar, Statistics & PDF
// ============================================

let calendarYear, calendarMonth;

// ---- Calendar View ----

async function refreshCalendarView() {
  const now = new Date();
  if (!calendarYear) { calendarYear = now.getFullYear(); calendarMonth = now.getMonth(); }
  const allEntries = await getAllEntries();
  const settings = await getSettings();
  renderCalendarMonth(calendarYear, calendarMonth, allEntries, settings);
}

function renderCalendarMonth(year, month, allEntries, settings) {
  const container = document.getElementById('calendar-grid');
  const label = document.getElementById('cal-month-label');
  if (!container || !label) return;

  const monthNames = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  label.textContent = monthNames[month] + ' ' + year;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Monday = 0

  // Precompute daily scores
  const dayScores = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEntries = allEntries.filter(e => e.date && e.date.startsWith(ds));
    if (dayEntries.length > 0) {
      dayScores[d] = calculateDayScore(dayEntries, settings).score;
    }
  }

  let html = '<div class="cal-header">Mo</div><div class="cal-header">Di</div><div class="cal-header">Mi</div><div class="cal-header">Do</div><div class="cal-header">Fr</div><div class="cal-header">Sa</div><div class="cal-header">So</div>';

  for (let i = 0; i < startOffset; i++) html += '<div class="cal-cell empty"></div>';

  const today = new Date().toISOString().split('T')[0];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const score = dayScores[d];
    let dotClass = 'no-data';
    if (score !== undefined) {
      dotClass = score >= 70 ? 'good' : score >= 50 ? 'okay' : 'bad';
    }
    const isToday = ds === today ? ' today' : '';
    html += `<div class="cal-cell${isToday}" onclick="calendarDayClick('${ds}')"><span class="cal-day">${d}</span><span class="cal-dot ${dotClass}"></span></div>`;
  }

  container.innerHTML = html;
}

function calendarPrevMonth() {
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  refreshCalendarView();
}

function calendarNextMonth() {
  const now = new Date();
  if (calendarYear >= now.getFullYear() && calendarMonth >= now.getMonth()) return;
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  refreshCalendarView();
}

function calendarDayClick(dateStr) {
  document.getElementById('date-picker').value = dateStr;
  switchHistoryTab('day');
  refreshHistoryView();
}

// ---- Statistics View ----

async function refreshStatsView(period) {
  const allEntries = await getAllEntries();
  const settings = await getSettings();
  renderStatistics(period || 7, allEntries, settings);
}

function renderStatistics(days, allEntries, settings) {
  const container = document.getElementById('stats-content');
  if (!container) return;

  const today = new Date();
  const currentPeriod = [];
  const prevPeriod = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const entries = allEntries.filter(e => e.date && e.date.startsWith(ds));
    currentPeriod.push({
      date: ds,
      kcal: entries.reduce((s, e) => s + (e.totalKcal || 0), 0),
      protein: entries.reduce((s, e) => s + (e.totalProtein || 0), 0),
      carbs: entries.reduce((s, e) => s + (e.totalCarbs || 0), 0),
      fat: entries.reduce((s, e) => s + (e.totalFat || 0), 0),
      sugar: entries.reduce((s, e) => s + (e.totalSugar || 0), 0),
      score: entries.length > 0 ? calculateDayScore(entries, settings).score : null,
      entries: entries.length
    });

    const dp = new Date(today); dp.setDate(dp.getDate() - i - days);
    const dps = dp.toISOString().split('T')[0];
    const pe = allEntries.filter(e => e.date && e.date.startsWith(dps));
    prevPeriod.push({
      kcal: pe.reduce((s, e) => s + (e.totalKcal || 0), 0),
      protein: pe.reduce((s, e) => s + (e.totalProtein || 0), 0)
    });
  }

  const daysWithData = currentPeriod.filter(d => d.entries > 0);
  const n = daysWithData.length || 1;
  const avgKcal = daysWithData.reduce((s, d) => s + d.kcal, 0) / n;
  const avgProtein = daysWithData.reduce((s, d) => s + d.protein, 0) / n;
  const avgCarbs = daysWithData.reduce((s, d) => s + d.carbs, 0) / n;
  const avgFat = daysWithData.reduce((s, d) => s + d.fat, 0) / n;
  const avgSugar = daysWithData.reduce((s, d) => s + d.sugar, 0) / n;

  const prevN = prevPeriod.filter(d => d.kcal > 0).length || 1;
  const prevAvgKcal = prevPeriod.reduce((s, d) => s + d.kcal, 0) / prevN;
  const prevAvgProtein = prevPeriod.reduce((s, d) => s + d.protein, 0) / prevN;

  // Best/Worst day
  const scored = currentPeriod.filter(d => d.score !== null);
  const best = scored.length ? scored.reduce((a, b) => a.score > b.score ? a : b) : null;
  const worst = scored.length ? scored.reduce((a, b) => a.score < b.score ? a : b) : null;

  const trend = (cur, prev) => {
    const diff = cur - prev;
    if (Math.abs(diff) < prev * 0.05) return { arrow: '\u2192', color: '#888' };
    return diff > 0 ? { arrow: '\u2191', color: '#f97316' } : { arrow: '\u2193', color: '#22c55e' };
  };

  const kcalTrend = trend(avgKcal, prevAvgKcal);
  const proteinTrend = trend(avgProtein, prevAvgProtein);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-val">${Math.round(avgKcal)} <span class="trend" style="color:${kcalTrend.color}">${kcalTrend.arrow}</span></div><div class="stat-label">\u00D8 kcal/Tag</div></div>
      <div class="stat-card"><div class="stat-val">${Math.round(avgProtein)}g <span class="trend" style="color:${proteinTrend.color}">${proteinTrend.arrow}</span></div><div class="stat-label">\u00D8 Protein</div></div>
      <div class="stat-card"><div class="stat-val">${Math.round(avgCarbs)}g</div><div class="stat-label">\u00D8 Carbs</div></div>
      <div class="stat-card"><div class="stat-val">${Math.round(avgFat)}g</div><div class="stat-label">\u00D8 Fett</div></div>
      <div class="stat-card"><div class="stat-val">${Math.round(avgSugar)}g</div><div class="stat-label">\u00D8 Zucker</div></div>
    </div>
    ${best ? `<div class="best-worst"><span class="bw-icon">\u{1F3C6}</span> <strong>Bester Tag:</strong> ${formatDateShort(best.date)} — ${best.score} Punkte</div>` : ''}
    ${worst && worst !== best ? `<div class="best-worst warn"><span class="bw-icon">\u26A0\uFE0F</span> <strong>Schwaechster Tag:</strong> ${formatDateShort(worst.date)} — ${worst.score} Punkte</div>` : ''}
    <div class="chart-section">
      <h4>Kalorien-Verlauf</h4>
      <svg id="kcal-chart" viewBox="0 0 320 160" class="stats-chart"></svg>
    </div>
    <div class="chart-section">
      <h4>Score-Verlauf</h4>
      <svg id="score-chart" viewBox="0 0 320 160" class="stats-chart"></svg>
    </div>
  `;

  renderKcalLineChart('kcal-chart', currentPeriod.reverse(), settings.dailyKcal || 2000);
  renderScoreBarChart('score-chart', currentPeriod);
}

function formatDateShort(ds) {
  const d = new Date(ds);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

// ---- SVG Charts ----

function renderKcalLineChart(svgId, data, goal) {
  const svg = document.getElementById(svgId);
  if (!svg) return;

  const W = 320, H = 160, pad = 30;
  const n = data.length;
  if (n === 0) { svg.innerHTML = ''; return; }

  const maxVal = Math.max(goal * 1.3, ...data.map(d => d.kcal)) || 1;
  const xStep = (W - pad * 2) / Math.max(n - 1, 1);

  const points = data.map((d, i) => {
    const x = pad + i * xStep;
    const y = H - pad - ((d.kcal / maxVal) * (H - pad * 2));
    return { x, y, d };
  });

  const goalY = H - pad - ((goal / maxVal) * (H - pad * 2));
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const area = `${points[0].x},${H - pad} ` + polyline + ` ${points[n - 1].x},${H - pad}`;

  svg.innerHTML = `
    <line x1="${pad}" y1="${goalY}" x2="${W - pad}" y2="${goalY}" stroke="#f97316" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>
    <text x="${W - pad + 2}" y="${goalY + 3}" fill="#f97316" font-size="8">Ziel</text>
    <polygon points="${area}" fill="rgba(249,115,22,0.15)"/>
    <polyline points="${polyline}" fill="none" stroke="#f97316" stroke-width="2"/>
    ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#f97316"/>`).join('')}
    ${points.filter((_, i) => i % Math.ceil(n / 7) === 0 || i === n - 1).map(p =>
      `<text x="${p.x}" y="${H - 8}" text-anchor="middle" fill="#888" font-size="7">${p.d.date.slice(5)}</text>`
    ).join('')}
  `;
}

function renderScoreBarChart(svgId, data) {
  const svg = document.getElementById(svgId);
  if (!svg) return;

  const W = 320, H = 160, pad = 30;
  const n = data.length;
  if (n === 0) { svg.innerHTML = ''; return; }

  const barW = Math.min(20, (W - pad * 2) / n - 2);
  const xStep = (W - pad * 2) / n;

  svg.innerHTML = data.map((d, i) => {
    const score = d.score || 0;
    const barH = (score / 100) * (H - pad * 2);
    const x = pad + i * xStep + (xStep - barW) / 2;
    const y = H - pad - barH;
    const color = score >= 70 ? '#22c55e' : score >= 50 ? '#f97316' : '#ef4444';
    const label = i % Math.ceil(n / 7) === 0 || i === n - 1 ? `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" fill="#888" font-size="7">${d.date.slice(5)}</text>` : '';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2" fill="${color}" opacity="0.8"/>${label}`;
  }).join('') + `<line x1="${pad}" y1="${H - pad - ((70 / 100) * (H - pad * 2))}" x2="${W - pad}" y2="${H - pad - ((70 / 100) * (H - pad * 2))}" stroke="#22c55e" stroke-width="1" stroke-dasharray="4,4" opacity="0.4"/>`;
}

// ---- PDF Export ----

async function generateMonthlyPDF() {
  // Lazy-load jsPDF
  if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined') {
    showToast('Lade PDF-Engine...');
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    } catch (e) {
      showToast('PDF-Engine konnte nicht geladen werden (offline?)');
      return;
    }
  }

  const PDF = (typeof jspdf !== 'undefined') ? jspdf.jsPDF : (typeof jsPDF !== 'undefined' ? jsPDF : null);
  if (!PDF) { showToast('PDF-Engine nicht verfuegbar'); return; }

  showToast('Erstelle Monatsbericht...');

  const allEntries = await getAllEntries();
  const settings = await getSettings();
  const weights = await getAllWeights();

  // Month selection (from picker, fallback to current month)
  const picker = document.getElementById('pdf-month-picker');
  let year, month;
  if (picker && picker.value) {
    [year, month] = picker.value.split('-').map(Number);
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const monthEntries = allEntries.filter(e => e.date && e.date.startsWith(monthStr));

  if (monthEntries.length === 0) {
    showToast('Keine Daten fuer diesen Monat');
    return;
  }

  const doc = new PDF();
  doc.setFontSize(18);
  doc.text('EssenTracker Monatsbericht', 14, 22);
  doc.setFontSize(12);
  const monthNames = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  doc.text(monthNames[month - 1] + ' ' + year, 14, 32);

  // Summary
  const daysInMonth = new Date(year, month, 0).getDate();
  let totalKcal = 0, totalProtein = 0, daysLogged = new Set();
  monthEntries.forEach(e => {
    totalKcal += e.totalKcal || 0;
    totalProtein += e.totalProtein || 0;
    daysLogged.add(e.date.split('T')[0]);
  });

  doc.setFontSize(11);
  let y = 45;
  doc.text(`Tage geloggt: ${daysLogged.size} / ${daysInMonth}`, 14, y); y += 8;
  doc.text(`Eintraege gesamt: ${monthEntries.length}`, 14, y); y += 8;
  doc.text(`\u00D8 Kalorien/Tag: ${daysLogged.size ? Math.round(totalKcal / daysLogged.size) : 0} kcal`, 14, y); y += 8;
  doc.text(`\u00D8 Protein/Tag: ${daysLogged.size ? Math.round(totalProtein / daysLogged.size) : 0}g`, 14, y); y += 12;

  // Daily table
  doc.setFontSize(13);
  doc.text('Tagesuebersicht', 14, y); y += 8;
  doc.setFontSize(9);
  doc.text('Datum', 14, y); doc.text('kcal', 55, y); doc.text('Protein', 80, y); doc.text('Carbs', 105, y); doc.text('Fett', 130, y); doc.text('Score', 155, y);
  y += 6;

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const de = monthEntries.filter(e => e.date.startsWith(ds));
    if (de.length === 0) continue;
    const dk = de.reduce((s, e) => s + (e.totalKcal || 0), 0);
    const dp = de.reduce((s, e) => s + (e.totalProtein || 0), 0);
    const dc = de.reduce((s, e) => s + (e.totalCarbs || 0), 0);
    const df = de.reduce((s, e) => s + (e.totalFat || 0), 0);
    const sc = calculateDayScore(de, settings).score;
    doc.text(String(d).padStart(2, '0') + '.', 14, y);
    doc.text(Math.round(dk) + '', 55, y);
    doc.text(Math.round(dp) + 'g', 80, y);
    doc.text(Math.round(dc) + 'g', 105, y);
    doc.text(Math.round(df) + 'g', 130, y);
    doc.text(sc + '', 155, y);
    y += 6;
    if (y > 280) { doc.addPage(); y = 20; }
  }

  // Weight section
  const monthWeights = weights.filter(w => w.date.startsWith(monthStr));
  if (monthWeights.length > 0) {
    y += 10;
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFontSize(13);
    doc.text('Gewichtsverlauf', 14, y); y += 8;
    doc.setFontSize(9);
    monthWeights.forEach(w => {
      doc.text(w.date.slice(8) + '.', 14, y);
      doc.text(w.weight.toFixed(1) + ' kg', 40, y);
      y += 6;
    });
  }

  // Download
  const filename = `EssenTracker_${monthStr}.pdf`;
  const blob = doc.output('blob');
  if (navigator.share) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    try { await navigator.share({ files: [file] }); } catch (e) { downloadBlob(blob, filename); }
  } else {
    downloadBlob(blob, filename);
  }
  showToast('PDF erstellt!');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
