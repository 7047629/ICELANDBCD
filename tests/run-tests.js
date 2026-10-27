/**
 * tests/run-tests.js
 * ---------------------------------------------------------------------------
 * בדיקות לוגיקה טהורה, בלי Google Apps Script.
 *
 * הקובץ טוען את קבצי ה- .gs עצמם (בדיוק אלה שמדביקים ב-Apps Script)
 * לתוך הקשר Node מבודד, ומריץ עליהם בדיקות.
 *
 * הרצה:
 *   TZ=Asia/Jerusalem node tests/run-tests.js
 *
 * למה TZ? שעות השליחה מחושבות לפי אזור הזמן של הסביבה. Apps Script קובע
 * אזור זמן ב- appsscript.json (Asia/Jerusalem), ולכן גם הבדיקות חייבות
 * לרוץ באותו אזור זמן, כולל שעון קיץ.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const context = vm.createContext({ Logger: { log() {} } });
for (const file of ['HebrewDate.gs', 'Reminders.gs', 'Code.gs']) {
  const full = path.join(ROOT, 'src', file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: file });
}

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'hebrew-dates.json'), 'utf8')
);

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, message: err.message });
  }
}

function eq(actual, expected, hint) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((hint ? hint + ': ' : '') + 'expected ' + b + ', got ' + a);
  }
}

function ok(value, hint) {
  if (!value) {
    throw new Error(hint || 'expected truthy value');
  }
}

const {
  hdHebrewToAbs_,
  hdGregToAbs_,
  hdAbsToGreg_,
  hdAbsToHebrew_,
  hdHebrewDateOf_,
  hdGematria_,
  hdPunctuateGematria_,
  hdMonthNumber_,
  hdResolveMonth_,
  hdClampDay_,
  hdMonthDays_,
  hdIsLeapYear_,
  hdFormatHebrewDate_,
  hdFormatHebrewYear_,
  hdWeekdayOfAbs_,
  normalizeTimeOfDay_,
  normalizeTimeString_,
  parseExtraDays_,
  parseUntilDays_,
  reminderOffsets_,
  reminderLabel_,
  reminderCandidates_,
  reminderKey_,
  dueReminders_,
  nextReminder_,
  formatReminderMoment_,
  validateReminderRow_,
  buildReminderEmail_,
  REMINDER_DEFAULT_SETTINGS
} = context;

const settings = Object.assign({}, REMINDER_DEFAULT_SETTINGS, {
  sendTime: '08:00',
  graceHours: 12,
  defaultRecipients: 'me@example.com',
  subjectTemplate: 'תזכורת: {{topic}} — {{when}}'
});

/* ------------------------- 1. המרות תאריכים ---------------------------- */

check('effective timezone is Asia/Jerusalem (tests must run there)', () => {
  // בודקים את אזור הזמן בפועל, לא את משתנה הסביבה: ב-Windows Node 24 לא
  // חושף ולא מכבד את TZ, ולכן אזור הזמן של המערכת הוא שקובע את חישובי התאריך.
  // ב-Linux/macOS ערך TZ=Asia/Jerusalem מופיע כאן בדיוק כמו קודם.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  ok(zone === 'Asia/Jerusalem',
    'run with TZ=Asia/Jerusalem (or on a machine in that zone) so send-time math ' +
    'matches Apps Script; effective zone is ' + zone);
});

check('hebrew -> gregorian matches reference calendar (' + fixtures.dates.length + ' dates)', () => {
  for (const d of fixtures.dates) {
    const g = hdAbsToGreg_(hdHebrewToAbs_(d.hy, d.hm, d.hd));
    const iso = g.year + '-' + String(g.month).padStart(2, '0') + '-' + String(g.day).padStart(2, '0');
    if (iso !== d.iso) {
      throw new Error(`hy=${d.hy} hm=${d.hm} hd=${d.hd}: expected ${d.iso}, got ${iso}`);
    }
  }
});

check('gregorian -> abs agrees with hebrew -> abs', () => {
  for (const d of fixtures.dates) {
    const [y, m, day] = d.iso.split('-').map(Number);
    const fromGreg = hdGregToAbs_(y, m, day);
    const fromHebrew = hdHebrewToAbs_(d.hy, d.hm, d.hd);
    if (fromGreg !== fromHebrew) {
      throw new Error(`${d.iso}: greg abs ${fromGreg} != hebrew abs ${fromHebrew}`);
    }
  }
});

