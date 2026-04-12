// ============================================
// App — Hauptlogik, CRUD, Export
// ============================================

const MEAL_LABELS = {
  fruehstueck: 'Fruehstueck',
  mittagessen: 'Mittagessen',
  abendessen: 'Abendessen',
  snacks: 'Snacks'
};
const MEAL_ORDER = ['fruehstueck', 'mittagessen', 'abendessen', 'snacks'];

// ---- Init ----

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const actionBtn = document.getElementById('header-action');
  actionBtn.style.display = 'flex';
  actionBtn.onclick = () => showModal('modal-manual');

  // Show search button on Today tab
  document.getElementById('header-search').style.display = 'flex';

  refreshTodayView();

  // Date picker init
  const picker = document.getElementById('date-picker');
  picker.value = new Date().toISOString().split('T')[0];
  picker.addEventListener('change', refreshHistoryView);

  document.getElementById('date-prev').addEventListener('click', () => {
    const d = new Date(picker.value);
    d.setDate(d.getDate() - 1);
    picker.value = d.toISOString().split('T')[0];
    refreshHistoryView();
  });

  document.getElementById('date-next').addEventListener('click', () => {
    const d = new Date(picker.value);
    const today = new Date().toISOString().split('T')[0];
    d.setDate(d.getDate() + 1);
    if (d.toISOString().split('T')[0] <= today) {
      picker.value = d.toISOString().split('T')[0];
      refreshHistoryView();
    }
  });

  // Edit modal live preview
  ['edit-kcal', 'edit-protein', 'edit-carbs', 'edit-fat', 'edit-grams'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateEditPreview);
  });

  // Quick-add modal live preview
  const quickGrams = document.getElementById('quick-grams');
  if (quickGrams) quickGrams.addEventListener('input', updateQuickPreview);

  // Meal selectors
  document.querySelectorAll('.meal-selector').forEach(setupMealSelector);

  // Product search
  let searchTimer = null;
  let searchController = null;
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      if (searchController) searchController.abort();
      const q = searchInput.value.trim();
      if (q.length < 2) {
        document.getElementById('search-results').innerHTML = '';
        document.getElementById('search-empty').classList.add('hidden');
        return;
      }
      searchTimer = setTimeout(() => searchProducts(q), 300);
    });
  }
});

// ---- Meal Selector ----

