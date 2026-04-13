// ============================================
// Nutrition Score, Streaks & Achievements
// ============================================

// ---- Score Calculation ----

function calculateDayScore(entries, settings) {
  if (!entries || entries.length === 0) return { score: 0, breakdown: {} };

  const totalKcal = entries.reduce((s, e) => s + (e.totalKcal || 0), 0);
  const totalProtein = entries.reduce((s, e) => s + (e.totalProtein || 0), 0);
  const totalSugar = entries.reduce((s, e) => s + (e.totalSugar || 0), 0);
  const totalFiber = entries.reduce((s, e) => s + (e.totalFiber || 0), 0);
  const meals = new Set(entries.map(e => e.meal).filter(Boolean));

  // 1) Kalorien ±10% = max 30 Punkte
  const kcalGoal = settings.dailyKcal || 2000;
  const kcalDeviation = Math.abs(totalKcal - kcalGoal) / kcalGoal;
  const kcalPts = kcalDeviation <= 0.1 ? 30 : Math.max(0, 30 - (kcalDeviation - 0.1) * 150);

  // 2) Protein-Ziel = max 20 Punkte
  const proteinGoal = settings.dailyProtein || 120;
  const proteinRatio = Math.min(totalProtein / proteinGoal, 1);
  const proteinPts = proteinRatio * 20;

  // 3) Zucker WHO = max 20 Punkte
  const sugarPts = totalSugar <= 25 ? 20 : totalSugar <= 50 ? 10 : 0;

  // 4) Ballaststoffe > 20g = max 15 Punkte
  const fiberPts = Math.min(totalFiber / 20, 1) * 15;

  // 5) Alle Mahlzeiten geloggt = max 15 Punkte
  const mealPts = Math.min(meals.size, 4) * 3.75;

  const score = Math.round(kcalPts + proteinPts + sugarPts + fiberPts + mealPts);
  return {
    score: Math.min(100, Math.max(0, score)),
    breakdown: { kcalPts: Math.round(kcalPts), proteinPts: Math.round(proteinPts), sugarPts, fiberPts: Math.round(fiberPts), mealPts: Math.round(mealPts) }
  };
}

function getScoreGrade(score) {
  if (score >= 90) return { label: 'Perfekter Tag', emoji: '\u{1F31F}', color: '#22c55e' };
  if (score >= 70) return { label: 'Sehr gut', emoji: '\u2705', color: '#22c55e' };
  if (score >= 50) return { label: 'Okay', emoji: '\u{1F642}', color: '#f97316' };
  if (score >= 30) return { label: 'Ausbaufaehig', emoji: '\u{1F4C8}', color: '#ef4444' };
  return { label: 'Schwacher Tag', emoji: '\u{1F4AA}', color: '#ef4444' };
}

function renderScoreRing(containerId, score) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const grade = getScoreGrade(score);
  const r = 42, circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(score / 100, 1));

  container.innerHTML = `
    <svg width="90" height="90" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="8"/>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="${grade.color}" stroke-width="8"
        stroke-dasharray="${circ}" stroke-dashoffset="${circ}" stroke-linecap="round"
        transform="rotate(-90 50 50)" class="score-ring-fill" data-offset="${offset}"/>
      <text x="50" y="46" text-anchor="middle" fill="white" font-size="22" font-weight="bold">${score}</text>
      <text x="50" y="62" text-anchor="middle" fill="#888" font-size="10">Score</text>
    </svg>
    <div class="score-grade" style="color:${grade.color}">${grade.emoji} ${grade.label}</div>
  `;

  requestAnimationFrame(() => {
    const fill = container.querySelector('.score-ring-fill');
    if (fill) {
      setTimeout(() => { fill.style.transition = 'stroke-dashoffset 0.8s ease'; fill.style.strokeDashoffset = offset; }, 50);
    }
  });
}

// ---- Streak Calculation ----

function calculateLoggingStreak(allEntries) {
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const hasEntry = allEntries.some(e => e.date && e.date.startsWith(ds));
    if (hasEntry) { streak++; } else if (i > 0) { break; }
    // Day 0 (today) — no entry yet is okay, don't break
    else if (i === 0 && !hasEntry) { /* continue checking yesterday */ }
  }
  return streak;
}

function calculateGoalStreak(allEntries, settings) {
  const today = new Date();
  const goal = settings.dailyKcal || 2000;
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const dayEntries = allEntries.filter(e => e.date && e.date.startsWith(ds));
    if (dayEntries.length === 0) { if (i > 0) break; else continue; }
    const totalKcal = dayEntries.reduce((s, e) => s + (e.totalKcal || 0), 0);
    const deviation = Math.abs(totalKcal - goal) / goal;
    if (deviation <= 0.1) { streak++; } else { if (i > 0) break; }
  }
  return streak;
}

// ---- Achievements ----

const ACHIEVEMENT_DEFS = [
  { key: 'log-3', label: 'Guter Start', emoji: '\u{1F525}', type: 'logging', days: 3 },
  { key: 'log-7', label: 'Eine Woche stark', emoji: '\u{1F4AA}', type: 'logging', days: 7 },
  { key: 'log-14', label: 'Zwei Wochen dabei', emoji: '\u26A1', type: 'logging', days: 14 },
  { key: 'log-30', label: 'Ein Monat Disziplin', emoji: '\u{1F3C6}', type: 'logging', days: 30 },
  { key: 'log-100', label: 'Unaufhaltbar', emoji: '\u{1F31F}', type: 'logging', days: 100 },
  { key: 'goal-3', label: '3 Tage im Ziel', emoji: '\u{1F3AF}', type: 'goal', days: 3 },
  { key: 'goal-7', label: 'Woche perfekt', emoji: '\u{1F48E}', type: 'goal', days: 7 },
  { key: 'goal-14', label: '14 Tage Praezision', emoji: '\u{1F680}', type: 'goal', days: 14 },
  { key: 'goal-30', label: 'Monats-Champion', emoji: '\u{1F451}', type: 'goal', days: 30 },
  { key: 'goal-100', label: '100 Tage Perfektion', emoji: '\u2B50', type: 'goal', days: 100 }
];

async function checkAndAwardAchievements(loggingStreak, goalStreak) {
  for (const def of ACHIEVEMENT_DEFS) {
    const streak = def.type === 'logging' ? loggingStreak : goalStreak;
    if (streak >= def.days) {
      const existing = await getAchievement(def.key);
      if (!existing) {
        await saveAchievement(def.key);
        showAchievementToast(def);
      }
    }
  }
}

function showAchievementToast(achievement) {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <div class="achievement-toast-emoji">${achievement.emoji}</div>
    <div class="achievement-toast-text">
      <strong>${achievement.label}</strong>
      <span>Freigeschaltet!</span>
    </div>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, 3500);
}

async function renderAchievementsGallery(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const earned = await getAllAchievements();
  const earnedMap = {};
  earned.forEach(a => earnedMap[a.key] = a.dateEarned);

  container.innerHTML = ACHIEVEMENT_DEFS.map(def => {
    const date = earnedMap[def.key];
    const cls = date ? 'achievement-card earned' : 'achievement-card locked';
    const dateStr = date ? new Date(date).toLocaleDateString('de-DE') : '';
    return `
      <div class="${cls}">
        <div class="achievement-emoji">${date ? def.emoji : '\u{1F512}'}</div>
        <div class="achievement-label">${def.label}</div>
        <div class="achievement-date">${dateStr || (def.type === 'logging' ? def.days + ' Tage loggen' : def.days + ' Tage im Ziel')}</div>
      </div>
    `;
  }).join('');
}
