/**
 * Reminders.gs
 * ---------------------------------------------------------------------------
 * הלוגיקה הטהורה של המערכת: מתוך שורה בגיליון + הגדרות + "עכשיו"
 * מחשבים אילו תזכורות צריכות לצאת, מה המפתח הייחודי שלהן, ואיך נראה המייל.
 *
 * אין כאן קריאות ל- SpreadsheetApp / MailApp, כדי שאפשר יהיה לבדוק את
 * הקובץ ב-Node (tests/run-tests.js). כל פונקציה כאן דטרמיניסטית.
 */

/** ברירות מחדל להגדרות (נשמרות בגיליון "הגדרות"). */
var REMINDER_DEFAULT_SETTINGS = {
  sendTime: '08:00',
  graceHours: 12,
  defaultRecipients: '',
  subjectTemplate: 'תזכורת: {{topic}} — {{when}}',
  senderName: 'תזכורות',
  footer: '',
  dryRun: false
};

/** עמודות הסימון הקבועות: שם ההגדרה -> מספר ימים לפני האירוע. */
var REMINDER_FLAG_OFFSETS = {
  sameDay: 0,
  week: 7,
  twoWeeks: 14
};

/* --------------------------- נרמול קלט ---------------------------------- */

/**
 * "08:00" / "8:00" / Date / מספר סריאלי של שעה -> {hours, minutes}.
 * מחזיר null אם אין ערך או שהוא לא תקין.
 */
function normalizeTimeOfDay_(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) {
      return null;
    }
    return { hours: value.getHours(), minutes: value.getMinutes() };
  }
  if (typeof value === 'number') {
    // שעה סריאלית של Google Sheets: 0.5 = 12:00
    if (value >= 0 && value < 1) {
      var total = Math.round(value * 24 * 60);
      return { hours: Math.floor(total / 60) % 24, minutes: total % 60 };
    }
    if (value >= 0 && value < 24) {
      return { hours: Math.floor(value), minutes: 0 };
    }
    return null;
  }
  var match = String(value).trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) {
    return null;
  }
  var hours = parseInt(match[1], 10);
  var minutes = parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return { hours: hours, minutes: minutes };
}

/** "08:00" -> "08:00"; קלט לא תקין -> null. */
function normalizeTimeString_(value) {
  var time = normalizeTimeOfDay_(value);
  if (!time) {
    return null;
  }
  var hh = time.hours < 10 ? '0' + time.hours : String(time.hours);
  var mm = time.minutes < 10 ? '0' + time.minutes : String(time.minutes);
  return hh + ':' + mm;
}

/**
 * "0, 7 ,14" / "30;60" / מספר -> מערך מספרים שלמים חיוביים, בלי כפילויות.
 */
function parseExtraDays_(value) {
  if (value === null || value === undefined || value === '') {
    return [];
  }
  var raw = typeof value === 'number' ? [value] : String(value).split(/[,;\s]+/);
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var text = String(raw[i]).trim();
    if (!text) {
      continue;
    }
    if (!/^\d{1,3}$/.test(text)) {
      continue;
    }
    var days = parseInt(text, 10);
    if (days <= 0 || days > 365) {
      continue;
    }
    if (seen[days]) {
      continue;
    }
    seen[days] = true;
    out.push(days);
  }
  out.sort(function (a, b) { return a - b; });
  return out;
}

/**
 * רשימת כל ההיסטים (בימים לפני האירוע) לשורה, ממוינת, בלי כפילויות.
 * 0 = ביום האירוע.
 */
function reminderOffsets_(row) {
  var offsets = [];
  var seen = {};
  function add(days) {
    if (typeof days !== 'number' || isNaN(days) || seen[days]) {
      return;
    }
    seen[days] = true;
    offsets.push(days);
  }
  for (var flag in REMINDER_FLAG_OFFSETS) {
    if (row && row[flag]) {
      add(REMINDER_FLAG_OFFSETS[flag]);
    }
  }
  var extra = parseExtraDays_(row ? row.extraDays : null);
  for (var i = 0; i < extra.length; i++) {
    add(extra[i]);
  }
  offsets.sort(function (a, b) { return a - b; });
  return offsets;
}

