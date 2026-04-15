// ============================================
// Foto-Scanner - Gemini Vision (primary) + Tesseract Fallback
// ============================================

let photoParseResult = null;

function initPhotoTab() {
  const input = document.getElementById('photo-file-input');
  if (input && !input.dataset.bound) {
    input.addEventListener('change', handlePhotoSelected);
    input.dataset.bound = '1';
  }
  // Badge aktualisieren (KI aktiv / OCR-Modus)
  (async () => {
    try {
      const s = await getSettings();
      if (typeof updateGeminiStatusUI === 'function') updateGeminiStatusUI(!!s.geminiApiKey);
    } catch (e) {}
  })();
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
  const status = document.getElementById('photo-status');
  const hint = document.getElementById('photo-hint');

  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.classList.remove('hidden');
  if (hint) hint.classList.add('hidden');
  results.classList.add('hidden');
  processing.classList.remove('hidden');

  let parsed = null;
  let source = 'Manuell';

  try {
    // 1) Try Gemini first if API key set
    const settings = await getSettings();
    const geminiKey = settings.geminiApiKey;

    if (geminiKey) {
      try {
        if (status) status.textContent = 'KI analysiert Bild...';
        parsed = await analyzeWithGemini(file, geminiKey);
        if (parsed && parsed.kcal != null) {
          source = 'KI';
        } else {
          parsed = null;
        }
      } catch (geminiErr) {
        console.warn('Gemini failed, falling back to Tesseract:', geminiErr);
      }
    }

    // 2) Fallback: Tesseract OCR
    if (!parsed) {
      if (status) status.textContent = 'OCR analysiert Bild...';
      const ocr = await runOCR(preview);
      if (ocr && ocr.confidence > 0.3) {
        parsed = ocr;
        source = 'OCR';
      } else {
        parsed = ocr || {};
        source = ocr ? 'OCR (unsicher)' : 'Manuell';
      }
    }
  } catch (e) {
    console.error('Photo analysis failed:', e);
    parsed = {};
    source = 'Manuell';
  } finally {
    processing.classList.add('hidden');
    event.target.value = '';
  }

  photoParseResult = parsed || {};
  showPhotoResults(photoParseResult, source);
}

// ============================================
// Gemini Vision
// ============================================

