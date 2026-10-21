/**
 * Code.gs
 * ---------------------------------------------------------------------------
 * שכבת Google Apps Script: גיליון, הגדרות, LOG, שליחת מיילים וטריגרים.
 * כל הלוגיקה העסקית יושבת ב- Reminders.gs, החישובים הקלנדריים ב- HebrewDate.gs.
 *
 * כניסות עיקריות:
 *   setup()             - הכנת הגיליונות, ברירות המחדל והטריגר (הרצה חד-פעמית)
 *   sendDueReminders()  - הריצה שהטריגר מפעיל כל 5 דקות
 *   dryRunNow()         - בדיקה בלי לשלוח מיילים (רושם ל-LOG)
 *   installTrigger() / uninstallTriggers()
 */

var SHEET_MAIN = 'תזכורות';
var SHEET_SETTINGS = 'הגדרות';
var SHEET_LOG = 'LOG';

var MAIN_HEADERS = [
  'מזהה',
  'נושא',
  'יום עברי',
  'חודש עברי',
  'תזכורת באותו יום',
  'שבוע לפני',
  'שבועיים לפני',
  'ימים נוספים לפני',
  'שעה (אופציונלי)',
  'נמענים (אופציונלי)',
  'פעיל',
  'הערות',
  'תאריך לועזי (מחושב)',
  'התזכורת הבאה (מחושב)'
];

var LOG_HEADERS = [
  'חותם זמן',
  'מפתח',
  'מזהה',
  'נושא',
  'שנה עברית',
  'סוג תזכורת',
  'תאריך האירוע',
  'מועד השליחה',
  'נמענים',
  'סטטוס',
  'שגיאה'
];

var SETTINGS_DEFINITIONS = [
  ['sendTime', '08:00',
   'שעת השליחה היומית (HH:MM). שעה שמולאה בעמודת "שעה (אופציונלי)" דורסת אותה.'],
  ['graceHours', '12',
   'כמה שעות אחרי מועד השליחה מותר עדיין לשלוח תזכורת שהוחמצה (0 = בלי השלמה).'],
  ['defaultRecipients', '',
   'נמענים כברירת מחדל, מופרדים בפסיק. עמודת "נמענים" בגיליון דורסת אותם.'],
  ['subjectTemplate', 'תזכורת: {{topic}} — {{when}}',
   'תבנית נושא המייל. משתנים: {{topic}}, {{when}}, {{date}}, {{distance}}.'],
  ['senderName', 'תזכורות', 'שם השולח שיוצג בנמען.'],
  ['footer', '', 'שורת סיום במייל (אופציונלי).'],
  ['dryRun', 'FALSE', 'TRUE = לא נשלחים מיילים, רק נרשם LOG.'],
  ['maxSendsPerRun', '25', 'תקרת שליחות לריצה אחת, כהגנה על מכסת המיילים.']
];

/** היסט התזכורת שמוגדר כברירת מחדל בטריגר. */
var TRIGGER_MINUTES = 5;

/* ============================== כניסות ================================= */

/**
 * הכנה חד-פעמית: יוצר גיליונות, כותרות, ברירות מחדל, ומתקין טריגר ל-5 דקות.
 * בטוח להריץ שוב — לא דורס נתונים קיימים.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var main = ensureSheet_(ss, SHEET_MAIN, MAIN_HEADERS);
  var settings = ensureSheet_(ss, SHEET_SETTINGS, ['מפתח', 'ערך', 'הסבר']);
  var log = ensureSheet_(ss, SHEET_LOG, LOG_HEADERS);

  seedSettings_(settings);
  formatMainSheet_(main);
  formatLogSheet_(log);
  seedSampleRow_(main);

  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone('Asia/Jerusalem');
  installTrigger();
  ss.toast('התזכורות מוכנות. הטריגר רץ כל ' + TRIGGER_MINUTES + ' דקות.', 'תזכורות', 8);
}

/** הריצה שהטריגר מפעיל. בטוחה להרצה ידנית. */
function sendDueReminders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    Logger.log('ריצה קודמת עדיין פעילה — מדלג על הריצה הזו.');
    return;
  }
  try {
    runCycle_(false);
  } finally {
    lock.releaseLock();
  }
}

