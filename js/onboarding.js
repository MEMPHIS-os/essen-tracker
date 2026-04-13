// ============================================
// Onboarding — 7-Schritt Wizard + TDEE
// ============================================

const PAL_LEVELS = [
  { key: 'sedentary', label: 'Kaum Bewegung', desc: 'Buerojob, kein Sport', factor: 1.2 },
  { key: 'light', label: 'Leicht aktiv', desc: '1-3x Sport pro Woche', factor: 1.375 },
  { key: 'moderate', label: 'Moderat aktiv', desc: '3-5x Sport pro Woche', factor: 1.55 },
  { key: 'active', label: 'Sehr aktiv', desc: '6-7x Sport pro Woche', factor: 1.725 },
  { key: 'extreme', label: 'Extrem aktiv', desc: 'Profisportler, koerperliche Arbeit', factor: 1.9 }
];

const GOAL_OPTIONS = [
  { key: 'cut-fast', label: 'Abnehmen (schnell)', desc: '-500 kcal/Tag', offset: -500 },
  { key: 'cut', label: 'Abnehmen (moderat)', desc: '-300 kcal/Tag', offset: -300 },
  { key: 'maintain', label: 'Gewicht halten', desc: 'TDEE beibehalten', offset: 0 },
  { key: 'bulk', label: 'Zunehmen (moderat)', desc: '+300 kcal/Tag', offset: 300 },
  { key: 'bulk-fast', label: 'Zunehmen (schnell)', desc: '+500 kcal/Tag', offset: 500 }
];

let onboardingData = { gender: 'male', age: 25, height: 175, weight: 75, activity: 1.55, goal: 'maintain', goalOffset: 0 };
let onboardingStep = 0;

async function checkOnboarding() {
  const profile = await getUserProfile();
  if (profile && profile.onboardingComplete) return false;
  showOnboarding();
  return true;
}

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  onboardingStep = 0;
  renderOnboardingStep();
}

function renderOnboardingStep() {
  const content = document.getElementById('onboarding-content');
  const dots = document.getElementById('ob-progress');
  const prevBtn = document.getElementById('onboarding-prev');
  const nextBtn = document.getElementById('onboarding-next');
  if (!content) return;

  // Progress dots
  if (dots) dots.innerHTML = Array.from({ length: 7 }, (_, i) =>
    `<div class="ob-dot ${i === onboardingStep ? 'active' : i < onboardingStep ? 'done' : ''}"></div>`
  ).join('');

  // Wire up nav buttons
  prevBtn.onclick = prevOnboardingStep;
  nextBtn.onclick = nextOnboardingStep;

  prevBtn.style.visibility = onboardingStep > 0 ? 'visible' : 'hidden';
  nextBtn.textContent = onboardingStep === 6 ? 'Fertig' : 'Weiter';

  switch (onboardingStep) {
    case 0: renderGenderStep(content); break;
    case 1: renderAgeStep(content); break;
    case 2: renderHeightStep(content); break;
    case 3: renderWeightStep(content); break;
    case 4: renderActivityStep(content); break;
    case 5: renderGoalStep(content); break;
    case 6: renderResultStep(content); break;
  }
}

function renderGenderStep(el) {
  el.innerHTML = `
    <h2>Geschlecht</h2>
    <p class="ob-sub">Fuer die Berechnung deines Grundumsatzes</p>
    <div class="ob-cards">
      ${['male', 'female', 'diverse'].map(g => {
        const labels = { male: 'Mann', female: 'Frau', diverse: 'Keine Angabe' };
        const icons = { male: '\u{1F468}', female: '\u{1F469}', diverse: '\u{1F9D1}' };
        return `<button class="ob-card ${onboardingData.gender === g ? 'selected' : ''}" onclick="onboardingData.gender='${g}'; renderOnboardingStep()">
          <span class="ob-card-icon">${icons[g]}</span><span>${labels[g]}</span>
        </button>`;
      }).join('')}
    </div>`;
}

function renderAgeStep(el) {
  el.innerHTML = `
    <h2>Alter</h2>
    <p class="ob-sub">Wie alt bist du?</p>
    <div class="ob-input-center">
      <input type="number" id="ob-age" class="ob-big-input" min="14" max="100" value="${onboardingData.age}" oninput="onboardingData.age=parseInt(this.value)||25">
      <span class="ob-unit">Jahre</span>
    </div>`;
}

function renderHeightStep(el) {
  el.innerHTML = `
    <h2>Groesse</h2>
    <p class="ob-sub">Deine Koerpergroesse</p>
    <div class="ob-input-center">
      <input type="number" id="ob-height" class="ob-big-input" min="120" max="220" value="${onboardingData.height}" oninput="onboardingData.height=parseInt(this.value)||175">
      <span class="ob-unit">cm</span>
    </div>
    <input type="range" class="ob-slider" min="120" max="220" value="${onboardingData.height}" oninput="onboardingData.height=parseInt(this.value); document.getElementById('ob-height').value=this.value">`;
}