async function analyzeWithGemini(file, apiKey) {
  // Resize + base64-encode before sending (Gemini accepts up to ~20MB but smaller is faster)
  const base64 = await resizeAndEncodeImage(file, 1280);

  const prompt = `Du bist ein erfahrener Ernaehrungs-Experte und analysierst Fotos von Lebensmitteln, Gerichten und Naehrwerttabellen.

ZWEI-PHASEN-VORGEHEN (denke Schritt fuer Schritt, gib aber nur JSON zurueck):
PHASE 1 - IDENTIFIZIEREN:
  Schaue dir das Bild genau an. Was ist zu sehen?
  - Eine Naehrwerttabelle / ein Produktetikett?  -> detectedType = "label"
  - Ein fertig zubereitetes Gericht auf Teller/Schale (Pasta, Lasagne, Pizza, Curry, Burger, Suppe, Bowl...)?  -> detectedType = "dish"
  - Rohe Zutaten oder einzelne Lebensmittel (Obst, Gemuese, Brot, Nuesse...)?  -> detectedType = "raw"
  - Verpacktes Produkt im Regal/Hand?  -> detectedType = "package"
  Erkenne das Gericht beim Namen (z.B. "Lasagne Bolognese", "Hawaii Pizza", "Huehnchen-Curry mit Reis", "Chili con Carne"). Komponenten nennen, wenn moeglich.

PHASE 2 - WERTE ABLEITEN:
  Basierend auf dem identifizierten Gericht: Typische Naehrwerte pro 100g ansetzen.
  Fuer Mischgerichte: durchschnittliche Zusammensetzung annehmen.

WICHTIGE REGEL (asymmetrische Unsicherheit):
- Bei NAEHRWERTTABELLE (detectedType="label"): Nur Werte uebernehmen, die wirklich lesbar sind. Bei unlesbaren Feldern -> 0.
- Bei ESSEN (detectedType="dish", "raw", "package"): IMMER eine realistische Schaetzung liefern. Niemals 0 fuer kcal/protein/carbs/fat setzen nur weil du unsicher bist. Lieber eine plausible Schaetzung auf Basis typischer Rezepte. 0 nur wenn das Nehrwert-Feld naturgemaess 0 ist (z.B. Zucker bei Pommes).

RICHTWERTE FUER MISCHGERICHTE (pro 100g):
- Lasagne Bolognese: ~150 kcal, 8g Protein, 12g Carbs, 7g Fett - typische Portion 350-450g
- Pizza (belegt): ~265 kcal, 11g Protein, 30g Carbs, 11g Fett - typische Portion 300g
- Spaghetti Bolognese: ~150 kcal, 7g Protein, 18g Carbs, 5g Fett - typische Portion 350g
- Huehnchen-Curry mit Reis: ~140 kcal, 8g Protein, 18g Carbs, 4g Fett - typische Portion 400g
- Burger (Cheeseburger): ~260 kcal, 14g Protein, 22g Carbs, 13g Fett - typische Portion 220g
- Doener (Kebab): ~215 kcal, 14g Protein, 18g Carbs, 9g Fett - typische Portion 400g
- Gruener Salat mit Dressing: ~80 kcal, 2g Protein, 5g Carbs, 5g Fett - typische Portion 250g
- Suppe/Eintopf (Gemuese): ~60 kcal, 3g Protein, 8g Carbs, 2g Fett - typische Portion 350g
- Chili con Carne: ~130 kcal, 8g Protein, 13g Carbs, 5g Fett - typische Portion 350g
- Sushi (gemischt): ~150 kcal, 6g Protein, 28g Carbs, 2g Fett - typische Portion 250g
- Bowl mit Reis+Gemuese+Protein: ~140 kcal, 8g Protein, 18g Carbs, 4g Fett - typische Portion 400g

RICHTWERTE FUER EINZELSTUECKE:
1 mittlerer Apfel ~180g, 1 Banane ~120g, 1 Ei ~60g, 1 Scheibe Brot ~30g,
1 Becher Joghurt ~150g, 1 Handvoll Nuesse ~30g, 1 Riegel Schoko ~100g

ANTWORT-SCHEMA (gib NUR dieses JSON zurueck, kein Markdown):
{
  "name": "Produktname auf Deutsch, konkret (max 60 Zeichen)",
  "detectedType": "label" | "dish" | "raw" | "package",
  "kcal": Zahl (pro 100g),
  "protein": Zahl (g pro 100g),
  "carbs": Zahl (g pro 100g),
  "fat": Zahl (g pro 100g),
  "sugar": Zahl (g pro 100g),
  "fiber": Zahl (g pro 100g),
  "saturatedFat": Zahl (g pro 100g),
  "sodium": Zahl (mg pro 100g),
  "portionDesc": "kurze Portionsbeschreibung (max 40 Zeichen), z.B. '1 Teller Lasagne', '1 grosses Stueck Pizza', '1 Becher Joghurt'",
  "portionGrams": Zahl (geschaetztes Gesamtgewicht der sichtbaren Portion in Gramm),
  "confidence": Zahl zwischen 0.0 und 1.0 (wie sicher bist du bei der Identifikation)
}

Gib NUR das JSON zurueck, nichts davor oder danach.`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: leere Antwort');

  // Parse JSON (strip markdown fences if any)
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned);

  return {
    name: (parsed.name || '').toString().slice(0, 80),
    detectedType: parsed.detectedType || '',
    kcal: numOrZero(parsed.kcal),
    protein: numOrZero(parsed.protein),
    carbs: numOrZero(parsed.carbs),
    fat: numOrZero(parsed.fat),
    sugar: numOrZero(parsed.sugar),
    fiber: numOrZero(parsed.fiber),
    saturatedFat: numOrZero(parsed.saturatedFat),
    sodium: numOrZero(parsed.sodium),
    portionDesc: (parsed.portionDesc || '').toString().slice(0, 60),
    portionGrams: numOrZero(parsed.portionGrams),
    confidence: parsed.confidence != null ? numOrZero(parsed.confidence) : 0.8
  };
}