/** תווית אנושית לתזכורת: "ביום האירוע" / "שבוע לפני" / "30 ימים לפני". */
function reminderLabel_(offset) {
  if (offset === 0) {
    return 'ביום האירוע';
  }
  if (offset === 1) {
    return 'מחר';
  }
  if (offset === 7) {
    return 'שבוע לפני';
  }
  if (offset === 14) {
    return 'שבועיים לפני';
  }
  return offset + ' ימים לפני';
}

/** "בעוד 7 ימים" / "היום" — לנוסח המייל. */
function reminderDistanceText_(offset) {
  if (offset === 0) {
    return 'היום';
  }
  if (offset === 1) {
    return 'מחר';
  }
  if (offset === 2) {
    return 'בעוד יומיים';
  }
  return 'בעוד ' + offset + ' ימים';
}

/* --------------------------- ולידציה ------------------------------------ */

/**
 * בודק שורת תזכורת. מחזיר {ok: boolean, errors: [מחרוזות]}.
 * hebrewYear אופציונלי — אם לא סופק, נבדקת שנת ברירת המחדל 5785 (רגילה)
 * ושנה מעוברת, כדי לתפוס גם "אדר ב" וגם יום 30.
 */
function validateReminderRow_(row) {
  var errors = [];
  if (!row || typeof row !== 'object') {
    return { ok: false, errors: ['שורה ריקה'] };
  }
  if (!String(row.topic || '').trim()) {
    errors.push('חסר נושא');
  }
  var day = parseInt(row.day, 10);
  if (!(day >= 1 && day <= 30)) {
    errors.push('היום חייב להיות מספר בין 1 ל-30');
  }
  var month = hdMonthNumber_(row.month);
  if (month === null) {
    errors.push('חודש עברי לא מזוהה: "' + row.month + '"');
  }
  if (normalizeTimeString_(row.timeRaw) === null && row.timeRaw !== '' && row.timeRaw !== null &&
      row.timeRaw !== undefined) {
    errors.push('שעת שליחה לא תקינה: "' + row.timeRaw + '" (צריך HH:MM)');
  }
  if (!row.active) {
    return { ok: false, errors: ['השורה מסומנת כלא פעילה'] };
  }
  if (!reminderOffsets_(row).length) {
    errors.push('לא סומנה אף תזכורת (אותו יום / שבוע לפני / שבועיים לפני / ימים נוספים)');
  }
  return { ok: errors.length === 0, errors: errors };
}

/* --------------------------- חישוב המועדים ------------------------------ */

/**
 * מועד האירוע (abs) בשנה עברית נתונה, כולל מדיניות אדר והגבלת יום.
 * מחזיר {abs, year, month, day, clamped} או null.
 */
function occurrenceAbs_(row, hebrewYear) {
  var month = hdResolveMonth_(row.month, hebrewYear);
  if (month === null) {
    return null;
  }
  var clamp = hdClampDay_(hebrewYear, month, parseInt(row.day, 10));
  return {
    abs: hdHebrewToAbs_(hebrewYear, month, clamp.day),
    year: hebrewYear,
    month: month,
    day: clamp.day,
    clamped: clamp.clamped
  };
}

/**
 * כל מועדי התזכורת האפשריים לשורה, לשנה העברית הנוכחית ולזו שאחריה.
 * כל פריט: {key, offset, label, sendAtMs, eventAbs, hebrewYear, clamped, time}
 * אין כאן סינון של "כבר נשלח" או "בתוקף" — זה תפקיד הקורא.
 */
