// ============================================
// UI Helpers — Tabs, Modals, Rendering
// ============================================

// ---- Tab Navigation ----

function switchTab(tabBtn) {
  const page = tabBtn.dataset.page;
  showPage(page);

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tabBtn.classList.add('active');

  // Update header
  const titles = {
    'page-scan': 'Scannen',
    'page-today': 'Heute',
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

  // Scanner management
  if (page === 'page-scan') {
    startScanner();
  } else {
    stopScanner();
  }

  // Refresh data
  if (page === 'page-today') refreshTodayView();
  if (page === 'page-history') refreshHistoryView();
  if (page === 'page-settings') loadSettingsView();
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

// ---- Haptic Feedback (iOS-kompatibel) ----

function haptic() {
  // navigator.vibrate() funktioniert nicht auf iOS Safari
  // Stattdessen: kurzer visueller Flash als Feedback
  if ('vibrate' in navigator) {
    try { navigator.vibrate(15); } catch (e) {}
  }
  // Visueller Flash-Effekt als Fallback (funktioniert ueberall)
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:rgba(249,115,22,0.08);pointer-events:none;z-index:9999;';
  document.body.appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.transition = 'opacity 0.3s ease';
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 300);
  });
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

  card.innerHTML = `
    <div class="entry-delete-bg">L&ouml;schen</div>
    <div class="entry-left">
      <div class="entry-name">${escapeHtml(entry.productName)}</div>
      <div class="entry-grams">${Math.round(entry.grams)}g</div>
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
    setupSwipeToDelete(card, entry.id);
  }

  // Tap to edit (only for today's cards with delete enabled)
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

  // Desktop click fallback
  card.addEventListener('click', (e) => {
    // Only fire on desktop (no touch events)
    if ('ontouchstart' in window) return;
    openEditModal(entryId);
  });
}

// ---- Swipe to Delete ----

function setupSwipeToDelete(card, entryId) {
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
    const dx = Math.min(0, currentX - startX);
    if (dx < -10) {
      card.style.transform = `translateX(${Math.max(dx, -80)}px)`;
    }
  }, { passive: true });

  card.addEventListener('touchend', async () => {
    swiping = false;
    card.style.transition = 'transform 0.2s ease';
    const dx = currentX - startX;

    if (dx < -60) {
      card.style.transform = 'translateX(-100%)';
      card.style.opacity = '0';
      haptic();
      setTimeout(async () => {
        await deleteEntry(entryId);
        refreshTodayView();
      }, 200);
    } else {
      card.style.transform = 'translateX(0)';
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