check('abs -> hebrew round trip', () => {
  for (const d of fixtures.dates) {
    const h = hdAbsToHebrew_(hdHebrewToAbs_(d.hy, d.hm, d.hd));
    if (h.year !== d.hy || h.month !== d.hm || h.day !== d.hd) {
      throw new Error(`expected ${d.hy}/${d.hm}/${d.hd}, got ${h.year}/${h.month}/${h.day}`);
    }
  }
});

check('known anchor dates', () => {
  eq(hdHebrewToAbs_(5787, 7, 1), hdGregToAbs_(2026, 9, 12), '1 Tishrei 5787 = 2026-09-12');
  eq(hdHebrewToAbs_(5783, 1, 15), hdGregToAbs_(2023, 4, 6), '15 Nisan 5783 = 2023-04-06');
  eq(hdHebrewToAbs_(5787, 12, 30), hdGregToAbs_(2027, 3, 9), '30 Adar I 5787 = 2027-03-09');
  eq(hdWeekdayOfAbs_(719163), 4, '1970-01-01 was Thursday');
});

check('leap years follow the 19-year cycle', () => {
  eq(hdIsLeapYear_(5784), true, '5784');
  eq(hdIsLeapYear_(5785), false, '5785');
  eq(hdIsLeapYear_(5786), false, '5786');
  eq(hdIsLeapYear_(5787), true, '5787');
  eq(hdIsLeapYear_(5788), false, '5788');
});

/* ------------------------------ 2. גימטריה ------------------------------ */

check('gematria matches reference (' + Object.keys(fixtures.gematria).length + ' values)', () => {
  for (const key of Object.keys(fixtures.gematria)) {
    const n = Number(key);
    const mine = hdPunctuateGematria_(hdGematria_(n));
    if (mine !== fixtures.gematria[key]) {
      throw new Error(`${n}: expected ${fixtures.gematria[key]}, got ${mine}`);
    }
  }
});

check('readable hebrew dates', () => {
  eq(hdFormatHebrewYear_(5787), 'תשפ״ז');
  eq(hdFormatHebrewDate_(5787, 9, 15), 'ט״ו כסלו תשפ״ז');
  eq(hdFormatHebrewDate_(5785, 12, 1), 'א׳ אדר תשפ״ה');
});

/* --------------------------- 3. שמות חודשים ---------------------------- */

check('month names and variants resolve', () => {
  const cases = {
    'ניסן': 1, 'אייר': 2, 'סיון': 3, 'סיוון': 3, 'תמוז': 4, 'אב': 5, 'אלול': 6,
    'תשרי': 7, 'חשון': 8, 'חשוון': 8, 'מרחשון': 8, 'כסלו': 9, 'כסליו': 9,
    'טבת': 10, 'שבט': 11, 'אדר': 12, 'אדר א׳': 12, "אדר ב'": 13
  };
  for (const name of Object.keys(cases)) {
    eq(hdMonthNumber_(name), cases[name], name);
  }
  eq(hdMonthNumber_(7), 7, 'numeric month');
  eq(hdMonthNumber_('07'), 7, 'numeric string month');
  eq(hdMonthNumber_('פרח'), null, 'unknown month');
  eq(hdMonthNumber_(''), null, 'empty month');
});

check('Adar policy: plain Adar in a leap year means Adar II', () => {
  eq(hdResolveMonth_('אדר', 5784), 13, 'leap year -> Adar II');
  eq(hdResolveMonth_('אדר', 5785), 12, 'regular year -> Adar');
  eq(hdResolveMonth_('אדר א׳', 5784), 12, 'leap year -> Adar I');
  eq(hdResolveMonth_('אדר א׳', 5785), 12, 'regular year -> only Adar');
  eq(hdResolveMonth_('אדר ב׳', 5784), 13, 'leap year -> Adar II');
  eq(hdResolveMonth_('אדר ב׳', 5785), 12, 'regular year -> only Adar');
});