function reminderCandidates_(row, settings, nowMs) {
  var s = settings || REMINDER_DEFAULT_SETTINGS;
  var offsets = reminderOffsets_(row);
  var month = hdMonthNumber_(row.month);
  if (!offsets.length || month === null) {
    return [];
  }
  var day = parseInt(row.day, 10);
  if (!(day >= 1 && day <= 30)) {
    return [];
  }
  var time = normalizeTimeOfDay_(row.timeRaw) || normalizeTimeOfDay_(s.sendTime) ||
             normalizeTimeOfDay_(REMINDER_DEFAULT_SETTINGS.sendTime);
  var nowHebrewYear = hdHebrewDateOf_(new Date(nowMs)).year;
  var items = [];
  for (var yi = 0; yi < 2; yi++) {
    var year = nowHebrewYear + yi;
    var occurrence = occurrenceAbs_(row, year);
    if (!occurrence) {
      continue;
    }
    for (var i = 0; i < offsets.length; i++) {
      var offset = offsets[i];
      var sendAbs = occurrence.abs - offset;
      var g = hdAbsToGreg_(sendAbs);
      var sendAtMs = new Date(g.year, g.month - 1, g.day, time.hours, time.minutes, 0, 0).getTime();
      items.push({
        key: reminderKey_(row.id, year, offset, occurrence.abs),
        offset: offset,
        label: reminderLabel_(offset),
        sendAtMs: sendAtMs,
        eventAbs: occurrence.abs,
        eventHebrewDate: hdFormatHebrewDate_(year, occurrence.month, occurrence.day),
        eventIso: hdFormatIso_(occurrence.abs),
        hebrewYear: year,
        clamped: occurrence.clamped,
        time: time
      });
    }
  }
  items.sort(function (a, b) { return a.sendAtMs - b.sendAtMs; });
  return items;
}

/**
 * מפתח ייחודי לשליחה: מזהה שורה + שנה עברית + היסט + יום האירוע (abs).
 * יום האירוע נכלל במפתח כדי ששינוי תאריך בגיליון ייחשב תזכורת חדשה,
 * בעוד ריצה חוזרת על אותו תאריך לא תשלח פעמיים.
 */
function reminderKey_(rowId, hebrewYear, offset, eventAbs) {
  return String(rowId) + ':' + hebrewYear + ':' + offset + ':' + eventAbs;
}

/**
 * התזכורות שבאמת צריכות לצאת עכשיו:
 *  - מועד השליחה כבר עבר,
 *  - אבל לא עבר יותר מ- graceHours (אחרת מוותרים על תזכורת שהוחמצה),
 *  - והמפתח שלהן לא נמצא ב- sentKeys (כבר נשלח).
 */
function dueReminders_(row, settings, nowMs, sentKeys) {
  var s = settings || REMINDER_DEFAULT_SETTINGS;
  var graceMs = (typeof s.graceHours === 'number' ? s.graceHours : REMINDER_DEFAULT_SETTINGS.graceHours) * 3600000;
  var sent = sentKeys || {};
  var candidates = reminderCandidates_(row, s, nowMs);
  var due = [];
  for (var i = 0; i < candidates.length; i++) {
    var item = candidates[i];
    if (sent[item.key]) {
      continue;
    }
    if (nowMs < item.sendAtMs) {
      continue;
    }
    if (nowMs - item.sendAtMs > graceMs) {
      continue;
    }
    due.push(item);
  }
  return due;
}

/** התזכורת הבאה של השורה (הראשונה שטרם נשלחה וטרם הגיעה) — לתצוגה בגיליון. */
function nextReminder_(row, settings, nowMs, sentKeys) {
  var sent = sentKeys || {};
  var candidates = reminderCandidates_(row, settings || REMINDER_DEFAULT_SETTINGS, nowMs);
  for (var i = 0; i < candidates.length; i++) {
    var item = candidates[i];
    if (sent[item.key]) {
      continue;
    }
    if (item.sendAtMs < nowMs - 60000) {
      continue;
    }
    return item;
  }
  return null;
}