function renderWeightStep(el) {
  el.innerHTML = `
    <h2>Gewicht</h2>
    <p class="ob-sub">Dein aktuelles Koerpergewicht</p>
    <div class="ob-input-center">
      <input type="number" id="ob-weight" class="ob-big-input" min="30" max="250" step="0.1" value="${onboardingData.weight}" oninput="onboardingData.weight=parseFloat(this.value)||75">
      <span class="ob-unit">kg</span>
    </div>
    <input type="range" class="ob-slider" min="30" max="250" step="0.5" value="${onboardingData.weight}" oninput="onboardingData.weight=parseFloat(this.value); document.getElementById('ob-weight').value=this.value">`;
}

function renderActivityStep(el) {
  el.innerHTML = `
    <h2>Aktivitaetslevel</h2>
    <p class="ob-sub">Wie aktiv bist du im Alltag?</p>
    <div class="ob-cards vertical">
      ${PAL_LEVELS.map(p => `
        <button class="ob-card wide ${onboardingData.activity === p.factor ? 'selected' : ''}" onclick="onboardingData.activity=${p.factor}; renderOnboardingStep()">
          <strong>${p.label}</strong><span class="ob-card-desc">${p.desc} (\u00D7${p.factor})</span>
        </button>`).join('')}
    </div>`;
}

function renderGoalStep(el) {
  el.innerHTML = `
    <h2>Dein Ziel</h2>
    <p class="ob-sub">Was moechtest du erreichen?</p>
    <div class="ob-cards vertical">
      ${GOAL_OPTIONS.map(g => `
        <button class="ob-card wide ${onboardingData.goal === g.key ? 'selected' : ''}" onclick="onboardingData.goal='${g.key}'; onboardingData.goalOffset=${g.offset}; renderOnboardingStep()">
          <strong>${g.label}</strong><span class="ob-card-desc">${g.desc}</span>
        </button>`).join('')}
    </div>`;
}

function renderResultStep(el) {
  const { bmr, tdee, targetKcal } = calculateTDEE();
  const macros = calculateMacros(targetKcal, onboardingData.weight);

  el.innerHTML = `
    <h2>Dein Ergebnis</h2>
    <div class="ob-result-card">
      <div class="ob-result-row"><span>Grundumsatz (BMR)</span><strong>${Math.round(bmr)} kcal</strong></div>
      <div class="ob-result-row"><span>Gesamtumsatz (TDEE)</span><strong>${Math.round(tdee)} kcal</strong></div>
      <div class="ob-result-big">
        <div class="ob-result-target">${Math.round(targetKcal)}</div>
        <div class="ob-result-label">kcal / Tag empfohlen</div>
      </div>
      <div class="ob-macros">
        <div class="ob-macro"><span class="ob-macro-val">${Math.round(macros.protein)}g</span><span class="ob-macro-label">Protein</span></div>
        <div class="ob-macro"><span class="ob-macro-val">${Math.round(macros.carbs)}g</span><span class="ob-macro-label">Carbs</span></div>
        <div class="ob-macro"><span class="ob-macro-val">${Math.round(macros.fat)}g</span><span class="ob-macro-label">Fett</span></div>
      </div>
    </div>`;
}

function calculateTDEE() {
  const { gender, age, height, weight, activity, goalOffset } = onboardingData;
  let bmr;
  if (gender === 'female') {
    bmr = (10 * weight) + (6.25 * height) - (5 * age) - 161;
  } else if (gender === 'male') {
    bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5;
  } else {
    const m = (10 * weight) + (6.25 * height) - (5 * age) + 5;
    const f = (10 * weight) + (6.25 * height) - (5 * age) - 161;
    bmr = (m + f) / 2;
  }
  const tdee = bmr * activity;
  const targetKcal = tdee + goalOffset;
  return { bmr, tdee, targetKcal };
}

function calculateMacros(targetKcal, weight) {
  const protein = weight * 2;
  const fat = (targetKcal * 0.25) / 9;
  const carbsKcal = targetKcal - (protein * 4) - (fat * 9);
  const carbs = Math.max(0, carbsKcal / 4);
  return { protein, carbs, fat };
}

function nextOnboardingStep() {
  if (onboardingStep < 6) {
    onboardingStep++;
    renderOnboardingStep();
  } else {
    applyOnboardingResult();
  }
}

function prevOnboardingStep() {
  if (onboardingStep > 0) {
    onboardingStep--;
    renderOnboardingStep();
  }
}

async function applyOnboardingResult() {
  const { bmr, tdee, targetKcal } = calculateTDEE();
  const macros = calculateMacros(targetKcal, onboardingData.weight);

  await saveUserProfile({
    gender: onboardingData.gender,
    age: onboardingData.age,
    height: onboardingData.height,
    weight: onboardingData.weight,
    activityLevel: onboardingData.activity,
    goal: onboardingData.goal,
    onboardingComplete: true,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee)
  });

  // Save initial weight
  const today = new Date().toISOString().split('T')[0];
  await saveWeight(today, onboardingData.weight);

  // Update settings with calculated goals
  const settings = await getSettings();
  settings.dailyKcal = Math.round(targetKcal);
  settings.dailyProtein = Math.round(macros.protein);
  settings.dailyCarbs = Math.round(macros.carbs);
  settings.dailyFat = Math.round(macros.fat);
  await saveSettingsData(settings);

  document.getElementById('onboarding-overlay').classList.add('hidden');
  haptic();
  showToast('Willkommen bei EssenTracker!');
  initMainApp();
}