function setupMealSelector(container) {
  const btns = container.querySelectorAll('.meal-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function getSelectedMeal(selectorId) {
  const container = document.getElementById(selectorId);
  if (!container) return autoDetectMeal();
  const active = container.querySelector('.meal-btn.active');
  const meal = active ? active.dataset.meal : 'auto';
  return meal === 'auto' ? autoDetectMeal() : meal;
}

function setMealSelector(selectorId, meal) {
  const container = document.getElementById(selectorId);
  if (!container) return;
  const btns = container.querySelectorAll('.meal-btn');
  btns.forEach(b => {
    b.classList.toggle('active', b.dataset.meal === meal);
  });
}

function resetMealSelector(selectorId) {
  setMealSelector(selectorId, 'auto');
}

// ---- Today View ----

async function refreshTodayView() {
  const entries = await getTodayEntries();
  const settings = await getSettings();

  const totalKcal = entries.reduce((s, e) => s + e.totalKcal, 0);
  const totalProtein = entries.reduce((s, e) => s + e.totalProtein, 0);
  const totalCarbs = entries.reduce((s, e) => s + e.totalCarbs, 0);
  const totalFat = entries.reduce((s, e) => s + e.totalFat, 0);

  // Rings
  document.getElementById('today-kcal').textContent = Math.round(totalKcal);
  document.getElementById('today-protein').textContent = Math.round(totalProtein) + 'g';
  setRingProgress('ring-kcal', totalKcal / settings.dailyKcal);
  setRingProgress('ring-protein', totalProtein / settings.dailyProtein);

  // Remaining calories
  const remaining = settings.dailyKcal - totalKcal;
  const remainingEl = document.getElementById('remaining-text');
  if (remaining >= 0) {
    remainingEl.textContent = `Noch ${Math.round(remaining)} kcal uebrig`;
    remainingEl.className = '';
  } else {
    remainingEl.textContent = `${Math.round(Math.abs(remaining))} kcal ueber Ziel`;
    remainingEl.className = 'over';
  }

  // Bars
  updateMacroBar('kcal', totalKcal, settings.dailyKcal, '');
  updateMacroBar('protein', totalProtein, settings.dailyProtein, 'g');
  updateMacroBar('carbs', totalCarbs, 250, 'g');
  updateMacroBar('fat', totalFat, 70, 'g');

  // Entry count
  document.getElementById('entries-header').textContent = `Eintr\u00E4ge (${entries.length})`;

  // Grouped entry list
  const list = document.getElementById('entries-list');
  list.innerHTML = '';
  const empty = document.getElementById('entries-empty');

  if (entries.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    renderGroupedEntries(entries, list);
  }

  // Recent products, water, streak
  await refreshRecentProducts();
  await refreshWaterDisplay();
  await refreshStreak();
}

function renderGroupedEntries(entries, container, opts = {}) {
  const groups = {};
  entries.forEach(e => {
    const meal = e.meal || 'snacks';
    if (!groups[meal]) groups[meal] = [];
    groups[meal].push(e);
  });

  MEAL_ORDER.forEach(meal => {
    if (!groups[meal] || groups[meal].length === 0) return;
    const group = document.createElement('div');
    group.className = 'meal-group';

    const subtotal = groups[meal].reduce((s, e) => s + e.totalKcal, 0);
    const header = document.createElement('div');
    header.className = 'meal-group-header';
    header.innerHTML = `<span class="meal-group-title">${MEAL_LABELS[meal]}</span><span class="meal-group-kcal">${Math.round(subtotal)} kcal</span>`;
    group.appendChild(header);

    groups[meal].forEach(entry => {
      group.appendChild(renderEntryCard(entry, opts));
    });
    container.appendChild(group);
  });
}

function updateMacroBar(name, current, goal, unit) {
  const fill = document.getElementById(`bar-${name}`);
  const text = document.getElementById(`bar-${name}-text`);
  if (fill) {
    const ratio = goal > 0 ? Math.min(current / goal, 1) : 0;
    fill.style.minWidth = (ratio * 100) + '%';
    fill.style.maxWidth = (ratio * 100) + '%';
  }
  if (text) text.textContent = `${Math.round(current)}/${Math.round(goal)}${unit}`;
}

// ---- Water Tracker ----

async function addWater() {
  const today = new Date().toISOString().split('T')[0];
  const log = await getWaterLog(today);
  const glasses = (log ? log.glasses : 0) + 1;
  await saveWaterLog(today, glasses);
  haptic();
  refreshWaterDisplay();
}

async function removeWater() {
  const today = new Date().toISOString().split('T')[0];
  const log = await getWaterLog(today);
  const glasses = Math.max(0, (log ? log.glasses : 0) - 1);
  await saveWaterLog(today, glasses);
  refreshWaterDisplay();
}

async function refreshWaterDisplay() {
  const today = new Date().toISOString().split('T')[0];
  const log = await getWaterLog(today);
  const settings = await getSettings();
  const glasses = log ? log.glasses : 0;
  const goal = settings.dailyWater || 8;

  document.getElementById('water-count').textContent = glasses;
  document.getElementById('water-goal').textContent = goal;
  const fill = document.getElementById('water-progress-fill');
  const ratio = goal > 0 ? Math.min(glasses / goal, 1) : 0;
  fill.style.minWidth = (ratio * 100) + '%';
  fill.style.maxWidth = (ratio * 100) + '%';
}

// ---- Streak ----

async function refreshStreak() {
  const all = await getAllEntries();
  const badge = document.getElementById('streak-badge');
  const countEl = document.getElementById('streak-count');

  // Group by date
  const dates = new Set();
  all.forEach(e => dates.add(e.date.split('T')[0]));

  // Count consecutive days backwards from today
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = d.toISOString().split('T')[0];
    if (dates.has(ds)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  if (streak >= 2) {
    badge.classList.remove('hidden');
    countEl.textContent = streak;
    // Milestone toasts
    if ([7, 14, 30, 60, 90].includes(streak)) {
      showToast(`\u{1F525} ${streak} Tage Streak! Weiter so!`);
    }
  } else {
    badge.classList.add('hidden');
  }
}

// ---- Recent Products ----

async function refreshRecentProducts() {
  const products = await getRecentProducts();
  const section = document.getElementById('recent-products-section');
  const list = document.getElementById('recent-products-list');

  if (products.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = '';

  products.slice(0, 10).forEach(p => {
    const chip = document.createElement('button');
    chip.className = 'recent-chip';
    chip.innerHTML = `<span class="recent-chip-name">${escapeHtml(p.productName)}</span><span class="recent-chip-info">${Math.round(p.kcalPer100)} kcal/100g</span>`;
    chip.addEventListener('click', () => openQuickAdd(p));
    list.appendChild(chip);
  });
}

// ---- Quick Add ----

let quickProduct = null;

const PORTION_PRESETS = [
  { label: '1 Scheibe', grams: 30 },
  { label: '1 Handvoll', grams: 30 },
  { label: '1 Tasse', grams: 250 },
  { label: '1 Portion', grams: 150 },
  { label: '1 Stueck', grams: 80 },
  { label: '1 EL', grams: 15 }
];

function openQuickAdd(product) {
  quickProduct = product;
  resetMealSelector('quick-meal-selector');

  document.getElementById('quick-product-name').textContent = product.productName;
  document.getElementById('quick-kcal').textContent = Math.round(product.kcalPer100);
  document.getElementById('quick-protein').textContent = (product.proteinPer100 || 0).toFixed(1) + 'g';
  document.getElementById('quick-carbs').textContent = (product.carbsPer100 || 0).toFixed(1) + 'g';
  document.getElementById('quick-fat').textContent = (product.fatPer100 || 0).toFixed(1) + 'g';

  const gramsInput = document.getElementById('quick-grams');
  gramsInput.value = product.lastGrams || '';

  const presetsContainer = document.getElementById('portion-presets');
  presetsContainer.innerHTML = '';

  if (product.lastGrams) {
    const btn = document.createElement('button');
    btn.className = 'portion-btn';
    btn.style.borderColor = 'var(--orange)';
    btn.style.color = 'var(--orange)';
    btn.textContent = `Letztes Mal (${product.lastGrams}g)`;
    btn.addEventListener('click', () => { gramsInput.value = product.lastGrams; updateQuickPreview(); });
    presetsContainer.appendChild(btn);
  }

  PORTION_PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.className = 'portion-btn';
    btn.textContent = `${preset.label} (${preset.grams}g)`;
    btn.addEventListener('click', () => { gramsInput.value = preset.grams; updateQuickPreview(); });
    presetsContainer.appendChild(btn);
  });

  showModal('modal-quick');
  updateQuickPreview();
}

function updateQuickPreview() {
  if (!quickProduct) return;
  const g = parseFloat(document.getElementById('quick-grams').value) || 0;
  const total = document.getElementById('quick-total');
  if (g > 0) {
    total.classList.remove('hidden');
    total.innerHTML = `
      <div class="preview-row"><span>Kalorien</span><span class="val kcal">${Math.round(quickProduct.kcalPer100 * g / 100)} kcal</span></div>
      <div class="preview-row"><span>Protein</span><span class="val protein">${Math.round((quickProduct.proteinPer100 || 0) * g / 100)}g</span></div>
      <div class="preview-row"><span>Carbs</span><span class="val carbs">${Math.round((quickProduct.carbsPer100 || 0) * g / 100)}g</span></div>
      <div class="preview-row"><span>Fett</span><span class="val fat">${Math.round((quickProduct.fatPer100 || 0) * g / 100)}g</span></div>
    `;
  } else {
    total.classList.add('hidden');
  }
}

async function saveQuickEntry() {
  if (!quickProduct) return;
  const grams = parseFloat(document.getElementById('quick-grams').value);
  if (!grams || grams <= 0) { showToast('Bitte Gramm eingeben'); return; }

  await addEntry({
    productName: quickProduct.productName,
    kcalPer100: quickProduct.kcalPer100,
    proteinPer100: quickProduct.proteinPer100 || 0,
    carbsPer100: quickProduct.carbsPer100 || 0,
    fatPer100: quickProduct.fatPer100 || 0,
    grams: grams,
    meal: getSelectedMeal('quick-meal-selector')
  });

  hideModal('modal-quick');
  haptic();
  showToast('Gespeichert!');
  quickProduct = null;
  refreshTodayView();
}

// ---- Edit Entry ----

let editingEntry = null;

async function openEditModal(entryId) {
  const all = await dbGetAll('entries');
  const entry = all.find(e => e.id === entryId);
  if (!entry) return;

  editingEntry = entry;
  setMealSelector('edit-meal-selector', entry.meal || 'snacks');

  document.getElementById('edit-name').value = entry.productName;
  document.getElementById('edit-kcal').value = entry.kcalPer100;
  document.getElementById('edit-protein').value = entry.proteinPer100;
  document.getElementById('edit-carbs').value = entry.carbsPer100;
  document.getElementById('edit-fat').value = entry.fatPer100;
  document.getElementById('edit-grams').value = entry.grams;

  showModal('modal-edit');
  updateEditPreview();
}

function updateEditPreview() {
  const kcal = parseFloat(document.getElementById('edit-kcal').value) || 0;
  const protein = parseFloat(document.getElementById('edit-protein').value) || 0;
  const carbs = parseFloat(document.getElementById('edit-carbs').value) || 0;
  const fat = parseFloat(document.getElementById('edit-fat').value) || 0;
  const grams = parseFloat(document.getElementById('edit-grams').value) || 0;
  const preview = document.getElementById('edit-preview');

  if (grams > 0 && kcal > 0) {
    preview.classList.remove('hidden');
    preview.innerHTML = `
      <div class="preview-row"><span>Kalorien</span><span class="val kcal">${Math.round(kcal * grams / 100)} kcal</span></div>
      <div class="preview-row"><span>Protein</span><span class="val protein">${Math.round(protein * grams / 100)}g</span></div>
      <div class="preview-row"><span>Carbs</span><span class="val carbs">${Math.round(carbs * grams / 100)}g</span></div>
      <div class="preview-row"><span>Fett</span><span class="val fat">${Math.round(fat * grams / 100)}g</span></div>
    `;
  } else {
    preview.classList.add('hidden');
  }
}

async function saveEditedEntry() {
  if (!editingEntry) return;
  const name = document.getElementById('edit-name').value.trim();
  const grams = parseFloat(document.getElementById('edit-grams').value);
  if (!name || !grams || grams <= 0) { showToast('Bitte alle Pflichtfelder ausfuellen'); return; }

  editingEntry.productName = name;
  editingEntry.kcalPer100 = parseFloat(document.getElementById('edit-kcal').value) || 0;
  editingEntry.proteinPer100 = parseFloat(document.getElementById('edit-protein').value) || 0;
  editingEntry.carbsPer100 = parseFloat(document.getElementById('edit-carbs').value) || 0;
  editingEntry.fatPer100 = parseFloat(document.getElementById('edit-fat').value) || 0;
  editingEntry.grams = grams;
  editingEntry.meal = getSelectedMeal('edit-meal-selector');

  await updateEntry(editingEntry);
  hideModal('modal-edit');
  haptic();
  showToast('Aktualisiert!');
  editingEntry = null;
  refreshTodayView();
}

// ---- Manual Entry ----

async function saveManualEntry() {
  const name = document.getElementById('manual-name').value.trim();
  const kcal = parseFloat(document.getElementById('manual-kcal').value);
  const grams = parseFloat(document.getElementById('manual-grams').value);

  if (!name || isNaN(kcal) || isNaN(grams) || grams <= 0) {
    showToast('Bitte alle Pflichtfelder ausfuellen');
    return;
  }

  await addEntry({
    productName: name,
    kcalPer100: kcal,
    proteinPer100: parseFloat(document.getElementById('manual-protein').value) || 0,
    carbsPer100: parseFloat(document.getElementById('manual-carbs').value) || 0,
    fatPer100: parseFloat(document.getElementById('manual-fat').value) || 0,
    grams: grams,
    meal: getSelectedMeal('manual-meal-selector')
  });

  hideModal('modal-manual');
  haptic();
  showToast('Gespeichert!');
  refreshTodayView();
}

// ---- Product Search ----

let searchController = null;

async function searchProducts(query) {
  const loading = document.getElementById('search-loading');
  const results = document.getElementById('search-results');
  const emptyEl = document.getElementById('search-empty');

  loading.classList.remove('hidden');
  results.innerHTML = '';
  emptyEl.classList.add('hidden');

  searchController = new AbortController();

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page_size=10&fields=product_name,nutriments,code`,
      { signal: searchController.signal }
    );
    const data = await res.json();
    loading.classList.add('hidden');

    if (!data.products || data.products.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    data.products.forEach(p => {
      if (!p.product_name) return;
      const n = p.nutriments || {};
      const kcal = n['energy-kcal_100g'] || n['energy_100g'] || 0;
      const protein = n['proteins_100g'] || 0;
      const carbs = n['carbohydrates_100g'] || 0;
      const fat = n['fat_100g'] || 0;

      const row = document.createElement('div');
      row.className = 'search-result';
      row.innerHTML = `
        <div class="search-result-info">
          <div class="search-result-name">${escapeHtml(p.product_name)}</div>
          <div class="search-result-kcal">${Math.round(kcal)} kcal | P ${protein.toFixed(1)}g | K ${carbs.toFixed(1)}g | F ${fat.toFixed(1)}g</div>
        </div>
        <button class="search-result-add">+</button>
      `;

      row.querySelector('.search-result-add').addEventListener('click', () => {
        currentProduct = {
          name: p.product_name,
          kcalPer100: kcal,
          proteinPer100: protein,
          carbsPer100: carbs,
          fatPer100: fat
        };
        hideModal('modal-search');
        document.getElementById('product-cache-badge').classList.add('hidden');
        showProductModal(currentProduct);
      });

      results.appendChild(row);
    });
  } catch (e) {
    loading.classList.add('hidden');
    if (e.name !== 'AbortError') showToast('Suchfehler');
  }
}

// ---- Copy Day / Repeat Yesterday ----

async function copyDayToToday() {
  const dateStr = document.getElementById('date-picker').value;
  const entries = await getEntriesForDate(dateStr);
  if (entries.length === 0) return;

  for (const e of entries) {
    await addEntry({
      productName: e.productName,
      kcalPer100: e.kcalPer100,
      proteinPer100: e.proteinPer100,
      carbsPer100: e.carbsPer100,
      fatPer100: e.fatPer100,
      grams: e.grams,
      meal: e.meal || 'snacks'
    });
  }

  haptic();
  showToast(`${entries.length} Eintraege kopiert!`);
  switchTab(document.querySelector('[data-page="page-today"]'));
}

async function repeatYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().split('T')[0];
  const entries = await getEntriesForDate(yesterday);

  if (entries.length === 0) {
    showToast('Gestern keine Eintraege');
    return;
  }

  for (const e of entries) {
    await addEntry({
      productName: e.productName,
      kcalPer100: e.kcalPer100,
      proteinPer100: e.proteinPer100,
      carbsPer100: e.carbsPer100,
      fatPer100: e.fatPer100,
      grams: e.grams,
      meal: e.meal || 'snacks'
    });
  }

  haptic();
  showToast(`${entries.length} Eintraege von gestern kopiert!`);
  refreshTodayView();
}

// ---- History View ----

let currentHistoryTab = 'day';

function switchHistoryTab(tab) {
  currentHistoryTab = tab;
  document.getElementById('htab-day').classList.toggle('active', tab === 'day');
  document.getElementById('htab-week').classList.toggle('active', tab === 'week');
  document.getElementById('history-day').classList.toggle('hidden', tab !== 'day');
  document.getElementById('history-week').classList.toggle('hidden', tab !== 'week');

  if (tab === 'day') refreshHistoryView();
  else refreshWeekView();
}

async function refreshHistoryView() {
  const dateStr = document.getElementById('date-picker').value;
  const entries = await getEntriesForDate(dateStr);
  const settings = await getSettings();

  const totalKcal = entries.reduce((s, e) => s + e.totalKcal, 0);
  const totalProtein = entries.reduce((s, e) => s + e.totalProtein, 0);
  const totalCarbs = entries.reduce((s, e) => s + e.totalCarbs, 0);
  const totalFat = entries.reduce((s, e) => s + e.totalFat, 0);

  const summary = document.getElementById('history-summary');
  summary.innerHTML = `
    <div class="ring-container">
      <svg class="progress-ring" viewBox="0 0 100 100">
        <circle class="ring-bg" cx="50" cy="50" r="42"/>
        <circle class="ring-progress kcal" cx="50" cy="50" r="42"
          style="stroke-dasharray:263.89; stroke-dashoffset:${263.89 * (1 - Math.min(totalKcal / settings.dailyKcal, 1))}"/>
      </svg>
      <div class="ring-label">
        <span class="ring-value">${Math.round(totalKcal)}</span>
        <span class="ring-unit">kcal</span>
      </div>
    </div>
    <div class="ring-container">
      <svg class="progress-ring" viewBox="0 0 100 100">
        <circle class="ring-bg" cx="50" cy="50" r="42"/>
        <circle class="ring-progress protein" cx="50" cy="50" r="42"
          style="stroke-dasharray:263.89; stroke-dashoffset:${263.89 * (1 - Math.min(totalProtein / settings.dailyProtein, 1))}"/>
      </svg>
      <div class="ring-label">
        <span class="ring-value">${Math.round(totalProtein)}g</span>
        <span class="ring-unit">Protein</span>
      </div>
    </div>
  `;

  const macroInfo = document.createElement('div');
  macroInfo.style.cssText = 'display:flex; justify-content:center; gap:16px; padding-bottom:12px;';
  macroInfo.innerHTML = `
    <span style="font-size:12px; color:var(--text-secondary);">
      <span style="display:inline-block;width:8px;height:8px;background:var(--green);border-radius:50%;margin-right:4px;"></span>
      Carbs: ${Math.round(totalCarbs)}g
    </span>
    <span style="font-size:12px; color:var(--text-secondary);">
      <span style="display:inline-block;width:8px;height:8px;background:var(--red);border-radius:50%;margin-right:4px;"></span>
      Fett: ${Math.round(totalFat)}g
    </span>
  `;

  const list = document.getElementById('history-entries');
  list.innerHTML = '';
  list.appendChild(macroInfo);

  const empty = document.getElementById('history-empty');

  if (entries.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    renderGroupedEntries(entries, list, { canDelete: false });
  }

  // Copy day button
  const today = new Date().toISOString().split('T')[0];
  const copyBtn = document.getElementById('btn-copy-day');
  copyBtn.style.display = (entries.length > 0 && dateStr !== today) ? 'block' : 'none';

  document.getElementById('date-next').disabled = (dateStr >= today);
}

// ---- Week View ----

async function refreshWeekView() {
  const allEntries = await getAllEntries();
  const settings = await getSettings();

  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const dailyData = days.map(dateStr => {
    const dayEntries = allEntries.filter(e => e.date.startsWith(dateStr));
    return {
      date: dateStr,
      kcal: dayEntries.reduce((s, e) => s + e.totalKcal, 0),
      protein: dayEntries.reduce((s, e) => s + e.totalProtein, 0),
      count: dayEntries.length
    };
  });

  const daysWithData = dailyData.filter(d => d.count > 0);
  const avgKcal = daysWithData.length > 0 ? daysWithData.reduce((s, d) => s + d.kcal, 0) / daysWithData.length : 0;
  const avgProtein = daysWithData.length > 0 ? daysWithData.reduce((s, d) => s + d.protein, 0) / daysWithData.length : 0;
  const totalKcal = dailyData.reduce((s, d) => s + d.kcal, 0);

  document.getElementById('week-summary').innerHTML = `
    <div class="week-card">
      <h3 class="section-header">Letzte 7 Tage</h3>
      <div class="week-stats">
        <div class="week-stat"><span class="stat-val" style="color:var(--orange)">${Math.round(avgKcal)}</span><span class="stat-label">&#216; kcal/Tag</span></div>
        <div class="week-stat"><span class="stat-val" style="color:var(--blue)">${Math.round(avgProtein)}g</span><span class="stat-label">&#216; Protein</span></div>
        <div class="week-stat"><span class="stat-val" style="color:var(--text-secondary)">${Math.round(totalKcal)}</span><span class="stat-label">Gesamt kcal</span></div>
      </div>
    </div>
  `;

  const daysEl = document.getElementById('week-days');
  daysEl.innerHTML = '';
  const maxKcal = Math.max(settings.dailyKcal, ...dailyData.map(d => d.kcal));
  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  dailyData.forEach(day => {
    const d = new Date(day.date + 'T12:00:00');
    const ratio = maxKcal > 0 ? Math.min(day.kcal / maxKcal, 1) : 0;
    const overGoal = day.kcal > settings.dailyKcal;

    const row = document.createElement('div');
    row.className = 'week-day-row';
    row.innerHTML = `
      <div class="week-day-label">
        <span class="week-day-name">${dayNames[d.getDay()]}</span>
        <span class="week-day-date">${d.getDate()}.${d.getMonth() + 1}.</span>
      </div>
      <div class="week-day-bar">
        <div class="week-day-fill ${overGoal ? 'over' : ''}" style="min-width:${ratio * 100}%;max-width:${ratio * 100}%"></div>
        <div class="week-day-goal" style="left:${(settings.dailyKcal / maxKcal) * 100}%"></div>
      </div>
      <span class="week-day-val">${Math.round(day.kcal)}</span>
    `;
    daysEl.appendChild(row);
  });
}

// ---- Recipes ----

let tempIngredients = [];

async function refreshRecipesView() {
  const recipes = await getAllRecipes();
  const list = document.getElementById('recipes-list');
  const empty = document.getElementById('recipes-empty');
  list.innerHTML = '';

  if (recipes.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    recipes.forEach(recipe => {
      const totalKcal = recipe.ingredients.reduce((s, i) => s + (i.kcalPer100 * i.grams / 100), 0);
      const totalProtein = recipe.ingredients.reduce((s, i) => s + (i.proteinPer100 * i.grams / 100), 0);

      const card = document.createElement('div');
      card.className = 'recipe-card-wrapper';
      card.innerHTML = `
        <div class="recipe-card">
          <div class="recipe-card-left">
            <h4>${escapeHtml(recipe.name)}</h4>
            <p>${recipe.ingredients.length} Zutaten</p>
          </div>
          <div class="recipe-card-right">
            <div class="recipe-card-kcal">${Math.round(totalKcal)} kcal</div>
            <div class="recipe-card-protein">P: ${Math.round(totalProtein)}g</div>
          </div>
        </div>
        <div class="recipe-actions">
          <button class="use" onclick="useRecipe('${recipe.id}')">+ Hinzufuegen</button>
          <button onclick="removeRecipe('${recipe.id}')" style="color:var(--red);border-color:var(--red);">Loeschen</button>
        </div>
      `;
      list.appendChild(card);
    });
  }
  document.getElementById('info-recipes').textContent = recipes.length;
}

function addRecipeIngredient() { showModal('modal-ingredient'); }

function confirmIngredient() {
  const name = document.getElementById('ing-name').value.trim();
  const kcal = parseFloat(document.getElementById('ing-kcal').value) || 0;
  const protein = parseFloat(document.getElementById('ing-protein').value) || 0;
  const carbs = parseFloat(document.getElementById('ing-carbs').value) || 0;
  const fat = parseFloat(document.getElementById('ing-fat').value) || 0;
  const grams = parseFloat(document.getElementById('ing-grams').value) || 0;

  if (!name || grams <= 0) { showToast('Name und Gramm erforderlich'); return; }

  tempIngredients.push({ name, kcalPer100: kcal, proteinPer100: protein, carbsPer100: carbs, fatPer100: fat, grams });
  hideModal('modal-ingredient');
  renderRecipeIngredients();
}

function renderRecipeIngredients() {
  const container = document.getElementById('recipe-ingredients');
  container.innerHTML = '';

  tempIngredients.forEach((ing, i) => {
    const row = document.createElement('div');
    row.className = 'ingredient-row';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(ing.name)}</strong>
        <span style="font-size:12px;color:var(--text-secondary);margin-left:8px;">${ing.grams}g — ${Math.round(ing.kcalPer100 * ing.grams / 100)} kcal</span>
      </div>
      <button class="ing-remove" onclick="removeIngredient(${i})">&#10005;</button>
    `;
    container.appendChild(row);
  });

  const summary = document.getElementById('recipe-summary');
  if (tempIngredients.length > 0) {
    const totalKcal = tempIngredients.reduce((s, i) => s + (i.kcalPer100 * i.grams / 100), 0);
    const totalProtein = tempIngredients.reduce((s, i) => s + (i.proteinPer100 * i.grams / 100), 0);
    const totalCarbs = tempIngredients.reduce((s, i) => s + (i.carbsPer100 * i.grams / 100), 0);
    const totalFat = tempIngredients.reduce((s, i) => s + (i.fatPer100 * i.grams / 100), 0);
    summary.innerHTML = `
      <div><span class="stat-val" style="color:var(--orange)">${Math.round(totalKcal)}</span><span class="stat-label">kcal</span></div>
      <div><span class="stat-val" style="color:var(--blue)">${Math.round(totalProtein)}g</span><span class="stat-label">Protein</span></div>
      <div><span class="stat-val" style="color:var(--green)">${Math.round(totalCarbs)}g</span><span class="stat-label">Carbs</span></div>
      <div><span class="stat-val" style="color:var(--red)">${Math.round(totalFat)}g</span><span class="stat-label">Fett</span></div>
    `;
  } else {
    summary.innerHTML = '';
  }
}

