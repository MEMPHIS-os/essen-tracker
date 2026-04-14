// ============================================
// Foto-Scanner — OCR + Edamam Fallback
// ============================================

let photoParseResult = null;

function initPhotoTab() {
  const input = document.getElementById('photo-file-input');
  if (input) input.addEventListener('change', handlePhotoSelected);
}

function openPhotoCapture() {
  document.getElementById('photo-file-input').click();
}

async function handlePhotoSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const preview = document.getElementById('photo-preview');
  const processing = document.getElementById('photo-processing');
  const results = document.getElementById('photo-results');

  // Show preview
  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.classList.remove('hidden');
  results.classList.add('hidden');
  processing.classList.remove('hidden');

  try {
    const parsed = await runOCR(preview);
    if (parsed && parsed.confidence > 0.3) {
      photoParseResult = parsed;
      showPhotoResults(parsed, 'OCR');
    } else {
      // OCR failed or low confidence — show manual entry
      photoParseResult = parsed || {};
      showPhotoResults(photoParseResult, parsed ? 'OCR (unsicher)' : 'Manuell');
    }
  } catch (e) {
    photoParseResult = {};
    showPhotoResults({}, 'Manuell');
  } finally {
    processing.classList.add('hidden');
    event.target.value = '';
  }
}

async function runOCR(imageElement) {
  const status = document.getElementById('photo-status');

  // Lazy-load Tesseract.js
  if (typeof Tesseract === 'undefined') {
    if (status) status.textContent = 'Lade OCR-Engine...';
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  }

  if (status) status.textContent = 'Analysiere Bild...';

  try {
    const worker = await Tesseract.createWorker('deu+eng');
    const { data } = await worker.recognize(imageElement);
    await worker.terminate();
    return parseNutritionText(data.text);
  } catch (e) {
    return null;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function parseNutritionText(text) {
  const lines = text.replace(/,/g, '.').split('\n').map(l => l.trim()).filter(Boolean);
  const result = { confidence: 0 };
  let matches = 0;

  const patterns = [
    { keys: ['brennwert', 'kalorien', 'energie', 'energy', 'calories', 'kcal'], field: 'kcal', unit: 'kcal' },
    { keys: ['eiwei', 'protein', 'proteins'], field: 'protein', unit: 'g' },
    { keys: ['kohlenhydrat', 'carbohydrate', 'carbs'], field: 'carbs', unit: 'g' },
    { keys: ['davon zucker', 'sugars', 'zucker'], field: 'sugar', unit: 'g' },
    { keys: ['fett', 'fat'], field: 'fat', unit: 'g' },
    { keys: ['gesaettigte', 'saturated', 'davon gesaettigt'], field: 'saturatedFat', unit: 'g' },
    { keys: ['ballaststoff', 'fibre', 'fiber'], field: 'fiber', unit: 'g' },
    { keys: ['natrium', 'sodium', 'salz', 'salt'], field: 'sodium', unit: 'mg' }
  ];

  const numberRegex = /(\d+\.?\d*)\s*(kcal|kj|g|mg|µg)?/gi;

  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const p of patterns) {
      if (p.keys.some(k => lower.includes(k))) {
        const nums = [...line.matchAll(numberRegex)];
        if (nums.length > 0) {
          // Take the last number (usually the per-100g value in multi-column tables)
          let val = parseFloat(nums[nums.length - 1][1]);
          // Convert kJ to kcal if needed
          if (p.field === 'kcal' && nums[nums.length - 1][2] === 'kj') val = Math.round(val / 4.184);
          // Convert salt to sodium (mg)
          if ((lower.includes('salz') || lower.includes('salt')) && p.field === 'sodium') val = val * 400;
          result[p.field] = val;
          matches++;
        }
      }
    }
  }

  result.confidence = Math.min(matches / 5, 1);
  return result;
}