check('day 30 clamps to the last day of a short month', () => {
  // שנה שאין בה חשון מלא
  let shortYear = null;
  let longYear = null;
  for (let y = 5780; y <= 5790; y++) {
    if (hdMonthDays_(y, 8) === 29 && shortYear === null) shortYear = y;
    if (hdMonthDays_(y, 8) === 30 && longYear === null) longYear = y;
  }
  ok(shortYear && longYear, 'found short and long Cheshvan years');
  eq(hdClampDay_(shortYear, 8, 30), { day: 29, clamped: true, max: 29 });
  eq(hdClampDay_(longYear, 8, 30).clamped, false);
  eq(hdClampDay_(5785, hdResolveMonth_('אדר', 5785), 30).day, 29);
});

/* ------------------------- 4. פרשנות הגדרות ---------------------------- */

check('time parsing', () => {
  eq(normalizeTimeOfDay_('08:00'), { hours: 8, minutes: 0 });
  eq(normalizeTimeOfDay_('7:05'), { hours: 7, minutes: 5 });
  eq(normalizeTimeOfDay_('24:00'), null, 'invalid hour');
  eq(normalizeTimeOfDay_('08:60'), null, 'invalid minute');
  eq(normalizeTimeOfDay_(''), null);
  eq(normalizeTimeString_('8:5'), null);
  eq(normalizeTimeString_('08:30'), '08:30');
  eq(normalizeTimeOfDay_(new Date(2027, 0, 1, 9, 45)), { hours: 9, minutes: 45 }, 'Date cell');
});

check('extra days parsing', () => {
  eq(parseExtraDays_('0, 30, 30, abc, 400, 7'), [7, 30], 'filters, dedupes, sorts');
  eq(parseExtraDays_('30;60'), [30, 60]);
  eq(parseExtraDays_(45), [45]);
  eq(parseExtraDays_(''), []);
});

check('offsets union of flags and extra days', () => {
  const row = { sameDay: true, week: false, twoWeeks: true, extraDays: '0, 7, 30' };
  eq(reminderOffsets_(row), [0, 7, 14, 30]);
  eq(reminderOffsets_({}), []);
  eq(reminderLabel_(0), 'ביום האירוע');
  eq(reminderLabel_(7), 'שבוע לפני');
  eq(reminderLabel_(14), 'שבועיים לפני');
  eq(reminderLabel_(30), '30 ימים לפני');
});

check('until column parsing (0..365, empty vs invalid)', () => {
  eq(parseUntilDays_(49), 49);
  eq(parseUntilDays_('48'), 48);
  eq(parseUntilDays_(0), 0, '0 = only the event day');
  eq(parseUntilDays_(365), 365, 'at the cap');
  eq(parseUntilDays_(''), null, 'empty means no series');
  eq(parseUntilDays_(null), null);
  eq(parseUntilDays_(undefined), null);
  eq(parseUntilDays_(400), null, 'over the cap');
  eq(parseUntilDays_(12.5), null, 'not an integer');
  eq(parseUntilDays_('49 ימים'), null, 'free text is not a number');
});

check('until series merges with flags and extra days without duplicates', () => {
  const row = { sameDay: true, week: true, twoWeeks: false, extraDays: '60', untilDays: 3 };
  eq(reminderOffsets_(row), [0, 1, 2, 3, 7, 60], 'flags + extras + 0..3, union sorted');
  eq(reminderOffsets_(Object.assign({}, row, { untilDays: '' })), [0, 7, 60],
    'empty column changes nothing');
  eq(reminderOffsets_(Object.assign({}, row, { untilDays: 'abc' })), [0, 7, 60],
    'invalid column behaves as empty (validation reports it separately)');
});

/* --------------------------- 5. תזמון ותזכורות -------------------------- */

const sampleRow = {
  id: 'R2-test',
  topic: 'בדיקת מערכת',
  day: 15,
  month: 'כסלו',
  sameDay: true,
  week: true,
  twoWeeks: false,
  extraDays: '',
  timeRaw: '',
  recipientsRaw: '',
  active: true,
  notes: 'הערה לדוגמה'
};

check('candidate reminders are generated for two hebrew years', () => {
  const candidates = reminderCandidates_(sampleRow, settings, new Date(2027, 0, 1).getTime());
  ok(candidates.length >= 4, 'expected at least 4 candidates, got ' + candidates.length);
  const offsets = candidates.map(c => c.offset).sort((a, b) => a - b);
  eq(Array.from(new Set(offsets)), [0, 7], 'offsets present');
  for (const c of candidates) {
    eq(c.key, reminderKey_(sampleRow.id, c.hebrewYear, c.offset, c.eventAbs));
  }
  eq(reminderKey_('R2-test', 5787, 7, 739900), 'R2-test:5787:7:739900');
  eq(reminderKey_('R2-test', 5787, 7, 739900) === reminderKey_('R2-test', 5787, 7, 739901), false,
    'a different event date is a different reminder');
});