/** "2026-11-05 08:00 · שבוע לפני" */
function formatReminderMoment_(item) {
  var d = new Date(item.sendAtMs);
  var g = hdAbsToGreg_(hdGregToAbs_(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  var hh = d.getHours() < 10 ? '0' + d.getHours() : String(d.getHours());
  var mm = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
  return hdFormatIso_(g.year, g.month, g.day) + ' ' + hh + ':' + mm + ' · ' + item.label;
}

/* --------------------------- תוכן המייל --------------------------------- */

/** מחליף {{מפתחות}} בתבנית. */
function fillTemplate_(template, values) {
  var out = String(template == null ? '' : template);
  for (var key in values) {
    out = out.split('{{' + key + '}}').join(values[key] == null ? '' : String(values[key]));
  }
  return out;
}

function escapeHtml_(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * בונה את המייל עבור תזכורת אחת.
 * מחזיר {subject, html, plain}.
 */
function buildReminderEmail_(row, item, settings) {
  var s = settings || REMINDER_DEFAULT_SETTINGS;
  var topic = String(row.topic || '').trim();
  var when = item.label;
  var subject = fillTemplate_(s.subjectTemplate || REMINDER_DEFAULT_SETTINGS.subjectTemplate, {
    topic: topic,
    when: when,
    date: item.eventIso,
    distance: reminderDistanceText_(item.offset)
  });
  var notes = String(row.notes || '').trim();
  var footer = String(s.footer || '').trim();
  var clampedNote = item.clamped
    ? 'התאריך המקורי (' + parseInt(row.day, 10) + ' בחודש) לא קיים בשנה זו, ולכן התזכורת מחושבת ליום האחרון בחודש.'
    : '';

  var rows = [
    ['נושא', topic],
    ['תאריך עברי', item.eventHebrewDate],
    ['תאריך לועזי', item.eventIso],
    ['מתי', reminderDistanceText_(item.offset) + ' (' + item.label + ')']
  ];
  if (notes) {
    rows.push(['הערות', notes]);
  }

  var plainLines = [
    'תזכורת: ' + topic,
    '',
    'תאריך עברי: ' + item.eventHebrewDate,
    'תאריך לועזי: ' + item.eventIso,
    'מתי: ' + reminderDistanceText_(item.offset) + ' (' + item.label + ')'
  ];
  if (notes) {
    plainLines.push('הערות: ' + notes);
  }
  if (clampedNote) {
    plainLines.push('');
    plainLines.push(clampedNote);
  }
  if (footer) {
    plainLines.push('', footer);
  }

  var htmlRows = rows.map(function (pair) {
    return '<tr>' +
      '<td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;vertical-align:top">' +
        escapeHtml_(pair[0]) + '</td>' +
      '<td style="padding:6px 0;color:#0f172a;font-weight:600">' + escapeHtml_(pair[1]) + '</td>' +
      '</tr>';
  }).join('');

  var html = '' +
    '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px">' +
      '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;' +
        'border-radius:12px;padding:24px">' +
        '<div style="font-size:13px;letter-spacing:.08em;color:#2563eb;font-weight:700;' +
          'text-transform:uppercase;margin-bottom:8px">' + escapeHtml_(when) + '</div>' +
        '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.4;color:#0f172a">' +
          escapeHtml_(topic) + '</h1>' +
        '<table style="border-collapse:collapse;font-size:15px;width:100%">' + htmlRows + '</table>' +
        (clampedNote
          ? '<p style="margin:16px 0 0;font-size:13px;color:#b45309;background:#fffbeb;' +
            'border:1px solid #fde68a;border-radius:8px;padding:10px">' + escapeHtml_(clampedNote) + '</p>'
          : '') +
        (footer
          ? '<p style="margin:20px 0 0;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;' +
            'padding-top:12px">' + escapeHtml_(footer) + '</p>'
          : '') +
      '</div>' +
      '<div style="max-width:560px;margin:12px auto 0;text-align:center;font-size:11px;color:#94a3b8">' +
        'נשלח אוטומטית מגיליון התזכורות' +
      '</div>' +
    '</div>';

  return { subject: subject, html: html, plain: plainLines.join('\n') };
}