function showPhotoResults(parsed, source) {
  const results = document.getElementById('photo-results');
  results.classList.remove('hidden');

  results.innerHTML = `
    <div class="photo-source-badge">${source}</div>
    <div class="photo-result-form">
      <label>Produktname</label>
      <input type="text" id="photo-name" placeholder="z.B. Joghurt" class="input">
      <label>Kalorien (kcal/100g)</label>
      <input type="number" id="photo-kcal" class="input" value="${parsed.kcal || ''}" inputmode="decimal">
      <label>Protein (g/100g)</label>
      <input type="number" id="photo-protein" class="input" value="${parsed.protein || ''}" inputmode="decimal">
      <label>Kohlenhydrate (g/100g)</label>
      <input type="number" id="photo-carbs" class="input" value="${parsed.carbs || ''}" inputmode="decimal">
      <label>Fett (g/100g)</label>
      <input type="number" id="photo-fat" class="input" value="${parsed.fat || ''}" inputmode="decimal">

      <details class="collapsible-section">
        <summary>Erweiterte Naehrwerte</summary>
        <label>Zucker (g/100g)</label>
        <input type="number" id="photo-sugar" class="input" value="${parsed.sugar || ''}" inputmode="decimal">
        <label>Ballaststoffe (g/100g)</label>
        <input type="number" id="photo-fiber" class="input" value="${parsed.fiber || ''}" inputmode="decimal">
        <label>Ges. Fettsaeuren (g/100g)</label>
        <input type="number" id="photo-satfat" class="input" value="${parsed.saturatedFat || ''}" inputmode="decimal">
        <label>Natrium (mg/100g)</label>
        <input type="number" id="photo-sodium" class="input" value="${parsed.sodium || ''}" inputmode="decimal">
      </details>

      <label>Gramm gegessen</label>
      <input type="number" id="photo-grams" class="input" placeholder="z.B. 150" inputmode="decimal">

      <div id="photo-meal-selector" class="meal-selector">
        <button class="meal-btn active" data-meal="auto">Auto</button>
        <button class="meal-btn" data-meal="fruehstueck">Fruehstueck</button>
        <button class="meal-btn" data-meal="mittagessen">Mittag</button>
        <button class="meal-btn" data-meal="abendessen">Abend</button>
        <button class="meal-btn" data-meal="snacks">Snacks</button>
      </div>

      <button class="btn-primary full-width" onclick="savePhotoEntry()">Speichern</button>
    </div>
  `;

  if (typeof setupMealSelector === 'function') {
    const selector = document.getElementById('photo-meal-selector');
    if (selector) setupMealSelector(selector);
  }
}

async function savePhotoEntry() {
  const name = document.getElementById('photo-name').value.trim();
  const kcal = parseFloat(document.getElementById('photo-kcal').value) || 0;
  const grams = parseFloat(document.getElementById('photo-grams').value);

  if (!name) { showToast('Bitte Produktname eingeben'); return; }
  if (!grams || grams <= 0) { showToast('Bitte Gramm eingeben'); return; }

  await addEntry({
    productName: name,
    kcalPer100: kcal,
    proteinPer100: parseFloat(document.getElementById('photo-protein').value) || 0,
    carbsPer100: parseFloat(document.getElementById('photo-carbs').value) || 0,
    fatPer100: parseFloat(document.getElementById('photo-fat').value) || 0,
    sugarPer100: parseFloat(document.getElementById('photo-sugar')?.value) || 0,
    fiberPer100: parseFloat(document.getElementById('photo-fiber')?.value) || 0,
    saturatedFatPer100: parseFloat(document.getElementById('photo-satfat')?.value) || 0,
    sodiumPer100: parseFloat(document.getElementById('photo-sodium')?.value) || 0,
    grams: grams,
    meal: typeof getSelectedMeal === 'function' ? getSelectedMeal('photo-meal-selector') : undefined,
    source: 'photo'
  });

  haptic();
  showToast('Gespeichert!');
  // Reset
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-results').classList.add('hidden');
  // Switch to Protokoll tab
  const tab = document.querySelector('.tab[data-page="page-today"]');
  if (tab) switchTab(tab);
}