/** בדיקה יבשה: מחשב מה היה נשלח עכשיו, רושם ל-LOG, ולא שולח מייל. */
function dryRunNow() {
  runCycle_(true);
}

/** מתקין טריגר כל 5 דקות (מוחק קודמים). */
function installTrigger() {
  uninstallTriggers();
  ScriptApp.newTrigger('sendDueReminders')
    .timeBased()
    .everyMinutes(TRIGGER_MINUTES)
    .create();
  Logger.log('הותקן טריגר כל ' + TRIGGER_MINUTES + ' דקות.');
}

/** מסיר את הטריגרים של sendDueReminders. */
function uninstallTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDueReminders') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/** תפריט בגיליון. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('תזכורות')
    .addItem('שלח עכשיו', 'sendDueReminders')
    .addItem('בדיקה יבשה (בלי מיילים)', 'dryRunNow')
    .addSeparator()
    .addItem('התקנת טריגר (5 דקות)', 'installTrigger')
    .addItem('הסרת טריגר', 'uninstallTriggers')
    .addItem('הכנה / תיקון מבנה הגיליון', 'setup')
    .addToUi();
}

/* ============================== מחזור ריצה ============================= */

function runCycle_(forceDryRun) {
  var started = new Date();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var main = ss.getSheetByName(SHEET_MAIN);
  var log = ss.getSheetByName(SHEET_LOG);
  if (!main) {
    throw new Error('לא נמצא גיליון "' + SHEET_MAIN + '". הריצו setup() פעם אחת.');
  }
  if (!log) {
    log = ensureSheet_(ss, SHEET_LOG, LOG_HEADERS);
    formatLogSheet_(log);
  }

  var settings = readSettings_(ss);
  var dryRun = forceDryRun || settings.dryRun;
  var rows = readReminderRows_(main);
  assignMissingIds_(main, rows);

  var sentKeys = readSentKeys_(log);
  var nowMs = Date.now();
  var sent = 0;
  var skipped = 0;
  var errors = 0;
  var budget = settings.maxSendsPerRun;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var validation = validateReminderRow_(row);
    if (!validation.ok) {
      if (row.topic || row.day || row.month) {
        Logger.log('שורה ' + row.rowNumber + ' דולגה: ' + validation.errors.join('; '));
      }
      continue;
    }
    var due = dueReminders_(row, settings, nowMs, sentKeys);
    for (var j = 0; j < due.length; j++) {
      var item = due[j];
      if (sentKeys[item.key]) {
        continue;
      }
      if (sent >= budget) {
        appendLogRow_(log, item, row, '', 'דולג (תקרת ריצה)', '');
        skipped++;
        continue;
      }
      var recipients = resolveRecipients_(row, settings);
      if (!recipients.length) {
        appendLogRow_(log, item, row, '', 'שגיאה', 'לא הוגדרו נמענים (לא בשורה ולא בהגדרות)');
        errors++;
        continue;
      }
      var email = buildReminderEmail_(row, item, settings);
      try {
        if (!dryRun) {
          MailApp.sendEmail({
            to: recipients.join(','),
            subject: email.subject,
            body: email.plain,
            htmlBody: email.html,
            name: settings.senderName || 'תזכורות'
          });
        }
        appendLogRow_(log, item, row, recipients.join(','),
          dryRun ? 'יבש (לא נשלח)' : 'נשלח', '');
        sentKeys[item.key] = true;
        sent++;
      } catch (err) {
        appendLogRow_(log, item, row, recipients.join(','), 'שגיאה', String(err));
        errors++;
        Logger.log('שגיאה בשליחה לשורה ' + row.rowNumber + ': ' + err);
      }
    }
  }

  writeComputedColumns_(main, rows, settings, Date.now(), sentKeys);

  var elapsed = (new Date().getTime() - started.getTime()) / 1000;
  Logger.log('ריצה הסתיימה: ' + sent + ' נשלחו, ' + skipped + ' דולגו, ' +
             errors + ' שגיאות, ' + Math.round(elapsed * 10) / 10 + ' שנ׳' +
             (dryRun ? ' (מצב יבש)' : ''));
}

