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

  // Load theme before anything renders
  const settings = await getSettings();
  applyTheme(settings.theme || 'dark');
  applyUnits(settings.units || 'metric');

  // Check onboarding — if needed, show overlay and wait
  if (typeof checkOnboarding === 'function') {
    const needsOnboarding = await checkOnboarding();
    if (needsOnboarding) return; // onboarding will call initMainApp() when done
  }

  initMainApp();
});

async function initMainApp() {
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
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) {
        document.getElementById('search-results').innerHTML = '';
        document.getElementById('search-empty').classList.add('hidden');
        return;
      }
      searchTimer = setTimeout(() => searchProducts(q), 300);
    });
  }

  // Caffeine quick buttons
  if (typeof renderCaffeineQuickButtons === 'function') renderCaffeineQuickButtons();

  // Notifications check
  if (typeof checkPendingNotifications === 'function') checkPendingNotifications();

  // Update notification toggle states
  updateNotificationToggles();
}

async function updateNotificationToggles() {
  const settings = await getSettings();
  const dailyBtn = document.getElementById('btn-toggle-daily');
  const weeklyBtn = document.getElementById('btn-toggle-weekly');
  if (dailyBtn) {
    dailyBtn.textContent = settings.dailyReminderEnabled ? 'An' : 'Aus';
    dailyBtn.classList.toggle('active', !!settings.dailyReminderEnabled);
  }
  if (weeklyBtn) {
    weeklyBtn.textContent = settings.weeklySummaryEnabled ? 'An' : 'Aus';
    weeklyBtn.classList.toggle('active', !!settings.weeklySummaryEnabled);
  }
}

// ---- Theme / Units ----

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  const sel = document.getElementById('settings-theme');
  if (sel) sel.value = theme;
  // Save preference
  getSettings().then(s => {
    if (s.theme !== theme) {
      s.theme = theme;
      saveSettingsData(s);
    }
  });
}

function applyUnits(units) {
  const label = document.getElementById('weight-unit-label');
  if (label) label.textContent = units === 'imperial' ? 'lbs' : 'kg';
  const sel = document.getElementById('settings-units');
  if (sel) sel.value = units;
  getSettings().then(s => {
    if (s.units !== units) {
      s.units = units;
      saveSettingsData(s);
    }
  });
}

function kgToLbs(kg) { return kg * 2.20462; }
function lbsToKg(lbs) { return lbs / 2.20462; }
function cmToFtIn(cm) {
  const inches = cm / 2.54;
  return { ft: Math.floor(inches / 12), in: Math.round(inches % 12) };
}

