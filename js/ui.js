// ============================================
// UI Helpers — Tabs, Modals, Rendering
// ============================================

// ---- Tab Navigation ----

let captureMode = 'barcode';

function switchTab(tabBtn) {
  const page = tabBtn.dataset.page;
  const alreadyActive = tabBtn.classList.contains('active');
  showPage(page);

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tabBtn.classList.add('active');
  if (!alreadyActive) haptic();

  // Update header
  const titles = {
    'page-scan': 'Erfassen',
    'page-today': 'Protokoll',
    'page-history': 'Verlauf',
    'page-settings': 'Einstellungen'
  };
  document.getElementById('header-title').textContent = titles[page] || '';

  // Header action button
  const actionBtn = document.getElementById('header-action');
  if (page === 'page-today') {
    actionBtn.style.display = 'flex';
    actionBtn.onclick = () => showModal('modal-manual');
  } else {
    actionBtn.style.display = 'none';
  }

  // Search button (only on today tab)
  const searchBtn = document.getElementById('header-search');
  if (searchBtn) {
    searchBtn.style.display = (page === 'page-today') ? 'flex' : 'none';
  }

  // Capture tab: honour current capture mode
  if (page === 'page-scan') {
    if (typeof initPhotoTab === 'function') initPhotoTab();
    if (captureMode === 'barcode') {
      startScanner();
    } else {
      stopScanner();
    }
  } else {
    stopScanner();
  }

  // Refresh data
  if (page === 'page-today') refreshTodayView();
  if (page === 'page-history') refreshHistoryView();
  if (page === 'page-settings') loadSettingsView();
}

function setCaptureMode(mode) {
  captureMode = mode;
  const barcodeBtn = document.getElementById('capture-mode-barcode');
  const photoBtn = document.getElementById('capture-mode-photo');
  const barcodeView = document.getElementById('capture-barcode-view');
  const photoView = document.getElementById('capture-photo-view');

  if (mode === 'barcode') {
    barcodeBtn.classList.add('active');
    photoBtn.classList.remove('active');
    barcodeView.classList.remove('hidden');
    photoView.classList.add('hidden');
    startScanner();
  } else {
    photoBtn.classList.add('active');
    barcodeBtn.classList.remove('active');
    photoView.classList.remove('hidden');
    barcodeView.classList.add('hidden');
    stopScanner();
  }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');

  // Special pages
  if (pageId === 'page-recipes') {
    document.getElementById('header-title').textContent = 'Rezepte';
    refreshRecipesView();
  }
  if (pageId === 'page-achievements') {
    document.getElementById('header-title').textContent = 'Erfolge';
    if (typeof renderAchievementsGallery === 'function') renderAchievementsGallery('achievements-gallery');
  }
}

// ---- Modals ----

function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideModal(id) {
  document.getElementById(id).classList.add('hidden');

  // Reset form fields
  const modal = document.getElementById(id);
  modal.querySelectorAll('input').forEach(i => { i.value = ''; });
  const preview = modal.querySelector('.preview');
  if (preview) preview.classList.add('hidden');

  // Reset AI hint strip if present (manual modal)
  const aiHint = modal.querySelector('.photo-portion-hint');
  if (aiHint) {
    aiHint.classList.add('hidden');
    aiHint.innerHTML = '';
  }

  // Reset meal selector if present
  if (typeof resetMealSelector === 'function') {
    const prefix = id.replace('modal-', '');
    resetMealSelector(prefix + '-meal-selector');
  }

  // Resume scanner if needed
  if (id === 'modal-product') resumeScanner();
}

// ---- Toast ----

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2000);
}

// ---- Collapsible Toggle ----

function toggleCollapsible(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector('.collapsible-arrow');
  body.classList.toggle('hidden');
  if (arrow) {
    arrow.textContent = body.classList.contains('hidden') ? '\u25B6' : '\u25BC';
  }
}

// ---- Haptic Feedback (iOS-kompatibel) ----
// Cached Flag - wird aus den Settings gehydrated und synchron ausgelesen,
// damit haptic() ohne await aufgerufen werden kann.
let _hapticsEnabled = true;

function setHapticsEnabled(on) {
  _hapticsEnabled = !!on;
}

function haptic() {
  if (!_hapticsEnabled) return;
  if ('vibrate' in navigator) {
    try { navigator.vibrate(15); } catch (e) {}
  }
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:rgba(249,115,22,0.08);pointer-events:none;z-index:9999;';
  document.body.appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.transition = 'opacity 0.3s ease';
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 300);
  });
}

// ---- Count-Up-Animation fuer Zahlen ----
// Parst die aktuelle Zahl im Element, interpoliert auf den Zielwert
// und schreibt sie per rAF zurueck. Suffix wie 'g' oder 'kcal' wird angehaengt.
// Laeuft eased (easeOutCubic) und stellt bei Tab-Wechsel/neuem Call die Animation sauber zurueck.
const _countUpTimers = new WeakMap();