/* ============================== קריאת נתונים =========================== */

function readSettings_(ss) {
  var settings = {};
  for (var key in REMINDER_DEFAULT_SETTINGS) {
    settings[key] = REMINDER_DEFAULT_SETTINGS[key];
  }
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) {
    return settings;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return settings;
  }
  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][0] || '').trim();
    if (!name) {
      continue;
    }
    settings[name] = values[i][1];
  }
  settings.sendTime = normalizeTimeString_(settings.sendTime) || REMINDER_DEFAULT_SETTINGS.sendTime;
  settings.graceHours = toNumber_(settings.graceHours, REMINDER_DEFAULT_SETTINGS.graceHours);
  settings.maxSendsPerRun = toNumber_(settings.maxSendsPerRun, 25);
  settings.defaultRecipients = String(settings.defaultRecipients || '').trim();
  settings.subjectTemplate = String(settings.subjectTemplate || REMINDER_DEFAULT_SETTINGS.subjectTemplate);
  settings.senderName = String(settings.senderName || '');
  settings.footer = String(settings.footer || '');
  settings.dryRun = toBoolean_(settings.dryRun);
  return settings;
}

/** קורא את גיליון התזכורות לאובייקטים לפי הכותרות. */
function readReminderRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), MAIN_HEADERS.length);
  var rows = [];
  if (lastRow < 2) {
    return rows;
  }
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    var row = {
      rowNumber: i + 2,
      id: String(v[0] || '').trim(),
      topic: String(v[1] || '').trim(),
      day: v[2],
      month: v[3],
      sameDay: toBoolean_(v[4]),
      week: toBoolean_(v[5]),
      twoWeeks: toBoolean_(v[6]),
      extraDays: v[7],
      timeRaw: v[8],
      recipientsRaw: String(v[9] || '').trim(),
      active: v[10] === '' || v[10] === null || v[10] === undefined ? true : toBoolean_(v[10]),
      notes: String(v[11] || '').trim()
    };
    var hasContent = row.topic || row.day !== '' || row.month !== '';
    if (!hasContent) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

/** מפתחות שכבר נשלחו — עמודה B בגיליון LOG. */
function readSentKeys_(logSheet) {
  var keys = {};
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) {
    return keys;
  }
  var values = logSheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) {
      keys[key] = true;
    }
  }
  return keys;
}

/* ============================== כתיבה ================================== */

/** מוסיף שורת LOG. לעולם לא זורק — כשל בלוג לא מפיל את הריצה. */
function appendLogRow_(logSheet, item, row, recipients, status, error) {
  try {
    logSheet.appendRow([
      new Date(),
      item.key,
      row.id || '',
      row.topic || '',
      item.hebrewYear,
      item.label,
      item.eventIso,
      item.sendAtMs ? new Date(item.sendAtMs) : '',
      recipients || '',
      status,
      error || ''
    ]);
  } catch (err) {
    Logger.log('כשל בכתיבת LOG: ' + err);
  }
}

/**
 * ממלא מזהים חסרים ומטפל בכפילות מזהים (העתקת שורה בגיליון).
 * מזהה הוא הבסיס למניעת שליחה כפולה, לכן הוא חייב להיות ייחודי ויציב.
 */
function assignMissingIds_(sheet, rows) {
  var seen = {};
  var writes = [];
  var changed = false;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var id = row.id;
    if (!id || seen[id]) {
      id = 'R' + row.rowNumber + '-' + Utilities.getUuid().slice(0, 8);
      writes.push({ row: row.rowNumber, id: id });
      changed = true;
    }
    seen[id] = true;
    row.id = id;
  }
  for (var j = 0; j < writes.length; j++) {
    sheet.getRange(writes[j].row, 1).setValue(writes[j].id);
  }
  return changed;
}