check('a reminder becomes due only inside the grace window', () => {
  const base = new Date(2027, 0, 1).getTime();
  const candidates = reminderCandidates_(sampleRow, settings, base);
  const week = candidates.filter(c => c.offset === 7 && c.sendAtMs > base)[0];
  ok(week, 'found a future week-before reminder');

  const justBefore = dueReminders_(sampleRow, settings, week.sendAtMs - 60000, {});
  eq(justBefore.length, 0, 'not due a minute early');

  const onTime = dueReminders_(sampleRow, settings, week.sendAtMs + 60000, {});
  eq(onTime.length, 1, 'due right after send time');
  eq(onTime[0].key, week.key);

  const withinGrace = dueReminders_(sampleRow, settings, week.sendAtMs + 11 * 3600000, {});
  eq(withinGrace.length, 1, 'still due 11h later');

  const tooLate = dueReminders_(sampleRow, settings, week.sendAtMs + 13 * 3600000, {});
  eq(tooLate.length, 0, 'missed after 13h with grace 12h');
});

check('sent keys suppress duplicates (idempotency)', () => {
  const base = new Date(2027, 0, 1).getTime();
  const candidates = reminderCandidates_(sampleRow, settings, base);
  const week = candidates.filter(c => c.offset === 7 && c.sendAtMs > base)[0];
  const sent = {};
  sent[week.key] = true;
  eq(dueReminders_(sampleRow, settings, week.sendAtMs + 60000, sent).length, 0);
});

check('same-day reminder goes out on the event date at the configured hour', () => {
  const base = new Date(2027, 0, 1).getTime();
  const candidates = reminderCandidates_(sampleRow, settings, base);
  const sameDay = candidates.filter(c => c.offset === 0 && c.sendAtMs > base)[0];
  ok(sameDay, 'found same-day candidate');
  const send = new Date(sameDay.sendAtMs);
  eq(formatReminderMoment_(sameDay).indexOf(' · ביום האירוע') > 0, true);
  const occurrence = hdAbsToGreg_(hdHebrewToAbs_(sameDay.hebrewYear, 9, 15));
  eq(sameDay.eventIso, occurrence.year + '-' +
    String(occurrence.month).padStart(2, '0') + '-' +
    String(occurrence.day).padStart(2, '0'), 'event iso');
  eq(send.getHours(), 8, 'default send hour');
  eq(hdAbsToHebrew_(hdGregToAbs_(send.getFullYear(), send.getMonth() + 1, send.getDate())).day, 15);
});

check('per-row time overrides the global send time', () => {
  const row = Object.assign({}, sampleRow, { timeRaw: '19:30' });
  const candidates = reminderCandidates_(row, settings, new Date(2027, 0, 1).getTime());
  const item = candidates.filter(c => c.offset === 0 && c.sendAtMs > new Date(2027, 0, 1).getTime())[0];
  const send = new Date(item.sendAtMs);
  eq([send.getHours(), send.getMinutes()], [19, 30]);
});

/* --------------------- 5b. סדרה יומית ("עד") ----------------------- */

const omerRow = Object.assign({}, sampleRow, {
  sameDay: false, week: false, twoWeeks: false, extraDays: '', untilDays: 48
});

