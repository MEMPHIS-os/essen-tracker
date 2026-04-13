// ============================================
// Koffein-Tracker
// ============================================

const CAFFEINE_PRESETS = [
  { name: 'Espresso', mg: 63, emoji: '\u2615' },
  { name: 'Kaffee', mg: 90, emoji: '\u2615' },
  { name: 'Tee', mg: 45, emoji: '\u{1F375}' },
  { name: 'Red Bull', mg: 80, emoji: '\u26A1' }
];

async function addCaffeine(name, mg) {
  await addCaffeineEntry({ drinkName: name, caffeineAmount: mg });
  haptic();
  await refreshCaffeineDisplay();
  checkCaffeineWarning();
}

async function refreshCaffeineDisplay() {
  const today = new Date().toISOString().split('T')[0];
  const entries = await getCaffeineForDate(today);
  const settings = await getSettings();
  const total = entries.reduce((s, e) => s + (e.caffeineAmount || 0), 0);
  const limit = settings.dailyCaffeine || 400;

  // Total badge
  const badge = document.getElementById('caffeine-total-badge');
  if (badge) badge.textContent = Math.round(total) + 'mg';

  // Progress bar
  const fill = document.getElementById('caffeine-progress-fill');
  const label = document.getElementById('caffeine-progress-label');
  if (fill) {
    const ratio = Math.min(total / limit, 1);
    fill.style.minWidth = (ratio * 100) + '%';
    fill.style.maxWidth = (ratio * 100) + '%';
    if (total <= 200) {
      fill.className = 'caffeine-bar-fill green';
    } else if (total <= 400) {
      fill.className = 'caffeine-bar-fill orange';
    } else {
      fill.className = 'caffeine-bar-fill red';
    }
  }
  if (label) label.textContent = Math.round(total) + ' / ' + limit + ' mg';

  // Entry list
  const list = document.getElementById('caffeine-entries');
  if (list) {
    list.innerHTML = entries.map(e => `
      <div class="caffeine-entry">
        <span>${e.drinkName} — ${e.caffeineAmount}mg</span>
        <span class="caffeine-time">${e.time || ''}</span>
        <button class="caffeine-delete" onclick="removeCaffeineItem('${e.id}')">\u00D7</button>
      </div>
    `).join('');
  }
}

async function removeCaffeineItem(id) {
  await deleteCaffeineEntry(id);
  haptic();
  await refreshCaffeineDisplay();
}

function checkCaffeineWarning() {
  const hour = new Date().getHours();
  if (hour >= 14) {
    showToast('Koffein kann deinen Schlaf beeinflussen');
  }
}

function renderCaffeineQuickButtons() {
  const container = document.getElementById('caffeine-quick-buttons');
  if (!container) return;
  container.innerHTML = CAFFEINE_PRESETS.map(p =>
    `<button class="caffeine-quick-btn" onclick="addCaffeine('${p.name}', ${p.mg})">${p.emoji} ${p.name}<span>${p.mg}mg</span></button>`
  ).join('') + `<button class="caffeine-quick-btn custom" onclick="showModal('modal-caffeine')">\u2795 Eigenes</button>`;
}

async function saveCustomCaffeine() {
  const name = document.getElementById('caffeine-custom-name').value.trim();
  const mg = parseFloat(document.getElementById('caffeine-custom-mg').value);
  if (!name || !mg || mg <= 0) { showToast('Name und mg eingeben'); return; }
  await addCaffeine(name, mg);
  hideModal('modal-caffeine');
}