function removeIngredient(index) { tempIngredients.splice(index, 1); renderRecipeIngredients(); }

async function saveRecipe() {
  const name = document.getElementById('recipe-name').value.trim();
  if (!name || tempIngredients.length === 0) { showToast('Name und mindestens 1 Zutat noetig'); return; }

  await saveRecipeDB({ name, ingredients: [...tempIngredients] });
  tempIngredients = [];
  hideModal('modal-recipe');
  haptic();
  showToast('Rezept gespeichert!');
  refreshRecipesView();
}

async function saveRecipeDB(recipe) {
  recipe.id = recipe.id || crypto.randomUUID();
  await dbPut('recipes', recipe);
  return recipe;
}

async function useRecipe(id) {
  const recipe = await dbGet('recipes', id);
  if (!recipe) return;
  await addRecipeAsEntries(recipe);
  haptic();
  showToast('Rezept hinzugefuegt!');
  switchTab(document.querySelector('[data-page="page-today"]'));
}

async function removeRecipe(id) {
  await deleteRecipe(id);
  haptic();
  showToast('Rezept geloescht');
  refreshRecipesView();
}

// ---- Settings ----

async function loadSettingsView() {
  const settings = await getSettings();
  document.getElementById('settings-name').value = settings.userName || '';
  document.getElementById('settings-kcal').value = settings.dailyKcal || 2000;
  document.getElementById('settings-protein').value = settings.dailyProtein || 120;
  document.getElementById('settings-water').value = settings.dailyWater || 8;

  const entries = await getAllEntries();
  const recipes = await getAllRecipes();
  document.getElementById('info-entries').textContent = entries.length;
  document.getElementById('info-recipes').textContent = recipes.length;

  // Weight
  const today = new Date().toISOString().split('T')[0];
  const todayWeight = await getWeight(today);
  if (todayWeight) document.getElementById('settings-weight').value = todayWeight.weight;
  renderWeightChart();
}