/** מעדכן את שתי העמודות המחושבות (תאריך לועזי + התזכורת הבאה). */
function writeComputedColumns_(sheet, rows, settings, nowMs, sentKeys) {
  if (!rows.length) {
    return;
  }
  var firstRow = rows[0].rowNumber;
  var lastRow = rows[rows.length - 1].rowNumber;
  var values = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var iso = '';
    var next = '';
    if (row.id) {
      var occurrence = occurrenceAbs_(row, hdHebrewDateOf_(new Date(nowMs)).year);
      if (occurrence) {
        iso = hdFormatIso_(occurrence.abs);
      }
      var item = nextReminder_(row, settings, nowMs, sentKeys);
      if (item) {
        next = formatReminderMoment_(item);
      }
    }
    values.push([iso, next]);
  }
  // הרשימה צפויה להיות רציפה (readReminderRows_ מדלג רק על שורות ריקות).
  if (lastRow - firstRow + 1 === values.length) {
    sheet.getRange(firstRow, 13, values.length, 2).setValues(values);
  } else {
    for (var j = 0; j < rows.length; j++) {
      sheet.getRange(rows[j].rowNumber, 13, 1, 2).setValues([values[j]]);
    }
  }
}

/* ============================== עזר ==================================== */

function resolveRecipients_(row, settings) {
  var raw = String(row.recipientsRaw || '').trim() || String(settings.defaultRecipients || '').trim();
  if (!raw) {
    return [];
  }
  var parts = raw.split(/[,;\n]+/);
  var out = [];
  var seen = {};
  for (var i = 0; i < parts.length; i++) {
    var email = parts[i].trim();
    if (!email) {
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Logger.log('כתובת לא תקינה, דולגה: ' + email);
      continue;
    }
    var key = email.toLowerCase();
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    out.push(email);
  }
  return out;
}

function toBoolean_(value) {
  if (value === true || value === 1) {
    return true;
  }
  if (value === false || value === 0 || value === null || value === undefined || value === '') {
    return false;
  }
  var text = String(value).trim().toLowerCase();
  return text === 'true' || text === 'v' || text === 'x' || text === '1' ||
         text === 'כן' || text === 'yes' || text === '✓';
}

function toNumber_(value, fallback) {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }
  var n = Number(value);
  return isNaN(n) ? fallback : n;
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#e8eef7')
      .setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function seedSettings_(sheet) {
  var lastRow = sheet.getLastRow();
  var existing = {};
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      existing[String(values[i][0] || '').trim()] = true;
    }
  }
  var toAdd = [];
  for (var j = 0; j < SETTINGS_DEFINITIONS.length; j++) {
    if (!existing[SETTINGS_DEFINITIONS[j][0]]) {
      toAdd.push(SETTINGS_DEFINITIONS[j]);
    }
  }
  if (toAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(3, 520);
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight('bold')
      .setBackground('#e8eef7');
    sheet.setFrozenRows(1);
  }
}

function formatMainSheet_(sheet) {
  sheet.setRightToLeft(true);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, MAIN_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#e8eef7')
    .setWrap(true);
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 240);
  sheet.setColumnWidth(8, 150);
  sheet.setColumnWidth(9, 130);
  sheet.setColumnWidth(10, 200);
  sheet.setColumnWidth(12, 220);
  sheet.setColumnWidth(13, 140);
  sheet.setColumnWidth(14, 220);

  var maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  var flags = ['E', 'F', 'G', 'K'];
  for (var i = 0; i < flags.length; i++) {
    sheet.getRange(flags[i] + '2:' + flags[i] + (maxRows + 1)).setDataValidation(checkbox);
  }
  sheet.getRange('C2:C' + (maxRows + 1)).setNumberFormat('0');
}

function formatLogSheet_(sheet) {
  sheet.setRightToLeft(true);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, LOG_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#eef2f7');
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(4, 200);
  sheet.setColumnWidth(9, 220);
  sheet.setColumnWidth(11, 260);
}

/** מוסיף שורת דוגמה אחת אם הגיליון ריק מתוכן. */
function seedSampleRow_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    return;
  }
  sheet.getRange(2, 1, 1, 12).setValues([[
    '',
    'דוגמה — יום הולדת',
    15,
    'כסלו',
    true,
    true,
    false,
    '30',
    '',
    '',
    true,
    'אפשר למחוק את השורה הזו'
  ]]);
}