// Text-only variant: schaetzt Naehrwerte aus Gericht-Beschreibung
async function analyzeDishWithGemini(description, apiKey) {
  const prompt = `Du bist ein erfahrener Ernaehrungs-Experte. Der User hat folgendes Gericht gegessen: "${description}".

VORGEHEN:
1. Identifiziere das Gericht genau (welche Kueche, welche Zutaten, wie zubereitet).
2. Wenn der User eine Menge nennt (z.B. "500g Spaghetti", "2 Brotscheiben"), uebernimm sie als portionGrams bzw. rechne Stueckzahlen in Gramm um.
3. Setze realistische Naehrwerte pro 100g auf Basis typischer Rezepte. Niemals 0 fuer kcal/protein/carbs/fat nur aus Unsicherheit - lieber plausibel schaetzen.

RICHTWERTE FUER MISCHGERICHTE (pro 100g):
- Lasagne Bolognese: ~150 kcal, 8g Protein, 12g Carbs, 7g Fett - Portion 350-450g
- Pizza (belegt): ~265 kcal, 11g Protein, 30g Carbs, 11g Fett - Portion 300g
- Spaghetti Bolognese: ~150 kcal, 7g Protein, 18g Carbs, 5g Fett - Portion 350g
- Huehnchen-Curry mit Reis: ~140 kcal, 8g Protein, 18g Carbs, 4g Fett - Portion 400g
- Cheeseburger: ~260 kcal, 14g Protein, 22g Carbs, 13g Fett - Portion 220g
- Doener: ~215 kcal, 14g Protein, 18g Carbs, 9g Fett - Portion 400g
- Burrito: ~220 kcal, 10g Protein, 25g Carbs, 9g Fett - Portion 350g
- Salat mit Dressing: ~80 kcal, 2g Protein, 5g Carbs, 5g Fett - Portion 250g
- Suppe/Eintopf: ~60 kcal, 3g Protein, 8g Carbs, 2g Fett - Portion 350g
- Chili con Carne: ~130 kcal, 8g Protein, 13g Carbs, 5g Fett - Portion 350g
- Sushi (gemischt): ~150 kcal, 6g Protein, 28g Carbs, 2g Fett - Portion 250g
- Bowl: ~140 kcal, 8g Protein, 18g Carbs, 4g Fett - Portion 400g

ANTWORT-SCHEMA (nur dieses JSON, kein Markdown):
{
  "name": "Konkreter Produktname auf Deutsch (max 60 Zeichen)",
  "kcal": Zahl (pro 100g),
  "protein": Zahl (g pro 100g),
  "carbs": Zahl (g pro 100g),
  "fat": Zahl (g pro 100g),
  "sugar": Zahl (g pro 100g),
  "fiber": Zahl (g pro 100g),
  "saturatedFat": Zahl (g pro 100g),
  "sodium": Zahl (mg pro 100g),
  "portionDesc": "kurze deutsche Beschreibung der Portion (max 40 Zeichen)",
  "portionGrams": Zahl (Gesamtgewicht der Portion in Gramm),
  "confidence": Zahl zwischen 0.0 und 1.0
}

Beispiel: "Barbecue Burrito" -> { "name": "Barbecue Burrito", "kcal": 220, "protein": 10, "carbs": 25, "fat": 9, "sugar": 4, "fiber": 3, "saturatedFat": 3, "sodium": 600, "portionDesc": "1 grosser Burrito", "portionGrams": 350, "confidence": 0.85 }

Gib NUR das JSON zurueck, nichts davor oder danach.`;

  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: leere Antwort');

  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned);

  return {
    name: (parsed.name || '').toString().slice(0, 80),
    kcal: numOrZero(parsed.kcal),
    protein: numOrZero(parsed.protein),
    carbs: numOrZero(parsed.carbs),
    fat: numOrZero(parsed.fat),
    sugar: numOrZero(parsed.sugar),
    fiber: numOrZero(parsed.fiber),
    saturatedFat: numOrZero(parsed.saturatedFat),
    sodium: numOrZero(parsed.sodium),
    portionDesc: (parsed.portionDesc || '').toString().slice(0, 60),
    portionGrams: numOrZero(parsed.portionGrams),
    confidence: parsed.confidence != null ? numOrZero(parsed.confidence) : 0.8
  };
}