async function saveSettings() {
  const settings = {
    userName: document.getElementById('settings-name').value.trim(),
    dailyKcal: parseInt(document.getElementById('settings-kcal').value) || 2000,
    dailyProtein: parseInt(document.getElementById('settings-protein').value) || 120,
    dailyWater: parseInt(document.getElementById('settings-water').value) || 8
  };

  await saveSettingsData(settings);
  haptic();
  showToast('Einstellungen gespeichert!');
  refreshTodayView();
}

// ---- Weight Tracker ----

async function saveWeightEntry() {
  const input = document.getElementById('settings-weight');
  const weight = parseFloat(input.value);
  if (!weight || weight <= 0) { showToast('Bitte Gewicht eingeben'); return; }

  const today = new Date().toISOString().split('T')[0];
  await saveWeight(today, weight);
  haptic();
  showToast('Gewicht gespeichert!');
  renderWeightChart();
}

async function renderWeightChart() {
  const weights = await getAllWeights();
  const trendEl = document.getElementById('weight-trend');
  const chartEl = document.getElementById('weight-chart');

  if (weights.length === 0) {
    trendEl.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;text-align:center;">Noch keine Gewichtsdaten</p>';
    chartEl.innerHTML = '';
    return;
  }

  // Trend: current weight + 7-day change
  const latest = weights[weights.length - 1];
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split('T')[0];
  const weekAgoWeight = weights.find(w => w.date <= weekAgoStr);
  const delta = weekAgoWeight ? (latest.weight - weekAgoWeight.weight) : 0;
  const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  const deltaColor = delta > 0 ? 'var(--red)' : delta < 0 ? 'var(--green)' : 'var(--text-secondary)';

  trendEl.innerHTML = `
    <div><span class="stat-val" style="color:var(--orange)">${latest.weight.toFixed(1)}</span><span class="stat-label">Aktuell (kg)</span></div>
    <div><span class="stat-val" style="color:${deltaColor}">${deltaStr}</span><span class="stat-label">7 Tage</span></div>
  `;

  // Chart: last 30 entries
  const chartData = weights.slice(-30);
  if (chartData.length < 2) {
    chartEl.innerHTML = '';
    return;
  }

  const padding = { top: 10, right: 10, bottom: 25, left: 35 };
  const w = 320, h = 160;
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const vals = chartData.map(d => d.weight);
  const minW = Math.floor(Math.min(...vals) - 1);
  const maxW = Math.ceil(Math.max(...vals) + 1);
  const range = maxW - minW || 1;

  const points = chartData.map((d, i) => {
    const x = padding.left + (i / (chartData.length - 1)) * plotW;
    const y = padding.top + (1 - (d.weight - minW) / range) * plotH;
    return { x, y, ...d };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const area = `${points[0].x},${padding.top + plotH} ${polyline} ${points[points.length - 1].x},${padding.top + plotH}`;

  // Grid lines + labels
  let gridSvg = '';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + (i / steps) * plotH;
    const val = maxW - (i / steps) * range;
    gridSvg += `<line x1="${padding.left}" y1="${y}" x2="${w - padding.right}" y2="${y}" class="chart-grid"/>`;
    gridSvg += `<text x="${padding.left - 4}" y="${y + 3}" text-anchor="end" class="chart-label">${val.toFixed(0)}</text>`;
  }

  // Date labels
  const labelIndices = [0, Math.floor(chartData.length / 2), chartData.length - 1];
  labelIndices.forEach(i => {
    if (points[i]) {
      const d = new Date(chartData[i].date + 'T12:00:00');
      gridSvg += `<text x="${points[i].x}" y="${h - 2}" text-anchor="middle" class="chart-label">${d.getDate()}.${d.getMonth() + 1}.</text>`;
    }
  });

  const dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" class="chart-dot"/>`).join('');

  chartEl.innerHTML = `${gridSvg}<polygon points="${area}" class="chart-area"/><polyline points="${polyline}" class="chart-line"/>${dots}`;
}

// ---- CSV Export ----

async function exportCSV() {
  const entries = await getAllEntries();
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const weekEntries = entries.filter(e => new Date(e.date) >= weekAgo).sort((a, b) => new Date(a.date) - new Date(b.date));

  let csv = 'Datum;Produkt;Gramm;Kalorien;Protein;Kohlenhydrate;Fett\n';
  weekEntries.forEach(e => {
    csv += `${new Date(e.date).toLocaleDateString('de-DE')};${e.productName};${Math.round(e.grams)};${Math.round(e.totalKcal)};${Math.round(e.totalProtein)};${Math.round(e.totalCarbs)};${Math.round(e.totalFat)}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], `EssenTracker_Woche_${now.toISOString().split('T')[0]}.csv`, { type: 'text/csv' });
    try { await navigator.share({ files: [file], title: 'EssenTracker Export' }); return; } catch (e) {}
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EssenTracker_Woche_${now.toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportiert!');
}

// ---- Full Backup ----

async function doFullExport() {
  const jsonStr = await exportFullBackup();
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const now = new Date().toISOString().split('T')[0];

  if (navigator.share && navigator.canShare) {
    const file = new File([blob], `EssenTracker_Backup_${now}.json`, { type: 'application/json' });
    try { await navigator.share({ files: [file], title: 'EssenTracker Backup' }); return; } catch (e) {}
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EssenTracker_Backup_${now}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup erstellt!');
}

async function doFullImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importFullBackup(text);
    haptic();
    showToast('Backup wiederhergestellt!');
    refreshTodayView();
    loadSettingsView();
  } catch (e) {
    showToast('Fehler beim Import');
  }
  event.target.value = '';
}
