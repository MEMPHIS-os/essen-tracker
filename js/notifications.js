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

  // Meal reminders (Mittag + Abend)
  if (settings.mealRemindersEnabled) {
    await checkMealReminders();
  }

  // Hydration reminder (stuendlich zwischen 10 und 20 Uhr)
  if (settings.hydrationReminderEnabled) {
    await checkHydrationReminder(settings);
  }
}

// Stuendliche Pruefung: liegt der User hinter dem erwarteten Tages-Pensum Wasser?
// Erwartung: linearer Verlauf zwischen 8 und 20 Uhr
async function checkHydrationReminder(settings) {
  const now = new Date();
  const hour = now.getHours();
  if (hour < 10 || hour > 20) return; // nur 10-20 Uhr

  const today = now.toISOString().split('T')[0];
  const flag = `hydration_${today}_${hour}`;
  if (localStorage.getItem(flag)) return;

  const log = await getWaterLog(today);
  const glasses = log ? log.glasses : 0;
  const goal = settings.dailyWater || 8;

  const expectedRatio = Math.max(0, Math.min(1, (hour - 8) / 12));
  const expected = goal * expectedRatio;

  // Nur pushen, wenn mindestens 1 Glas Rueckstand UND unter 90% Erfuellung
  const shortfall = expected - glasses;
  if (shortfall < 1 || glasses >= goal * 0.9) {
    localStorage.setItem(flag, '1');
    return;
  }

  const missing = Math.ceil(shortfall);
  sendNotification(
    'Wasser-Erinnerung',
    `Du liegst ca. ${missing} Glas hinter deinem Tagespensum (${glasses}/${goal}).`,
    'hydration-' + hour
  );
  localStorage.setItem(flag, '1');
}

async function toggleHydrationReminder() {
  const settings = await getSettings();
  if (!settings.hydrationReminderEnabled) {
    const granted = await requestNotificationPermission();
    if (!granted) { showToast('Benachrichtigungen nicht erlaubt'); return; }
  }
  settings.hydrationReminderEnabled = !settings.hydrationReminderEnabled;
  await saveSettingsData(settings);
  haptic();
  showToast(settings.hydrationReminderEnabled ? 'Wasser-Erinnerung aktiviert' : 'Wasser-Erinnerung deaktiviert');
  const btn = document.getElementById('btn-toggle-hydration');
  if (btn) {
    btn.textContent = settings.hydrationReminderEnabled ? 'An' : 'Aus';
    btn.classList.toggle('active', settings.hydrationReminderEnabled);
  }
}

// Mittag (12-13 Uhr) und Abend (18-20 Uhr) Reminder, wenn die jeweilige Mahlzeit noch nicht geloggt wurde
async function checkMealReminders() {
  const now = new Date();
  const hour = now.getHours();
  const today = now.toISOString().split('T')[0];
  const entries = await getEntriesForDate(today);

  // Mittag: 12-14, wenn noch nichts als mittagessen geloggt
  if (hour >= 12 && hour < 14) {
    const flag = `mealReminder_lunch_${today}`;
    if (!localStorage.getItem(flag)) {
      const hasLunch = entries.some(e => e.meal === 'mittagessen');
      if (!hasLunch) {
        sendNotification('Mittagessen?', 'Vergiss nicht, deine Mahlzeit zu tracken.', 'meal-lunch');
        localStorage.setItem(flag, '1');
      }
    }
  }

  // Abend: 18-21, wenn noch nichts als abendessen geloggt
  if (hour >= 18 && hour < 21) {
    const flag = `mealReminder_dinner_${today}`;
    if (!localStorage.getItem(flag)) {
      const hasDinner = entries.some(e => e.meal === 'abendessen');
      if (!hasDinner) {
        sendNotification('Abendessen?', 'Tracke dein Abendessen bevor du vergisst.', 'meal-dinner');
        localStorage.setItem(flag, '1');
      }
    }
  }
}

async function toggleMealReminders() {
  const settings = await getSettings();
  if (!settings.mealRemindersEnabled) {
    const granted = await requestNotificationPermission();
    if (!granted) { showToast('Benachrichtigungen nicht erlaubt'); return; }
  }
  settings.mealRemindersEnabled = !settings.mealRemindersEnabled;
  await saveSettingsData(settings);
  haptic();
  showToast(settings.mealRemindersEnabled ? 'Meal-Reminder aktiviert' : 'Meal-Reminder deaktiviert');
  const btn = document.getElementById('btn-toggle-meal');
  if (btn) {
    btn.textContent = settings.mealRemindersEnabled ? 'An' : 'Aus';
    btn.classList.toggle('active', settings.mealRemindersEnabled);
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