// Analyse einer ganzen Woche: Gemini bekommt Kurz-Statistik und gibt Freitext-Tipp zurueck
async function analyzeWeekWithGemini(weeklyData, apiKey) {
  const prompt = `Du bist ein freundlicher Ernaehrungs-Coach. Hier sind die Daten eines Nutzers aus den letzten 7 Tagen:

${weeklyData.daysText}

Ziele des Nutzers:
- Kalorien: ${weeklyData.goals.kcal} kcal/Tag
- Protein: ${weeklyData.goals.protein}g/Tag
- Carbs: ${weeklyData.goals.carbs}g/Tag
- Fett: ${weeklyData.goals.fat}g/Tag

Top-Produkte (haeufig gegessen): ${weeklyData.topProducts.join(', ')}

Analysiere kurz (max 8 Saetze, auf Deutsch, in Du-Form) und gib konkrete Tipps:
1. Wie lief die Woche generell? (1 Satz)
2. Was war auffaellig positiv? (1-2 Saetze)
3. Wo gibt es Verbesserungspotential? (2-3 Saetze, konkret)
4. Ein konkreter Tipp fuer naechste Woche (1-2 Saetze)

Antworte NUR als Freitext, kein JSON, kein Markdown. Sei ermutigend aber ehrlich.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: leere Antwort');
  return text.trim();
}

function numOrZero(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

async function resizeAndEncodeImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(img.src);
      resolve(dataUrl.split(',')[1]); // strip "data:image/jpeg;base64,"
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ============================================
// Tesseract OCR (Fallback)
// ============================================

async function runOCR(imageElement) {
  const status = document.getElementById('photo-status');

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
    { keys: ['brennwert', 'kalorien', 'energie', 'energy', 'calories', 'kcal'], field: 'kcal' },
    { keys: ['eiwei', 'protein', 'proteins'], field: 'protein' },
    { keys: ['kohlenhydrat', 'carbohydrate', 'carbs'], field: 'carbs' },
    { keys: ['davon zucker', 'sugars', 'zucker'], field: 'sugar' },
    { keys: ['fett', 'fat'], field: 'fat' },
    { keys: ['gesaettigte', 'saturated', 'davon gesaettigt'], field: 'saturatedFat' },
    { keys: ['ballaststoff', 'fibre', 'fiber'], field: 'fiber' },
    { keys: ['natrium', 'sodium', 'salz', 'salt'], field: 'sodium' }
  ];

  const numberRegex = /(\d+\.?\d*)\s*(kcal|kj|g|mg|µg)?/gi;

  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const p of patterns) {
      if (p.keys.some(k => lower.includes(k))) {
        const nums = [...line.matchAll(numberRegex)];
        if (nums.length > 0) {
          let val = parseFloat(nums[nums.length - 1][1]);
          if (p.field === 'kcal' && nums[nums.length - 1][2] === 'kj') val = Math.round(val / 4.184);
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

// ============================================
// Results Form
// ============================================

function showPhotoResults(parsed, source) {
  const results = document.getElementById('photo-results');
  results.classList.remove('hidden');

  const badgeClass = source === 'KI' ? 'photo-source-badge ki' : 'photo-source-badge';
  const portionHint = parsed.portionDesc
    ? `<div class="photo-portion-hint">
         <svg class="portion-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
           <path d="M4 8 l8 -4 l8 4 l-8 4 z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
           <path d="M4 8 v8 l8 4 v-8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
           <path d="M20 8 v8 l-8 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
         </svg>
         <div class="portion-text">
           <strong>Erkannt:</strong> ${escapeHtml(parsed.portionDesc)}${parsed.portionGrams ? ` &middot; ca. <strong>${Math.round(parsed.portionGrams)} g</strong>` : ''}
           <br><span class="portion-hint-sub">Gramm unten sind vorbef&uuml;llt &mdash; pr&uuml;fen und bei Bedarf anpassen</span>
         </div>
       </div>`
    : '';
  const gramsValue = (parsed.portionGrams && parsed.portionGrams > 0) ? Math.round(parsed.portionGrams) : '';

  results.innerHTML = `
    <div class="${badgeClass}">${source}</div>
    ${portionHint}
    <div class="photo-result-form">
      <label>Produktname</label>
      <input type="text" id="photo-name" placeholder="z.B. Joghurt" class="input" value="${escapeHtml(parsed.name || '')}">
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
      <input type="number" id="photo-grams" class="input" placeholder="z.B. 150" inputmode="decimal" value="${gramsValue}">

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
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-results').classList.add('hidden');
  const hint = document.getElementById('photo-hint');
  if (hint) hint.classList.remove('hidden');
  const tab = document.querySelector('.tab[data-page="page-today"]');
  if (tab) switchTab(tab);
}
