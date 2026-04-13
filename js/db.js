// ============================================
// IndexedDB — Lokale Datenspeicherung
// ============================================

const DB_NAME = 'EssenTrackerDB';
const DB_VERSION = 4;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const database = e.target.result;

      if (!database.objectStoreNames.contains('entries')) {
        const store = database.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('recipeId', 'recipeId', { unique: false });
      }

      if (!database.objectStoreNames.contains('recipes')) {
        database.createObjectStore('recipes', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }

      // v2: Letzte Produkte
      if (!database.objectStoreNames.contains('recentProducts')) {
        const rp = database.createObjectStore('recentProducts', { keyPath: 'productName' });
        rp.createIndex('lastUsed', 'lastUsed', { unique: false });
      }

      // v3: Gewicht, Barcode-Cache, Wasser
      if (!database.objectStoreNames.contains('weights')) {
        database.createObjectStore('weights', { keyPath: 'date' });
      }

      if (!database.objectStoreNames.contains('barcodeCache')) {
        database.createObjectStore('barcodeCache', { keyPath: 'barcode' });
      }

      if (!database.objectStoreNames.contains('waterLog')) {
        database.createObjectStore('waterLog', { keyPath: 'date' });
      }

      // v4: UserProfile, Koffein, Achievements
      if (!database.objectStoreNames.contains('userProfile')) {
        database.createObjectStore('userProfile', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('caffeineLog')) {
        const cl = database.createObjectStore('caffeineLog', { keyPath: 'id' });
        cl.createIndex('date', 'date', { unique: false });
      }

      if (!database.objectStoreNames.contains('achievements')) {
        database.createObjectStore('achievements', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    req.onerror = (e) => reject(e.target.error);
  });
}

// ---- Generic helpers ----

function dbPut(storeName, data) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function dbGet(storeName, key) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAll(storeName) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const tx = database.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ---- Meal auto-detect ----

function autoDetectMeal() {
  const h = new Date().getHours();
  if (h < 10) return 'fruehstueck';
  if (h < 14) return 'mittagessen';
  if (h < 18) return 'abendessen';
  return 'snacks';
}

// ---- Entry-specific ----

async function addEntry(entry) {
  entry.id = entry.id || crypto.randomUUID();
  entry.date = entry.date || new Date().toISOString();
  entry.meal = entry.meal || autoDetectMeal();
  const g = entry.grams;
  entry.totalKcal = ((entry.kcalPer100 || 0) * g) / 100;
  entry.totalProtein = ((entry.proteinPer100 || 0) * g) / 100;
  entry.totalCarbs = ((entry.carbsPer100 || 0) * g) / 100;
  entry.totalFat = ((entry.fatPer100 || 0) * g) / 100;
  entry.totalSugar = ((entry.sugarPer100 || 0) * g) / 100;
  entry.totalFiber = ((entry.fiberPer100 || 0) * g) / 100;
  entry.totalSodium = ((entry.sodiumPer100 || 0) * g) / 100;
  entry.totalSaturatedFat = ((entry.saturatedFatPer100 || 0) * g) / 100;
  entry.totalVitaminD = ((entry.vitaminDPer100 || 0) * g) / 100;
  entry.totalCalcium = ((entry.calciumPer100 || 0) * g) / 100;
  entry.totalIron = ((entry.ironPer100 || 0) * g) / 100;
  await dbPut('entries', entry);

  // Automatisch in "Letzte Produkte" speichern
  await saveRecentProduct({
    productName: entry.productName,
    kcalPer100: entry.kcalPer100,
    proteinPer100: entry.proteinPer100,
    carbsPer100: entry.carbsPer100,
    fatPer100: entry.fatPer100,
    sugarPer100: entry.sugarPer100 || 0,
    fiberPer100: entry.fiberPer100 || 0,
    sodiumPer100: entry.sodiumPer100 || 0,
    saturatedFatPer100: entry.saturatedFatPer100 || 0,
    lastGrams: entry.grams,
    lastUsed: Date.now()
  });

  return entry;
}

async function updateEntry(entry) {
  const g = entry.grams;
  entry.totalKcal = ((entry.kcalPer100 || 0) * g) / 100;
  entry.totalProtein = ((entry.proteinPer100 || 0) * g) / 100;
  entry.totalCarbs = ((entry.carbsPer100 || 0) * g) / 100;
  entry.totalFat = ((entry.fatPer100 || 0) * g) / 100;
  entry.totalSugar = ((entry.sugarPer100 || 0) * g) / 100;
  entry.totalFiber = ((entry.fiberPer100 || 0) * g) / 100;
  entry.totalSodium = ((entry.sodiumPer100 || 0) * g) / 100;
  entry.totalSaturatedFat = ((entry.saturatedFatPer100 || 0) * g) / 100;
  entry.totalVitaminD = ((entry.vitaminDPer100 || 0) * g) / 100;
  entry.totalCalcium = ((entry.calciumPer100 || 0) * g) / 100;
  entry.totalIron = ((entry.ironPer100 || 0) * g) / 100;
  await dbPut('entries', entry);
  return entry;
}

async function getEntriesForDate(dateStr) {
  const all = await dbGetAll('entries');
  return all.filter(e => !e.recipeId && e.date.startsWith(dateStr));
}

async function getTodayEntries() {
  const today = new Date().toISOString().split('T')[0];
  return getEntriesForDate(today);
}

async function deleteEntry(id) {
  return dbDelete('entries', id);
}

async function getAllEntries() {
  const all = await dbGetAll('entries');
  return all.filter(e => !e.recipeId);
}

// ---- Recent Products ----

async function saveRecentProduct(product) {
  await dbPut('recentProducts', product);
  const all = await dbGetAll('recentProducts');
  if (all.length > 30) {
    all.sort((a, b) => a.lastUsed - b.lastUsed);
    const toDelete = all.slice(0, all.length - 30);
    for (const p of toDelete) {
      await dbDelete('recentProducts', p.productName);
    }
  }
}

async function getRecentProducts() {
  const all = await dbGetAll('recentProducts');
  return all.sort((a, b) => b.lastUsed - a.lastUsed);
}

// ---- Barcode Cache ----

async function saveBarcodeCache(barcode, productData) {
  await dbPut('barcodeCache', { barcode, ...productData, cachedAt: Date.now() });
}

async function getBarcodeCache(barcode) {
  return dbGet('barcodeCache', barcode);
}

// ---- Weight Tracker ----

async function saveWeight(date, weight) {
  await dbPut('weights', { date, weight });
}

async function getWeight(date) {
  return dbGet('weights', date);
}

async function getAllWeights() {
  const all = await dbGetAll('weights');
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Water Log ----

async function saveWaterLog(date, glasses) {
  await dbPut('waterLog', { date, glasses });
}

async function getWaterLog(date) {
  return dbGet('waterLog', date);
}

// ---- Recipe-specific ----

async function saveRecipe(recipe) {
  recipe.id = recipe.id || crypto.randomUUID();
  await dbPut('recipes', recipe);
  return recipe;
}

async function getAllRecipes() {
  return dbGetAll('recipes');
}

async function deleteRecipe(id) {
  return dbDelete('recipes', id);
}

async function addRecipeAsEntries(recipe) {
  const entries = [];
  for (const ing of recipe.ingredients) {
    const entry = await addEntry({
      productName: `${recipe.name}: ${ing.name}`,
      kcalPer100: ing.kcalPer100,
      proteinPer100: ing.proteinPer100,
      carbsPer100: ing.carbsPer100,
      fatPer100: ing.fatPer100,
      grams: ing.grams
    });
    entries.push(entry);
  }
  return entries;
}

// ---- Settings ----

async function getSettings() {
  const result = await dbGet('settings', 'userGoals');
  const defaults = {
    key: 'userGoals', dailyKcal: 2000, dailyProtein: 120, dailyWater: 8, userName: '',
    dailyCarbs: 250, dailyFat: 70, dailySugar: 25, dailyFiber: 25,
    dailySodium: 2300, dailySaturatedFat: 20, dailyCalcium: 1000,
    dailyIron: 15, dailyVitaminD: 20, dailyCaffeine: 400
  };
  return result ? { ...defaults, ...result } : defaults;
}

async function saveSettingsData(settings) {
  settings.key = 'userGoals';
  return dbPut('settings', settings);
}

// ---- User Profile ----

async function getUserProfile() {
  return dbGet('userProfile', 'main');
}

async function saveUserProfile(profile) {
  profile.id = 'main';
  return dbPut('userProfile', profile);
}

// ---- Caffeine Log ----

async function addCaffeineEntry(entry) {
  entry.id = entry.id || crypto.randomUUID();
  entry.date = entry.date || new Date().toISOString().split('T')[0];
  entry.time = entry.time || new Date().toTimeString().slice(0, 5);
  await dbPut('caffeineLog', entry);
  return entry;
}

async function getCaffeineForDate(dateStr) {
  const all = await dbGetAll('caffeineLog');
  return all.filter(e => e.date === dateStr);
}

async function deleteCaffeineEntry(id) {
  return dbDelete('caffeineLog', id);
}

// ---- Achievements ----

async function getAchievement(key) {
  return dbGet('achievements', key);
}

async function saveAchievement(key) {
  return dbPut('achievements', { key, dateEarned: new Date().toISOString() });
}

async function getAllAchievements() {
  return dbGetAll('achievements');
}

// ---- Full Backup ----

async function exportFullBackup() {
  const entries = await dbGetAll('entries');
  const recipes = await dbGetAll('recipes');
  const settings = await getSettings();
  const recentProducts = await dbGetAll('recentProducts');
  const weights = await dbGetAll('weights');
  const barcodeCache = await dbGetAll('barcodeCache');
  const waterLog = await dbGetAll('waterLog');
  const userProfile = await getUserProfile();
  const caffeineLog = await dbGetAll('caffeineLog');
  const achievements = await getAllAchievements();
  return JSON.stringify({
    entries, recipes, settings, recentProducts,
    weights, barcodeCache, waterLog,
    userProfile, caffeineLog, achievements,
    exportDate: new Date().toISOString(), version: 4
  }, null, 2);
}

async function importFullBackup(jsonStr) {
  const data = JSON.parse(jsonStr);
  if (data.entries) for (const e of data.entries) await dbPut('entries', e);
  if (data.recipes) for (const r of data.recipes) await dbPut('recipes', r);
  if (data.settings) await dbPut('settings', data.settings);
  if (data.recentProducts) for (const p of data.recentProducts) await dbPut('recentProducts', p);
  if (data.weights) for (const w of data.weights) await dbPut('weights', w);
  if (data.barcodeCache) for (const b of data.barcodeCache) await dbPut('barcodeCache', b);
  if (data.waterLog) for (const l of data.waterLog) await dbPut('waterLog', l);
  if (data.userProfile) await dbPut('userProfile', data.userProfile);
  if (data.caffeineLog) for (const c of data.caffeineLog) await dbPut('caffeineLog', c);
  if (data.achievements) for (const a of data.achievements) await dbPut('achievements', a);
}