function resetOnboarding() {
  // Clear user profile so onboarding shows again
  getUserProfile().then(profile => {
    if (profile) {
      // Delete profile to trigger onboarding
      const tx = db.transaction('userProfile', 'readwrite');
      tx.objectStore('userProfile').clear();
      tx.oncomplete = () => {
        showToast('Onboarding wird beim naechsten Laden angezeigt');
        location.reload();
      };
    } else {
      location.reload();
    }
  });
}

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

  // Extended nutrient totals
  const totalSugar = entries.reduce((s, e) => s + (e.totalSugar || 0), 0);
  const totalFiber = entries.reduce((s, e) => s + (e.totalFiber || 0), 0);
  const totalSatFat = entries.reduce((s, e) => s + (e.totalSaturatedFat || 0), 0);
  const totalSodium = entries.reduce((s, e) => s + (e.totalSodium || 0), 0);
  const totalCalcium = entries.reduce((s, e) => s + (e.totalCalcium || 0), 0);
  const totalIron = entries.reduce((s, e) => s + (e.totalIron || 0), 0);
  const totalVitaminD = entries.reduce((s, e) => s + (e.totalVitaminD || 0), 0);

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

  // Main macro bars
  updateMacroBar('kcal', totalKcal, settings.dailyKcal, '');
  updateMacroBar('protein', totalProtein, settings.dailyProtein, 'g');
  updateMacroBar('carbs', totalCarbs, settings.dailyCarbs || 250, 'g');
  updateMacroBar('fat', totalFat, settings.dailyFat || 70, 'g');

  // Extended nutrient bars
  updateExtendedBar('sugar', totalSugar, settings.dailySugar || 25, 'g');
  updateExtendedBar('fiber', totalFiber, settings.dailyFiber || 25, 'g');
  updateExtendedBar('satfat', totalSatFat, settings.dailySaturatedFat || 20, 'g');
  updateExtendedBar('sodium', totalSodium, settings.dailySodium || 2300, 'mg');
  updateExtendedBar('calcium', totalCalcium, settings.dailyCalcium || 1000, 'mg');
  updateExtendedBar('iron', totalIron, settings.dailyIron || 15, 'mg');
  updateExtendedBar('vitamind', totalVitaminD, settings.dailyVitaminD || 20, '\u00B5g');

  // Sugar traffic light
  updateSugarTrafficLight(totalSugar);

  // Score ring
  if (typeof calculateDayScore === 'function') {
    const { score } = calculateDayScore(entries, settings);
    renderScoreRing('score-ring-container', score);
  }

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

  // Recent products, water, streaks, caffeine, achievements
  await refreshRecentProducts();
  await refreshWaterDisplay();
  await refreshStreaks();
  if (typeof refreshCaffeineDisplay === 'function') await refreshCaffeineDisplay();
}

function updateExtendedBar(name, current, goal, unit) {
  const fill = document.getElementById(`bar-${name}`);
  const text = document.getElementById(`bar-${name}-text`);
  if (fill) {
    const ratio = goal > 0 ? Math.min(current / goal, 1) : 0;
    fill.style.width = (ratio * 100) + '%';
  }
  if (text) {
    if (unit === '\u00B5g') {
      text.textContent = `${current.toFixed(1)}/${goal}${unit}`;
    } else {
      text.textContent = `${Math.round(current)}/${Math.round(goal)}${unit}`;
    }
  }
}

