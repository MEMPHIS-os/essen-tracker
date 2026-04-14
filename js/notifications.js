// ============================================
// Web Notifications (Check-on-Open)
// ============================================

function isNotificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

async function requestNotificationPermission() {
  if (!isNotificationsSupported()) return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

async function checkPendingNotifications() {
  if (!isNotificationsSupported() || Notification.permission !== 'granted') return;
  const settings = await getSettings();

  // Daily reminder
  if (settings.dailyReminderEnabled) {
    await checkDailyReminder(settings);
  }

  // Weekly summary (Sunday)
  if (settings.weeklySummaryEnabled) {
    await checkWeeklySummary();
  }
}

async function checkDailyReminder(settings) {
  const now = new Date();
  const hour = now.getHours();
  const reminderHour = parseInt(settings.dailyReminderTime) || 19;

  if (hour >= reminderHour) {
    const today = now.toISOString().split('T')[0];
    const lastReminder = localStorage.getItem('lastDailyReminder');
    if (lastReminder === today) return;

    const entries = await getEntriesForDate(today);
    if (entries.length === 0) {
      sendNotification('EssenTracker', 'Vergiss nicht, deine Mahlzeiten zu loggen!', 'daily-reminder');
      localStorage.setItem('lastDailyReminder', today);
    }
  }
}

async function checkWeeklySummary() {
  const now = new Date();
  if (now.getDay() !== 0) return; // Sunday only

  const today = now.toISOString().split('T')[0];
  const lastSummary = localStorage.getItem('lastWeeklySummary');
  if (lastSummary === today) return;

  const allEntries = await getAllEntries();
  const settings = await getSettings();
  let totalKcal = 0, days = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const de = allEntries.filter(e => e.date && e.date.startsWith(ds));
    if (de.length > 0) {
      totalKcal += de.reduce((s, e) => s + (e.totalKcal || 0), 0);
      days++;
    }
  }

  if (days > 0) {
    const avg = Math.round(totalKcal / days);
    const streak = calculateLoggingStreak(allEntries);
    sendNotification('Wochen-Zusammenfassung',
      `\u00D8 ${avg} kcal/Tag \u2022 ${days}/7 Tage geloggt \u2022 ${streak} Tage Streak`,
      'weekly-summary');
    localStorage.setItem('lastWeeklySummary', today);
  }
}

function sendNotification(title, body, tag) {
  if (Notification.permission !== 'granted') return;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
      });
    } else {
      new Notification(title, { body, tag, icon: './icons/icon-192.png' });
    }
  } catch (e) {}
}

async function toggleDailyReminder() {
  const settings = await getSettings();
  if (!settings.dailyReminderEnabled) {
    const granted = await requestNotificationPermission();
    if (!granted) { showToast('Benachrichtigungen nicht erlaubt'); return; }
  }
  settings.dailyReminderEnabled = !settings.dailyReminderEnabled;
  await saveSettingsData(settings);
  haptic();
  showToast(settings.dailyReminderEnabled ? 'Erinnerung aktiviert' : 'Erinnerung deaktiviert');
  // Update button visual state
  const btn = document.getElementById('btn-toggle-daily');
  if (btn) {
    btn.textContent = settings.dailyReminderEnabled ? 'An' : 'Aus';
    btn.classList.toggle('active', settings.dailyReminderEnabled);
  }
}

async function toggleWeeklySummary() {
  const settings = await getSettings();
  if (!settings.weeklySummaryEnabled) {
    const granted = await requestNotificationPermission();
    if (!granted) { showToast('Benachrichtigungen nicht erlaubt'); return; }
  }
  settings.weeklySummaryEnabled = !settings.weeklySummaryEnabled;
  await saveSettingsData(settings);
  haptic();
  showToast(settings.weeklySummaryEnabled ? 'Zusammenfassung aktiviert' : 'Zusammenfassung deaktiviert');
  // Update button visual state
  const btn = document.getElementById('btn-toggle-weekly');
  if (btn) {
    btn.textContent = settings.weeklySummaryEnabled ? 'An' : 'Aus';
    btn.classList.toggle('active', settings.weeklySummaryEnabled);
  }
}
