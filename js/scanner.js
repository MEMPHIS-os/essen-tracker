// ============================================
// Barcode Scanner — html5-qrcode (iOS Safari kompatibel)
// ============================================

let html5Scanner = null;
let scannerPaused = false;

async function startScanner() {
  const container = document.getElementById('scanner-reader');
  if (!container) return;

  // Bereits aktiv
  if (html5Scanner && html5Scanner.isScanning) return;

  try {
    html5Scanner = new Html5Qrcode('scanner-reader');

    await html5Scanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 280, height: 140 },
        aspectRatio: 1.0,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E
        ]
      },
      onScanSuccess,
      () => {} // ignore scan failures (no barcode in frame)
    );
  } catch (err) {
    container.innerHTML = `
      <div class="scanner-fallback">
        <p class="fallback-title">Kamera nicht verfuegbar</p>
        <p class="fallback-sub">Erlaube den Kamera-Zugriff in den Browser-Einstellungen und lade die Seite neu.</p>
      </div>
    `;
  }
}

async function onScanSuccess(barcode) {
  if (scannerPaused) return;
  scannerPaused = true;

  haptic();

  // Scanner pausieren waehrend API-Lookup
  if (html5Scanner && html5Scanner.isScanning) {
    try { await html5Scanner.pause(true); } catch (e) {}
  }

  await lookupProduct(barcode);
}

async function stopScanner() {
  if (html5Scanner) {
    try {
      if (html5Scanner.isScanning) {
        await html5Scanner.stop();
      }
    } catch (e) {}
    html5Scanner = null;
  }
}

async function resumeScanner() {
  scannerPaused = false;
  document.getElementById('scan-loading').classList.add('hidden');

  if (html5Scanner) {
    try {
      if (html5Scanner.getState() === Html5QrcodeScannerState.PAUSED) {
        html5Scanner.resume();
      } else if (!html5Scanner.isScanning) {
        // Wurde gestoppt — neu starten
        await startScanner();
      }
    } catch (e) {
      // Fallback: komplett neu starten
      await startScanner();
    }
  }
}

// ---- Product Lookup ----

let currentProduct = null;

async function lookupProduct(barcode) {
  const loading = document.getElementById('scan-loading');
  const cacheBadge = document.getElementById('product-cache-badge');
  loading.classList.remove('hidden');
  if (cacheBadge) cacheBadge.classList.add('hidden');

  // 1) Check barcode cache first
  try {
    const cached = await getBarcodeCache(barcode);
    if (cached) {
      currentProduct = {
        name: cached.name || cached.productName,
        kcalPer100: cached.kcalPer100,
        proteinPer100: cached.proteinPer100,
        carbsPer100: cached.carbsPer100,
        fatPer100: cached.fatPer100
      };
      loading.classList.add('hidden');
      if (cacheBadge) cacheBadge.classList.remove('hidden');
      showProductModal(currentProduct);
      return;
    }
  } catch (e) { /* cache miss, continue to API */ }

  // 2) Fetch from OpenFoodFacts API
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();

    if (data.status !== 1 || !data.product) {
      loading.classList.add('hidden');
      showToast('Produkt nicht gefunden');
      setTimeout(resumeScanner, 1500);
      return;
    }

    const p = data.product;
    const n = p.nutriments || {};

    currentProduct = {
      name: p.product_name || p.product_name_de || 'Unbekanntes Produkt',
      kcalPer100: n['energy-kcal_100g'] || n['energy_100g'] || 0,
      proteinPer100: n['proteins_100g'] || 0,
      carbsPer100: n['carbohydrates_100g'] || 0,
      fatPer100: n['fat_100g'] || 0
    };

    // 3) Save to barcode cache for offline use
    await saveBarcodeCache(barcode, {
      name: currentProduct.name,
      kcalPer100: currentProduct.kcalPer100,
      proteinPer100: currentProduct.proteinPer100,
      carbsPer100: currentProduct.carbsPer100,
      fatPer100: currentProduct.fatPer100
    });

    loading.classList.add('hidden');
    showProductModal(currentProduct);

  } catch (err) {
    loading.classList.add('hidden');
    showToast('Netzwerkfehler');
    setTimeout(resumeScanner, 1500);
  }
}

function showProductModal(product) {
  document.getElementById('product-name').textContent = product.name;
  document.getElementById('product-kcal').textContent = Math.round(product.kcalPer100);
  document.getElementById('product-protein').textContent = product.proteinPer100.toFixed(1) + 'g';
  document.getElementById('product-carbs').textContent = product.carbsPer100.toFixed(1) + 'g';
  document.getElementById('product-fat').textContent = product.fatPer100.toFixed(1) + 'g';
  document.getElementById('product-grams').value = '';
  document.getElementById('product-total').classList.add('hidden');
  showModal('modal-product');
}

async function saveScannedProduct() {
  if (!currentProduct) return;
  const grams = parseFloat(document.getElementById('product-grams').value);
  if (!grams || grams <= 0) {
    showToast('Bitte Gramm eingeben');
    return;
  }

  await addEntry({
    productName: currentProduct.name,
    kcalPer100: currentProduct.kcalPer100,
    proteinPer100: currentProduct.proteinPer100,
    carbsPer100: currentProduct.carbsPer100,
    fatPer100: currentProduct.fatPer100,
    grams: grams,
    meal: typeof getSelectedMeal === 'function' ? getSelectedMeal('product') : undefined
  });

  hideModal('modal-product');
  haptic();
  showToast('Gespeichert!');
  currentProduct = null;
  resumeScanner();
  refreshTodayView();
}

// Live-Berechnung im Produkt-Modal
document.addEventListener('DOMContentLoaded', () => {
  const gramsInput = document.getElementById('product-grams');
  if (gramsInput) {
    gramsInput.addEventListener('input', () => {
      const g = parseFloat(gramsInput.value) || 0;
      const total = document.getElementById('product-total');
      if (g > 0 && currentProduct) {
        total.classList.remove('hidden');
        total.innerHTML = `
          <div class="preview-row"><span>Kalorien</span><span class="val kcal">${Math.round(currentProduct.kcalPer100 * g / 100)} kcal</span></div>
          <div class="preview-row"><span>Protein</span><span class="val protein">${Math.round(currentProduct.proteinPer100 * g / 100)}g</span></div>
          <div class="preview-row"><span>Carbs</span><span class="val carbs">${Math.round(currentProduct.carbsPer100 * g / 100)}g</span></div>
          <div class="preview-row"><span>Fett</span><span class="val fat">${Math.round(currentProduct.fatPer100 * g / 100)}g</span></div>
        `;
      } else {
        total.classList.add('hidden');
      }
    });
  }
});