function updateSugarTrafficLight(totalSugar) {
  const dot = document.getElementById('sugar-traffic-light');
  if (!dot) return;
  dot.className = 'traffic-dot';
  if (totalSugar < 25) dot.classList.add('green');
  else if (totalSugar < 50) dot.classList.add('orange');
  else dot.classList.add('red');
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

// ---- Streaks ----

async function refreshStreaks() {
  const all = await getAllEntries();
  const settings = await getSettings();

  // Logging streak
  const loggingStreak = typeof calculateLoggingStreak === 'function'
    ? calculateLoggingStreak(all)
    : calculateBasicStreak(all);

  const badge = document.getElementById('streak-badge');
  const countEl = document.getElementById('streak-count');
  if (loggingStreak >= 2) {
    badge.classList.remove('hidden');
    countEl.textContent = loggingStreak;
  } else {
    badge.classList.add('hidden');
  }

  // Goal streak
  const goalBadge = document.getElementById('goal-streak-badge');
  const goalCountEl = document.getElementById('goal-streak-count');
  if (typeof calculateGoalStreak === 'function' && goalBadge) {
    const goalStreak = calculateGoalStreak(all, settings);
    if (goalStreak >= 2) {
      goalBadge.classList.remove('hidden');
      goalCountEl.textContent = goalStreak;
    } else {
      goalBadge.classList.add('hidden');
    }

    // Check achievements
    if (typeof checkAndAwardAchievements === 'function') {
      checkAndAwardAchievements(loggingStreak, goalStreak);
    }
  }
}

function calculateBasicStreak(allEntries) {
  const dates = new Set();
  allEntries.forEach(e => dates.add(e.date.split('T')[0]));
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
  return streak;
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
    sugarPer100: quickProduct.sugarPer100 || 0,
    fiberPer100: quickProduct.fiberPer100 || 0,
    sodiumPer100: quickProduct.sodiumPer100 || 0,
    saturatedFatPer100: quickProduct.saturatedFatPer100 || 0,
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

  // Extended nutrients
  const sugarEl = document.getElementById('edit-sugar');
  const fiberEl = document.getElementById('edit-fiber');
  const satfatEl = document.getElementById('edit-satfat');
  const sodiumEl = document.getElementById('edit-sodium');
  if (sugarEl) sugarEl.value = entry.sugarPer100 || '';
  if (fiberEl) fiberEl.value = entry.fiberPer100 || '';
  if (satfatEl) satfatEl.value = entry.saturatedFatPer100 || '';
  if (sodiumEl) sodiumEl.value = entry.sodiumPer100 || '';

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
  editingEntry.sugarPer100 = parseFloat(document.getElementById('edit-sugar')?.value) || 0;
  editingEntry.fiberPer100 = parseFloat(document.getElementById('edit-fiber')?.value) || 0;
  editingEntry.saturatedFatPer100 = parseFloat(document.getElementById('edit-satfat')?.value) || 0;
  editingEntry.sodiumPer100 = parseFloat(document.getElementById('edit-sodium')?.value) || 0;
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
    sugarPer100: parseFloat(document.getElementById('manual-sugar')?.value) || 0,
    fiberPer100: parseFloat(document.getElementById('manual-fiber')?.value) || 0,
    saturatedFatPer100: parseFloat(document.getElementById('manual-satfat')?.value) || 0,
    sodiumPer100: parseFloat(document.getElementById('manual-sodium')?.value) || 0,
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
          fatPer100: fat,
          sugarPer100: n['sugars_100g'] || 0,
          fiberPer100: n['fiber_100g'] || 0,
          sodiumPer100: (n['sodium_100g'] || 0) * 1000,
          saturatedFatPer100: n['saturated-fat_100g'] || 0
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
      sugarPer100: e.sugarPer100 || 0,
      fiberPer100: e.fiberPer100 || 0,
      sodiumPer100: e.sodiumPer100 || 0,
      saturatedFatPer100: e.saturatedFatPer100 || 0,
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
      sugarPer100: e.sugarPer100 || 0,
      fiberPer100: e.fiberPer100 || 0,
      sodiumPer100: e.sodiumPer100 || 0,
      saturatedFatPer100: e.saturatedFatPer100 || 0,
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
  ['day', 'week', 'calendar', 'stats'].forEach(t => {
    const btn = document.getElementById(`htab-${t}`);
    const panel = document.getElementById(`history-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (panel) panel.classList.toggle('hidden', t !== tab);
  });

  if (tab === 'day') refreshHistoryView();
  else if (tab === 'week') refreshWeekView();
  else if (tab === 'calendar' && typeof refreshCalendarView === 'function') {
    refreshCalendarView();
  }
  else if (tab === 'stats' && typeof refreshStatsView === 'function') {
    refreshStatsView(7);
    // Pre-fill PDF month picker with current month
    const picker = document.getElementById('pdf-month-picker');
    if (picker && !picker.value) {
      const now = new Date();
      picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
  }
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
        <div class="week-stat"><span class="stat-val" style="color:var(--orange)">${Math.round(avgKcal)}</span><span class="stat-label">\u00D8 kcal/Tag</span></div>
        <div class="week-stat"><span class="stat-val" style="color:var(--blue)">${Math.round(avgProtein)}g</span><span class="stat-label">\u00D8 Protein</span></div>
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
        <span style="font-size:12px;color:var(--text-secondary);margin-left:8px;">${ing.grams}g \u2014 ${Math.round(ing.kcalPer100 * ing.grams / 100)} kcal</span>
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

  // Extended goals
  const carbsEl = document.getElementById('settings-carbs');
  const fatEl = document.getElementById('settings-fat');
  const sugarEl = document.getElementById('settings-sugar');
  const fiberEl = document.getElementById('settings-fiber');
  const satfatEl = document.getElementById('settings-satfat');
  const sodiumEl = document.getElementById('settings-sodium');
  const calciumEl = document.getElementById('settings-calcium');
  const ironEl = document.getElementById('settings-iron');
  const vitamindEl = document.getElementById('settings-vitamind');
  const caffeineEl = document.getElementById('settings-caffeine');

  if (carbsEl) carbsEl.value = settings.dailyCarbs || 250;
  if (fatEl) fatEl.value = settings.dailyFat || 70;
  if (sugarEl) sugarEl.value = settings.dailySugar || 25;
  if (fiberEl) fiberEl.value = settings.dailyFiber || 25;
  if (satfatEl) satfatEl.value = settings.dailySaturatedFat || 20;
  if (sodiumEl) sodiumEl.value = settings.dailySodium || 2300;
  if (calciumEl) calciumEl.value = settings.dailyCalcium || 1000;
  if (ironEl) ironEl.value = settings.dailyIron || 15;
  if (vitamindEl) vitamindEl.value = settings.dailyVitaminD || 20;
  if (caffeineEl) caffeineEl.value = settings.dailyCaffeine || 400;

  // Gemini API key
  const geminiEl = document.getElementById('settings-gemini-key');
  if (geminiEl) geminiEl.value = settings.geminiApiKey || '';

  // Theme + Units
  const themeEl = document.getElementById('settings-theme');
  if (themeEl) themeEl.value = settings.theme || 'dark';
  const unitsEl = document.getElementById('settings-units');
  if (unitsEl) unitsEl.value = settings.units || 'metric';

  // Notification toggles
  updateNotificationToggles();

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
  const current = await getSettings();
  const settings = {
    ...current,
    userName: document.getElementById('settings-name').value.trim(),
    dailyKcal: parseInt(document.getElementById('settings-kcal').value) || 2000,
    dailyProtein: parseInt(document.getElementById('settings-protein').value) || 120,
    dailyWater: parseInt(document.getElementById('settings-water').value) || 8,
    dailyCarbs: parseInt(document.getElementById('settings-carbs')?.value) || 250,
    dailyFat: parseInt(document.getElementById('settings-fat')?.value) || 70,
    dailySugar: parseInt(document.getElementById('settings-sugar')?.value) || 25,
    dailyFiber: parseInt(document.getElementById('settings-fiber')?.value) || 25,
    dailySaturatedFat: parseInt(document.getElementById('settings-satfat')?.value) || 20,
    dailySodium: parseInt(document.getElementById('settings-sodium')?.value) || 2300,
    dailyCalcium: parseInt(document.getElementById('settings-calcium')?.value) || 1000,
    dailyIron: parseInt(document.getElementById('settings-iron')?.value) || 15,
    dailyVitaminD: parseInt(document.getElementById('settings-vitamind')?.value) || 20,
    dailyCaffeine: parseInt(document.getElementById('settings-caffeine')?.value) || 400
  };

  await saveSettingsData(settings);
  haptic();
  showToast('Einstellungen gespeichert!');
  refreshTodayView();
}

async function saveGeminiKey() {
  const el = document.getElementById('settings-gemini-key');
  const key = el?.value.trim();
  if (!key) { showToast('Bitte Key eingeben'); return; }
  if (!key.startsWith('AIza') || key.length < 30) {
    showToast('Key sieht ungueltig aus (beginnt mit AIza)');
    return;
  }
  const current = await getSettings();
  await saveSettingsData({ ...current, geminiApiKey: key });
  haptic();
  showToast('KI-Erkennung aktiviert!');
}

async function clearGeminiKey() {
  const current = await getSettings();
  const { geminiApiKey, ...rest } = current;
  await saveSettingsData(rest);
  const el = document.getElementById('settings-gemini-key');
  if (el) el.value = '';
  haptic();
  showToast('Key entfernt');
}

// ---- Weight Tracker ----

async function saveWeightEntry() {
  const input = document.getElementById('settings-weight');
  let weight = parseFloat(input.value);
  if (!weight || weight <= 0) { showToast('Bitte Gewicht eingeben'); return; }

  // Convert if imperial
  const settings = await getSettings();
  if (settings.units === 'imperial') weight = lbsToKg(weight);

  const today = new Date().toISOString().split('T')[0];
  await saveWeight(today, weight);
  haptic();
  showToast('Gewicht gespeichert!');
  renderWeightChart();
}

async function renderWeightChart() {
  const weights = await getAllWeights();
  const settings = await getSettings();
  const isImperial = settings.units === 'imperial';
  const trendEl = document.getElementById('weight-trend');
  const chartEl = document.getElementById('weight-chart');

  if (weights.length === 0) {
    trendEl.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;text-align:center;">Noch keine Gewichtsdaten</p>';
    chartEl.innerHTML = '';
    return;
  }

  const latest = weights[weights.length - 1];
  const latestVal = isImperial ? kgToLbs(latest.weight) : latest.weight;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split('T')[0];
  const weekAgoWeight = weights.find(w => w.date <= weekAgoStr);
  const deltaKg = weekAgoWeight ? (latest.weight - weekAgoWeight.weight) : 0;
  const delta = isImperial ? kgToLbs(deltaKg) : deltaKg;
  const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  const deltaColor = delta > 0 ? 'var(--red)' : delta < 0 ? 'var(--green)' : 'var(--text-secondary)';
  const unitLabel = isImperial ? 'lbs' : 'kg';

  trendEl.innerHTML = `
    <div><span class="stat-val" style="color:var(--orange)">${latestVal.toFixed(1)}</span><span class="stat-label">Aktuell (${unitLabel})</span></div>
    <div><span class="stat-val" style="color:${deltaColor}">${deltaStr}</span><span class="stat-label">7 Tage</span></div>
  `;

  const chartData = weights.slice(-30);
  if (chartData.length < 2) {
    chartEl.innerHTML = '';
    return;
  }

  const padding = { top: 10, right: 10, bottom: 25, left: 35 };
  const w = 320, h = 160;
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const vals = chartData.map(d => isImperial ? kgToLbs(d.weight) : d.weight);
  const minW = Math.floor(Math.min(...vals) - 1);
  const maxW = Math.ceil(Math.max(...vals) + 1);
  const range = maxW - minW || 1;

  const points = chartData.map((d, i) => {
    const val = isImperial ? kgToLbs(d.weight) : d.weight;
    const x = padding.left + (i / (chartData.length - 1)) * plotW;
    const y = padding.top + (1 - (val - minW) / range) * plotH;
    return { x, y, ...d };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const area = `${points[0].x},${padding.top + plotH} ${polyline} ${points[points.length - 1].x},${padding.top + plotH}`;

  let gridSvg = '';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + (i / steps) * plotH;
    const val = maxW - (i / steps) * range;
    gridSvg += `<line x1="${padding.left}" y1="${y}" x2="${w - padding.right}" y2="${y}" class="chart-grid"/>`;
    gridSvg += `<text x="${padding.left - 4}" y="${y + 3}" text-anchor="end" class="chart-label">${val.toFixed(0)}</text>`;
  }

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

  let csv = 'Datum;Produkt;Gramm;Kalorien;Protein;Kohlenhydrate;Fett;Zucker;Ballaststoffe\n';
  weekEntries.forEach(e => {
    csv += `${new Date(e.date).toLocaleDateString('de-DE')};${e.productName};${Math.round(e.grams)};${Math.round(e.totalKcal)};${Math.round(e.totalProtein)};${Math.round(e.totalCarbs)};${Math.round(e.totalFat)};${Math.round(e.totalSugar || 0)};${Math.round(e.totalFiber || 0)}\n`;
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