check('until series: N=48 gives 49 daily reminders, one per calendar day', () => {
  const now = new Date(2027, 0, 1).getTime();
  const year = hdHebrewDateOf_(new Date(now)).year;
  const mine = reminderCandidates_(omerRow, settings, now).filter(c => c.hebrewYear === year);
  eq(mine.length, 49, 'N days before + the day itself');
  const byOffset = {};
  for (const c of mine) byOffset[c.offset] = c;
  eq(byOffset[48].dayNumber, 1, 'the farthest day is day 1');
  eq(byOffset[48].totalDays, 49);
  eq(byOffset[48].label, 'יומי · 1 מתוך 49');
  eq(byOffset[0].dayNumber, 49, 'the event day is the last day of the series');
  eq(byOffset[0].label, 'יומי · 49 מתוך 49');

  const dayAbs = c => {
    const d = new Date(c.sendAtMs);
    return hdGregToAbs_(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  const sorted = mine.slice().sort((a, b) => a.sendAtMs - b.sendAtMs);
  for (let i = 1; i < sorted.length; i++) {
    eq(dayAbs(sorted[i]) - dayAbs(sorted[i - 1]), 1, 'consecutive calendar days (DST-safe)');
  }
  eq(dayAbs(sorted[0]) + 48, dayAbs(sorted[sorted.length - 1]),
    'the series starts exactly 48 days before the event day');
  const keys = mine.map(c => c.key);
  eq(keys.length, new Set(keys).size, 'every day has its own key');
});

check('until series merges with checked flags: one email per day, series label wins', () => {
  const now = new Date(2027, 0, 1).getTime();
  const year = hdHebrewDateOf_(new Date(now)).year;
  const row = Object.assign({}, sampleRow, { untilDays: 20 }); // sameDay + week stay checked
  const mine = reminderCandidates_(row, settings, now).filter(c => c.hebrewYear === year);
  eq(mine.length, 21, 'offsets 0..20 once each');
  const seven = mine.filter(c => c.offset === 7);
  eq(seven.length, 1, 'offset 7 appears once even though "שבוע לפני" is checked');
  eq(seven[0].label, 'יומי · 14 מתוך 21', 'dayNumber = 20 - 7 + 1');
  const keys = mine.map(c => c.key);
  eq(keys.length, new Set(keys).size, 'no duplicate keys');
});

check('until series: the grace window applies per day', () => {
  const now = new Date(2027, 0, 1).getTime();
  const future = reminderCandidates_(omerRow, settings, now)
    .filter(c => c.sendAtMs > now)
    .sort((a, b) => a.sendAtMs - b.sendAtMs);
  ok(future.length > 0, 'has future candidates');
  const first = future[0];
  eq(dueReminders_(omerRow, settings, first.sendAtMs - 60000, {}).length, 0, 'not due a minute early');
  eq(dueReminders_(omerRow, settings, first.sendAtMs + 60000, {}).length, 1, 'due right after send time');
  eq(dueReminders_(omerRow, settings, first.sendAtMs + 13 * 3600000, {}).length, 0,
    'a day older than grace 12h is dropped, not caught up');
  const sent = {};
  sent[first.key] = true;
  eq(dueReminders_(omerRow, settings, first.sendAtMs + 60000, sent).length, 0,
    'the key prevents a resend');
});

check('until series: validation accepts a series-only row and reports bad values', () => {
  const seriesOnly = Object.assign({}, sampleRow, {
    sameDay: false, week: false, twoWeeks: false, extraDays: '', untilDays: 5
  });
  eq(validateReminderRow_(seriesOnly).ok, true, 'a series alone is a valid reminder');

  const tooBig = validateReminderRow_(Object.assign({}, seriesOnly, { untilDays: '400' }));
  eq(tooBig.ok, false, 'out of range fails');
  eq(tooBig.errors.some(e => e.indexOf('עד (ימים לפני)') >= 0), true, 'the error names the column');

  eq(validateReminderRow_(Object.assign({}, seriesOnly, { untilDays: 'abc' })).ok, false,
    'free text fails');
  eq(validateReminderRow_(Object.assign({}, seriesOnly, { untilDays: '' })).ok, false,
    'removing the series from a flagless row leaves nothing to send');
});

check('summer time: 08:00 in Israel is UTC+3 during DST', () => {
  const abs = hdGregToAbs_(2027, 3, 26); // ו׳ ניסן תשפ״ז — יום שישי, שעון קיץ
  const h = hdAbsToHebrew_(abs);
  const row = {
    id: 'dst', topic: 'שעון קיץ', day: h.day, month: h.month,
    sameDay: true, week: false, twoWeeks: false, extraDays: '', active: true
  };
  const item = reminderCandidates_(row, settings, new Date(2026, 0, 1).getTime())
    .filter(c => c.offset === 0 && c.hebrewYear === h.year)[0];
  ok(item, 'candidate exists');
  eq(item.sendAtMs, Date.UTC(2027, 2, 26, 5, 0), 'DST → UTC 05:00');
});

check('winter time: 08:00 in Israel is UTC+2', () => {
  const abs = hdGregToAbs_(2027, 1, 15);
  const h = hdAbsToHebrew_(abs);
  const row = {
    id: 'winter', topic: 'חורף', day: h.day, month: h.month,
    sameDay: true, week: false, twoWeeks: false, extraDays: '', active: true
  };
  const item = reminderCandidates_(row, settings, new Date(2026, 0, 1).getTime())
    .filter(c => c.offset === 0 && c.hebrewYear === h.year)[0];
  ok(item, 'candidate exists');
  eq(item.sendAtMs, Date.UTC(2027, 0, 15, 6, 0), 'winter → UTC 06:00');
});

check('nonexistent day 30 is clamped and flagged', () => {
  // שנה חסרה בחשון: 30 בחשון -> 29 בחשון
  const shortYear = [5780, 5781, 5782, 5783, 5784, 5785, 5786].filter(y => hdMonthDays_(y, 8) === 29)[0];
  ok(shortYear, 'found a year with 29-day Cheshvan');
  const row = {
    id: 'clamp', topic: 'ל׳ בחשון', day: 30, month: 'חשון',
    sameDay: true, week: false, twoWeeks: false, extraDays: '', active: true
  };
  const anchor = hdAbsToGreg_(hdHebrewToAbs_(shortYear, 8, 1));
  const candidates = reminderCandidates_(row, settings,
    new Date(anchor.year, anchor.month - 1, anchor.day).getTime());
  const one = candidates.filter(c => c.hebrewYear === shortYear)[0];
  ok(one, 'candidate for the year');
  eq(one.clamped, true);
  eq(hdAbsToHebrew_(one.eventAbs).day, 29);
});

check('next reminder is in the future', () => {
  const now = new Date(2027, 0, 1).getTime();
  const item = nextReminder_(sampleRow, settings, now, {});
  ok(item, 'has a next reminder');
  ok(item.sendAtMs >= now - 60000, 'not in the past');
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · /.test(formatReminderMoment_(item)), 'format');
});

/* ------------------------------ 6. ולידציה ------------------------------ */

check('validation catches broken rows', () => {
  eq(validateReminderRow_(Object.assign({}, sampleRow)).ok, true);
  eq(validateReminderRow_(Object.assign({}, sampleRow, { topic: '' })).ok, false);
  eq(validateReminderRow_(Object.assign({}, sampleRow, { month: 'פרח' })).ok, false);
  eq(validateReminderRow_(Object.assign({}, sampleRow, { day: 31 })).ok, false);
  eq(validateReminderRow_(Object.assign({}, sampleRow, { timeRaw: '25:00' })).ok, false);
  eq(validateReminderRow_(Object.assign({}, sampleRow, { active: false })).ok, false);
  eq(validateReminderRow_(Object.assign({}, sampleRow, {
    sameDay: false, week: false, twoWeeks: false, extraDays: ''
  })).ok, false);
});

/* -------------------------------- 7. מייל ------------------------------- */

check('email content', () => {
  const base = new Date(2027, 0, 1).getTime();
  const item = reminderCandidates_(sampleRow, settings, base)
    .filter(c => c.offset === 7 && c.sendAtMs > base)[0];
  const email = buildReminderEmail_(sampleRow, item, settings);
  ok(email.subject.indexOf('בדיקת מערכת') >= 0, 'subject has topic');
  ok(email.subject.indexOf('שבוע לפני') >= 0, 'subject has reminder label');
  ok(email.html.indexOf('<div dir="rtl"') === 0, 'html is RTL');
  ok(email.html.indexOf('בדיקת מערכת') > 0, 'html has topic');
  ok(email.plain.indexOf(item.eventIso) > 0, 'plain has gregorian date');
  ok(email.plain.indexOf(item.eventHebrewDate) > 0, 'plain has hebrew date');
  ok(email.plain.indexOf('הערה לדוגמה') > 0, 'plain has notes');
  ok(email.html.indexOf('&lt;script&gt;') < 0, 'no raw tags expected');
});

check('html escaping', () => {
  const row = Object.assign({}, sampleRow, { topic: '<b>שם</b> & "משהו"' });
  const base = new Date(2027, 0, 1).getTime();
  const item = reminderCandidates_(row, settings, base)[0];
  const email = buildReminderEmail_(row, item, settings);
  ok(email.html.indexOf('&lt;b&gt;') > 0, 'escaped');
  ok(email.html.indexOf('<b>שם</b>') < 0, 'no raw html injection');
});

check('until series email: counter plus the event date, plain and html', () => {
  const now = new Date(2027, 0, 1).getTime();
  const item = reminderCandidates_(omerRow, settings, now)
    .filter(c => c.offset === 3 && c.sendAtMs > now)[0];
  ok(item, 'candidate found');
  eq(item.dayNumber, 46, '48 - 3 + 1');
  eq(item.totalDays, 49);
  const email = buildReminderEmail_(omerRow, item, settings);
  ok(email.subject.indexOf('יומי · 46 מתוך 49') >= 0, 'subject carries the counter');
  ok(email.plain.indexOf('בסדרה: יום 46 מתוך 49') > 0, 'plain has the counter line');
  ok(email.html.indexOf('יום 46 מתוך 49') > 0, 'html has the counter');
  ok(email.plain.indexOf(item.eventIso) > 0, 'plain still has the event date');
  ok(email.html.indexOf(item.eventHebrewDate) > 0, 'html still has the hebrew event date');

  const normal = reminderCandidates_(sampleRow, settings, now)
    .filter(c => c.offset === 7 && c.sendAtMs > now)[0];
  const normalEmail = buildReminderEmail_(sampleRow, normal, settings);
  ok(normalEmail.plain.indexOf('בסדרה') < 0, 'a normal reminder has no counter line');
});

/* ------------------------ 8. שכבת הגיליון (mock) ----------------------- */

function fakeSheet(allValues) {
  return {
    getLastRow: () => allValues.length,
    getLastColumn: () => allValues[0].length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => allValues
        .slice(row - 1, row - 1 + numRows)
        .map(r => r.slice(col - 1, col - 1 + numCols))
    })
  };
}

