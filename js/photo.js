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
        const reason = classifyGeminiError(geminiErr);
        if (typeof showToast === 'function') {
          showToast(`KI-Analyse fehlgeschlagen: ${reason}`);
        }
      }
    } else if (typeof showToast === 'function') {
      showToast('Kein KI-Key gesetzt — nutze OCR-Fallback');
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

// Klassifiziert Gemini-Fehler in menschenlesbare Kurzgruende fuer Toast.
function classifyGeminiError(err) {
  const msg = (err && err.message ? err.message : String(err)) || '';
  // HTTP-Status-Code aus "Gemini API 403: ..." ziehen
  const statusMatch = msg.match(/Gemini API\s+(\d{3})/);
  if (statusMatch) {
    const code = parseInt(statusMatch[1], 10);
    if (code === 400) return 'Ungueltiger Request (Bild zu gross oder Format-Problem)';
    if (code === 401 || code === 403) return 'Auth-Fehler (Key ungueltig oder gesperrt)';
    if (code === 404) return 'Modell nicht gefunden';
    if (code === 413) return 'Bild zu gross';
    if (code === 429) return 'Rate-Limit erreicht (zu viele Anfragen)';
    if (code >= 500) return `Server-Fehler bei Gemini (${code})`;
    return `HTTP ${code}`;
  }
  if (/Failed to fetch|NetworkError|ERR_NETWORK|TypeError: Failed/i.test(msg)) {
    return 'Netzwerk-Fehler (offline?)';
  }
  if (/leere Antwort/i.test(msg)) return 'Gemini lieferte leere Antwort';
  if (/JSON/i.test(msg)) return 'Antwort nicht parsebar';
  if (/safety|blocked/i.test(msg)) return 'Bild von Safety-Filter blockiert';
  // Fallback: gekuerzter Originaltext
  return msg.slice(0, 80);
}

async function analyzeWithGemini(file, apiKey) {
  // Resize + base64-encode before sending (Gemini accepts up to ~20MB but smaller is faster)
  const base64 = await resizeAndEncodeImage(file, 1280);

  const prompt = `Du bist ein erfahrener Ernaehrungs-Experte und analysierst Fotos von Lebensmitteln, Gerichten und Naehrwerttabellen.

DREI-PHASEN-VORGEHEN (denke Schritt fuer Schritt, gib aber nur JSON zurueck):

PHASE 1 - IDENTIFIZIEREN:
  Schaue dir das Bild genau an. Was ist zu sehen?
  - Eine Naehrwerttabelle / ein Produktetikett?  -> detectedType = "label"
  - EIN fertig zubereitetes MISCHgericht (Lasagne, Pizza, Curry, Burger, Suppe, Bowl - alles in einer Masse/Soße)?  -> detectedType = "dish"
  - EIN TELLER mit MEHREREN getrennten Komponenten (z.B. Fleisch + Gemuese + Beilage nebeneinander, Sushi-Platte, Fruehstuecksteller)?  -> detectedType = "plate"
  - Rohe Zutaten oder einzelne Lebensmittel (Obst, Gemuese, Brot, Nuesse, Glas Milch...)?  -> detectedType = "raw"
  - Verpacktes Produkt im Regal/Hand?  -> detectedType = "package"

PHASE 2 - KOMPONENTEN IDENTIFIZIEREN (nur wenn detectedType="plate"):
  Liste JEDE sichtbare Komponente separat auf. Fuer jede:
  - Name (z.B. "Haehnchenbrust", "Brokkoli", "Kartoffeln")
  - Geschaetzte Gramm (basierend auf sichtbarer Groesse auf dem Teller)
  - Typische Naehrwerte pro 100g fuer diese Komponente
  Bei detectedType="dish"/"raw"/"package": components = [] (leer lassen oder nur eine Komponente).

PHASE 3 - TOP-LEVEL-WERTE ABLEITEN:
  - Bei detectedType="plate": Die Top-Level-Werte (kcal, protein, ...) sind der GEWICHTETE DURCHSCHNITT aller Komponenten pro 100g.
    Formel: totalKcal = Summe(kcal_i * grams_i / 100); totalGrams = Summe(grams_i); kcal_pro_100g = totalKcal * 100 / totalGrams.
    Analog fuer protein/carbs/fat/sugar/fiber/saturatedFat/sodium.
    portionGrams = Summe aller grams_i.
  - Bei detectedType="dish"/"raw"/"package": Typische Naehrwerte pro 100g; components darf leer bleiben.

WICHTIGE REGEL (asymmetrische Unsicherheit):
- Bei NAEHRWERTTABELLE (label): Nur Werte uebernehmen die lesbar sind. Unlesbar -> 0.
- Bei ESSEN (dish/plate/raw/package): IMMER realistische Schaetzung. Nie 0 fuer kcal/protein/carbs/fat aus Unsicherheit. 0 nur wenn naturgemaess 0 (z.B. Zucker bei Pommes).

RICHTWERTE FUER MISCHGERICHTE (pro 100g, detectedType="dish"):
- Lasagne Bolognese: ~150 kcal, 8g Protein, 12g Carbs, 7g Fett - Portion 350-450g
- Pizza (belegt): ~265 kcal, 11g Protein, 30g Carbs, 11g Fett - Portion 300g
- Spaghetti Bolognese: ~150 kcal, 7g Protein, 18g Carbs, 5g Fett - Portion 350g
- Huehnchen-Curry mit Reis: ~140 kcal, 8g Protein, 18g Carbs, 4g Fett - Portion 400g
- Burger (Cheeseburger): ~260 kcal, 14g Protein, 22g Carbs, 13g Fett - Portion 220g
- Doener (Kebab): ~215 kcal, 14g Protein, 18g Carbs, 9g Fett - Portion 400g
- Gruener Salat mit Dressing: ~80 kcal, 2g Protein, 5g Carbs, 5g Fett - Portion 250g
- Suppe/Eintopf (Gemuese): ~60 kcal, 3g Protein, 8g Carbs, 2g Fett - Portion 350g
- Chili con Carne: ~130 kcal, 8g Protein, 13g Carbs, 5g Fett - Portion 350g
- Sushi (gemischt): ~150 kcal, 6g Protein, 28g Carbs, 2g Fett - Portion 250g
- Bowl mit Reis+Gemuese+Protein: ~140 kcal, 8g Protein, 18g Carbs, 4g Fett - Portion 400g

RICHTWERTE FUER EINZELKOMPONENTEN pro 100g (nutze fuer detectedType="plate"):
Proteine: Haehnchenbrust gebraten ~165 kcal/31P/0C/3.6F; Lachs gebraten ~208 kcal/22P/0C/13F; Rindersteak mager ~250 kcal/26P/0C/15F; Schweineschnitzel paniert ~295 kcal/18P/14C/18F; Tofu gebraten ~145 kcal/13P/3C/9F; Ei gekocht ~155 kcal/13P/1C/11F
Beilagen (Kohlenhydrate): Kartoffeln gekocht ~80 kcal/2P/17C/0.1F; Kartoffeln gebraten ~150 kcal/3P/23C/6F; Pommes ~320 kcal/4P/38C/17F; Reis gekocht ~130 kcal/3P/28C/0.3F; Pasta gekocht ~160 kcal/6P/31C/1F; Kartoffelpuree ~85 kcal/2P/15C/2F; Brot ~265 kcal/9P/49C/3F
Gemuese gekocht/roh: Brokkoli ~35 kcal/3P/7C/0.4F; Karotten ~35 kcal/1P/8C/0.2F; Blumenkohl ~25 kcal/2P/5C/0.3F; Spinat ~25 kcal/3P/4C/0.4F; Bohnen gruen ~30 kcal/2P/5C/0.2F; Erbsen ~80 kcal/5P/14C/0.4F; Tomatensalat ~30 kcal/1P/5C/0.5F; Gurkensalat ~20 kcal/1P/3C/0.2F; Rotkohl ~25 kcal/1P/5C/0.2F; Sauerkraut ~20 kcal/1P/4C/0.1F; Champignons gebraten ~40 kcal/3P/3C/1.5F
Sossen: Bratensosse ~100 kcal/3P/5C/7F; Butter ~750 kcal/0.5P/0.5C/83F; Oel ~880 kcal/0P/0C/100F

FEW-SHOT BEISPIELE FUER PLATE (multi-component):

Beispiel A - "Haehnchenbrust mit Brokkoli und Kartoffeln":
components = [
  { name: "Haehnchenbrust", grams: 150, kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: "Brokkoli",       grams: 150, kcal: 35,  protein: 3,  carbs: 7, fat: 0.4 },
  { name: "Kartoffeln",     grams: 200, kcal: 80,  protein: 2,  carbs: 17, fat: 0.1 }
]
Rechnung: totalGrams=500; totalKcal = 1.5*165 + 1.5*35 + 2*80 = 247.5 + 52.5 + 160 = 460
=> kcal pro 100g = 460*100/500 = 92
Analog: protein_pro_100g = (1.5*31 + 1.5*3 + 2*2)*100/500 = (46.5+4.5+4)*100/500 = 55*100/500 = 11
Top-Level: kcal=92, protein=11, carbs=9, fat=1.2, portionGrams=500, name="Haehnchen mit Brokkoli und Kartoffeln"

Beispiel B - "Lachs mit Reis und Gemuese":
components = [
  { name: "Lachsfilet", grams: 180, kcal: 208, protein: 22, carbs: 0, fat: 13 },
  { name: "Reis",       grams: 150, kcal: 130, protein: 3,  carbs: 28, fat: 0.3 },
  { name: "Mischgemuese", grams: 120, kcal: 30, protein: 2, carbs: 5, fat: 0.3 }
]
=> totalGrams=450; kcal pro 100g = (1.8*208+1.5*130+1.2*30)*100/450 ≈ (374+195+36)*100/450 ≈ 134

Beispiel C - "Schnitzel mit Pommes und Salat":
components = [
  { name: "Schnitzel paniert", grams: 200, kcal: 295, protein: 18, carbs: 14, fat: 18 },
  { name: "Pommes",            grams: 200, kcal: 320, protein: 4,  carbs: 38, fat: 17 },
  { name: "Gemischter Salat",  grams: 100, kcal: 30,  protein: 1,  carbs: 5,  fat: 0.5 }
]
=> totalGrams=500; kcal pro 100g ≈ (590+640+30)*100/500 ≈ 252

RICHTWERTE FUER EINZELSTUECKE:
1 mittlerer Apfel ~180g, 1 Banane ~120g, 1 Ei ~60g, 1 Scheibe Brot ~30g,
1 Becher Joghurt ~150g, 1 Handvoll Nuesse ~30g, 1 Riegel Schoko ~100g

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
      responseMimeType: 'application/json',
      responseSchema: GEMINI_PHOTO_SCHEMA
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

  // Mit responseSchema garantiert Gemini valides JSON - trotzdem Safety-Strip fuer den Fall
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned);

  // Komponenten normalisieren (Sanity-Check + Cap auf 10 Eintraege)
  const comps = Array.isArray(parsed.components) ? parsed.components.slice(0, 10).map(c => ({
    name: (c && c.name || '').toString().slice(0, 40),
    grams: numOrZero(c && c.grams),
    kcal: numOrZero(c && c.kcal),
    protein: numOrZero(c && c.protein),
    carbs: numOrZero(c && c.carbs),
    fat: numOrZero(c && c.fat)
  })).filter(c => c.name && c.grams > 0) : [];

  return {
    name: (parsed.name || '').toString().slice(0, 80),
    detectedType: parsed.detectedType || '',
    components: comps,
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

// Shared response schema fuer Photo-Analyse (v1beta Schema-Format von Gemini)
const GEMINI_PHOTO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name:          { type: 'STRING' },
    detectedType:  { type: 'STRING', enum: ['label', 'dish', 'plate', 'raw', 'package'] },
    components: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name:    { type: 'STRING' },
          grams:   { type: 'NUMBER' },
          kcal:    { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs:   { type: 'NUMBER' },
          fat:     { type: 'NUMBER' }
        },
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
        propertyOrdering: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat']
      }
    },
    kcal:          { type: 'NUMBER' },
    protein:       { type: 'NUMBER' },
    carbs:         { type: 'NUMBER' },
    fat:           { type: 'NUMBER' },
    sugar:         { type: 'NUMBER' },
    fiber:         { type: 'NUMBER' },
    saturatedFat:  { type: 'NUMBER' },
    sodium:        { type: 'NUMBER' },
    portionDesc:   { type: 'STRING' },
    portionGrams:  { type: 'NUMBER' },
    confidence:    { type: 'NUMBER' }
  },
  required: [
    'name', 'detectedType', 'components',
    'kcal', 'protein', 'carbs', 'fat',
    'sugar', 'fiber', 'saturatedFat', 'sodium',
    'portionDesc', 'portionGrams', 'confidence'
  ],
  propertyOrdering: [
    'name', 'detectedType', 'components',
    'kcal', 'protein', 'carbs', 'fat',
    'sugar', 'fiber', 'saturatedFat', 'sodium',
    'portionDesc', 'portionGrams', 'confidence'
  ]
};

// Shared response schema fuer Text-only Dish-Analyse
const GEMINI_DISH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name:          { type: 'STRING' },
    kcal:          { type: 'NUMBER' },
    protein:       { type: 'NUMBER' },
    carbs:         { type: 'NUMBER' },
    fat:           { type: 'NUMBER' },
    sugar:         { type: 'NUMBER' },
    fiber:         { type: 'NUMBER' },
    saturatedFat:  { type: 'NUMBER' },
    sodium:        { type: 'NUMBER' },
    portionDesc:   { type: 'STRING' },
    portionGrams:  { type: 'NUMBER' },
    confidence:    { type: 'NUMBER' }
  },
  required: [
    'name', 'kcal', 'protein', 'carbs', 'fat',
    'sugar', 'fiber', 'saturatedFat', 'sodium',
    'portionDesc', 'portionGrams', 'confidence'
  ],
  propertyOrdering: [
    'name', 'kcal', 'protein', 'carbs', 'fat',
    'sugar', 'fiber', 'saturatedFat', 'sodium',
    'portionDesc', 'portionGrams', 'confidence'
  ]
};

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
      responseMimeType: 'application/json',
      responseSchema: GEMINI_DISH_SCHEMA
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

  // Multi-Component Breakdown (wenn detectedType=plate und components vorhanden)
  const hasComponents = Array.isArray(parsed.components) && parsed.components.length > 1;
  const componentsHtml = hasComponents
    ? `<div class="photo-components-list">
         ${parsed.components.map(c =>
           `<span class="photo-component-chip">
              <strong>${escapeHtml(c.name)}</strong>
              <span class="photo-component-grams">${Math.round(c.grams)}&nbsp;g</span>
            </span>`
         ).join('')}
       </div>`
    : '';

  const portionHint = (parsed.portionDesc || hasComponents)
    ? `<div class="photo-portion-hint">
         <svg class="portion-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
           <path d="M4 8 l8 -4 l8 4 l-8 4 z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
           <path d="M4 8 v8 l8 4 v-8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
           <path d="M20 8 v8 l-8 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
         </svg>
         <div class="portion-text">
           <strong>Erkannt:</strong> ${escapeHtml(parsed.portionDesc || parsed.name || '')}${parsed.portionGrams ? ` &middot; ca. <strong>${Math.round(parsed.portionGrams)} g</strong>` : ''}
           ${componentsHtml}
           <br><span class="portion-hint-sub">${hasComponents ? 'Komponenten zusammengerechnet &mdash; pr&uuml;fen und bei Bedarf anpassen' : 'Gramm unten sind vorbef&uuml;llt &mdash; pr&uuml;fen und bei Bedarf anpassen'}</span>
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