function animateNumber(el, toValue, opts = {}) {
  if (!el) return;
  const duration = opts.duration != null ? opts.duration : 500;
  const suffix = opts.suffix || '';
  const decimals = opts.decimals != null ? opts.decimals : 0;

  // Vorherige Animation desselben Elements abbrechen
  const prev = _countUpTimers.get(el);
  if (prev) cancelAnimationFrame(prev);

  // From-Wert aus aktuellem Text parsen
  const currentText = (el.textContent || '').replace(/[^\d.,\-]/g, '').replace(',', '.');
  const fromValue = parseFloat(currentText) || 0;
  const target = isFinite(toValue) ? toValue : 0;

  // Nur Animieren wenn der Sprung spuerbar ist; sonst direkt setzen
  if (Math.abs(target - fromValue) < 0.5 || duration <= 0) {
    el.textContent = target.toFixed(decimals) + suffix;
    return;
  }

  const start = performance.now();
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = easeOutCubic(progress);
    const value = fromValue + (target - fromValue) * eased;
    el.textContent = value.toFixed(decimals) + suffix;
    if (progress < 1) {
      _countUpTimers.set(el, requestAnimationFrame(tick));
    } else {
      _countUpTimers.delete(el);
    }
  }
  _countUpTimers.set(el, requestAnimationFrame(tick));
}

// ---- Progress Ring Update ----

function setRingProgress(ringId, progress) {
  const circle = document.getElementById(ringId);
  if (!circle) return;
  const circumference = 2 * Math.PI * 42; // r=42
  const clamped = Math.min(Math.max(progress, 0), 1);
  circle.style.strokeDashoffset = circumference * (1 - clamped);
}

// ---- Render Entry Card ----

function renderEntryCard(entry, opts = {}) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = entry.id;

  // Source badge
  const sourceBadge = entry.source ? `<span class="source-badge source-${entry.source}">${entry.source}</span>` : '';

  // Zeitstempel aus ISO extrahieren (HH:MM)
  let timeStr = '';
  try {
    const d = new Date(entry.date);
    if (!isNaN(d.getTime())) {
      timeStr = d.toTimeString().slice(0, 5);
    }
  } catch (e) {}
  const timeBadge = timeStr ? `<span class="entry-time">${timeStr}</span>` : '';

  card.innerHTML = `
    <div class="entry-left">
      <div class="entry-name">${sourceBadge}${escapeHtml(entry.productName)}</div>
      <div class="entry-meta-row">
        <span class="entry-grams">${Math.round(entry.grams)}g</span>
        ${timeBadge}
      </div>
    </div>
    <div class="entry-right">
      <div class="entry-kcal">${Math.round(entry.totalKcal)} kcal</div>
      <div class="entry-macros">
        <span class="entry-macro p">P ${Math.round(entry.totalProtein)}g</span>
        <span class="entry-macro c">K ${Math.round(entry.totalCarbs)}g</span>
        <span class="entry-macro f">F ${Math.round(entry.totalFat)}g</span>
      </div>
    </div>
  `;

  if (opts.canDelete !== false) {
    setupSwipeToDelete(card, entry);
  }

  if (opts.canDelete !== false) {
    setupTapToEdit(card, entry.id);
  }

  return card;
}

// ---- Tap to Edit ----

function setupTapToEdit(card, entryId) {
  let tapStartX = 0;
  let tapStartY = 0;
  let tapMoved = false;

  card.addEventListener('touchstart', (e) => {
    tapStartX = e.touches[0].clientX;
    tapStartY = e.touches[0].clientY;
    tapMoved = false;
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    const dx = Math.abs(e.touches[0].clientX - tapStartX);
    const dy = Math.abs(e.touches[0].clientY - tapStartY);
    if (dx > 10 || dy > 10) tapMoved = true;
  }, { passive: true });

  card.addEventListener('touchend', () => {
    if (!tapMoved) {
      openEditModal(entryId);
    }
  });

  card.addEventListener('click', (e) => {
    if ('ontouchstart' in window) return;
    openEditModal(entryId);
  });
}

// ---- Swipe to Delete ----

function setupSwipeToDelete(card, entry) {
  const entryId = typeof entry === 'string' ? entry : entry.id;
  const entryObj = typeof entry === 'string' ? null : entry;
  let startX = 0;
  let currentX = 0;
  let swiping = false;

  card.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    swiping = true;
    card.style.transition = 'none';
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (!swiping) return;
    currentX = e.touches[0].clientX;
    const dx = Math.max(0, currentX - startX);
    if (dx > 10) {
      card.style.transform = `translateX(${dx}px)`;
      card.style.opacity = String(Math.max(0.3, 1 - dx / 300));
    }
  }, { passive: true });

  card.addEventListener('touchend', async () => {
    swiping = false;
    card.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    const dx = currentX - startX;

    if (dx > 80) {
      card.style.transform = 'translateX(100%)';
      card.style.opacity = '0';
      haptic();
      setTimeout(async () => {
        await deleteEntry(entryId);
        // Undo-Toast zeigen (5s Fenster)
        if (entryObj && typeof showUndoToast === 'function') {
          showUndoToast(`"${entryObj.productName}" gel\u00F6scht`, entryObj);
        }
        refreshTodayView();
      }, 200);
    } else {
      card.style.transform = 'translateX(0)';
      card.style.opacity = '1';
    }
  });
}

// ---- Manual Entry Preview ----

document.addEventListener('DOMContentLoaded', () => {
  const fields = ['manual-kcal', 'manual-protein', 'manual-carbs', 'manual-fat', 'manual-grams'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateManualPreview);
  });
});

function updateManualPreview() {
  const kcal = parseFloat(document.getElementById('manual-kcal').value) || 0;
  const protein = parseFloat(document.getElementById('manual-protein').value) || 0;
  const carbs = parseFloat(document.getElementById('manual-carbs').value) || 0;
  const fat = parseFloat(document.getElementById('manual-fat').value) || 0;
  const grams = parseFloat(document.getElementById('manual-grams').value) || 0;
  const preview = document.getElementById('manual-preview');

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

// ---- Escape HTML ----

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