check('Code.gs loads and exposes the documented entry points', () => {
  for (const name of ['setup', 'sendDueReminders', 'dryRunNow', 'installTrigger',
    'uninstallTriggers', 'onOpen', 'runCycle_']) {
    eq(typeof context[name], 'function', name);
  }
});

check('readReminderRows_ maps columns, skips blank rows and defaults active=true', () => {
  const headers = context.MAIN_HEADERS;
  eq(headers.length, 15, 'A-L inputs + M-N computed + O until');
  const rows = [
    headers,
    ['', 'יום הולדת', 15, 'כסלו', true, false, true, '30', '', '', '', '', '', '', 49],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['R2-x', 'אזכרה', 3, 'תשרי', true, true, false, '', new Date(2027, 0, 1, 19, 30),
      'a@b.co', false, 'הערה', '', '', '']
  ];
  const parsed = context.readReminderRows_(fakeSheet(rows));
  eq(parsed.length, 2, 'blank row skipped');
  eq(parsed[0].rowNumber, 2);
  eq(parsed[0].topic, 'יום הולדת');
  eq(parsed[0].active, true, 'empty active cell means active');
  eq(parsed[0].extraDays, '30');
  eq(parsed[0].untilDays, 49, 'until column mapped from O');
  eq(parsed[1].untilDays, '', 'missing cell reads as empty');
  eq(parsed[1].active, false);
  eq(parsed[1].notes, 'הערה');
  eq(context.validateReminderRow_(parsed[0]).ok, true, 'parsed row validates');
});

check('resolveRecipients_ merges row and default recipients without duplicates', () => {
  const row = { recipientsRaw: 'A@x.co, a@x.co; bad-address' };
  eq(context.resolveRecipients_(row, settings), ['A@x.co'], 'row list wins, deduped, invalid dropped');
  eq(context.resolveRecipients_({ recipientsRaw: '' }, settings), ['me@example.com'], 'falls back to settings');
  eq(context.resolveRecipients_({ recipientsRaw: '' }, { defaultRecipients: '' }), [], 'nothing configured');
});

/* -------------------------------- סיכום -------------------------------- */

const total = passed + failures.length;
if (failures.length) {
  console.error('\n' + failures.length + ' מתוך ' + total + ' בדיקות נכשלו:\n');
  for (const f of failures) {
    console.error(' ✗ ' + f.name + '\n   ' + f.message);
  }
  process.exit(1);
}
console.log('כל ' + total + ' הבדיקות עברו.');
