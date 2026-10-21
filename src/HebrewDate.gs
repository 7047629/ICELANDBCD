/**
 * HebrewDate.gs
 * ---------------------------------------------------------------------------
 * המרות תאריך עברי <-> לועזי, ללא תלות כלשהי בשירותי Google Apps Script.
 * לכן אפשר (ומומלץ) לבדוק את הקובץ הזה ב-Node (ראו tests/run-tests.js).
 *
 * מוסכמות:
 *  - "abs" = Rata Die, מספר שלם של ימים; 1970-01-01 = 719163.
 *  - חודשי השנה העברית: 1=ניסן ... 6=אלול, 7=תשרי ... 12=אדר א, 13=אדר ב.
 *    בשנה שאינה מעוברת יש 12 חודשים ו-12 הוא "אדר" הרגיל.
 *  - כל הפונקציות בעלות סיומת "_" הן פרטיות לפרויקט.
 */

/** Rata Die של א׳ תשרי, שנה א׳. */
var HD_HEBREW_EPOCH = -1373428;

/** ההפרש בין JDN (צהרי יום) ל- Rata Die. */
var HD_GREG_JDN_OFFSET = 1721425;

var HD_MONTH_NISAN = 1;
var HD_MONTH_TISHREI = 7;
var HD_MONTH_ADAR = 12;
var HD_MONTH_ADAR_II = 13;

/** שמות חודשים (מנורמלים) -> מספר חודש. */
var HD_MONTH_NAMES = {
  'ניסן': 1,
  'אייר': 2,
  'איר': 2,
  'סיון': 3,
  'סיוון': 3,
  'תמוז': 4,
  'אב': 5,
  'אלול': 6,
  'תשרי': 7,
  'חשון': 8,
  'חשוון': 8,
  'מרחשון': 8,
  'מרחשוון': 8,
  'כסלו': 9,
  'כסליו': 9,
  'טבת': 10,
  'שבט': 11,
  'אדר': 12,
  'אדר א': 12,
  'אדר ב': 13
};

/** שמות לתצוגה, לפי מספר חודש ולוח השנה של אותה שנה. */
var HD_MONTH_DISPLAY = {
  1: 'ניסן',
  2: 'אייר',
  3: 'סיון',
  4: 'תמוז',
  5: 'אב',
  6: 'אלול',
  7: 'תשרי',
  8: 'חשון',
  9: 'כסלו',
  10: 'טבת',
  11: 'שבט',
  12: 'אדר',
  13: 'אדר ב'
};

/**
 * האם שנת HebrewYear מעוברת (19 שנים, 7 מעוברות).
 */
function hdIsLeapYear_(hebrewYear) {
  return ((hebrewYear * 7) + 1) % 19 < 7;
}

/** מספר החודשים בשנה העברית (12 או 13). */
function hdMonthsInYear_(hebrewYear) {
  return hdIsLeapYear_(hebrewYear) ? 13 : 12;
}

/**
 * מספר הימים שמתחילת המניין עד מולד תשרי של השנה, כולל דחיות
 * (לא אד"ו ראש, לא אד"ו תחת, ג"ט ר"ד ובד"ו). אותו אלגוריתם כמו
 * בספרות הקלנדרית היהודית; אי אפשר לפשט אותו בלי לסטות ביום-יומיים.
 */
function hdElapsedDays_(hebrewYear) {
  var prevYear = hebrewYear - 1;
  var monthsElapsed =
    235 * Math.floor(prevYear / 19) +
    12 * (prevYear % 19) +
    Math.floor(((prevYear % 19) * 7 + 1) / 19);
  var partsElapsed = 204 + 793 * (monthsElapsed % 1080);
  var hoursElapsed = 5 + 12 * monthsElapsed +
    793 * Math.floor(monthsElapsed / 1080) +
    Math.floor(partsElapsed / 1080);
  var parts = (partsElapsed % 1080) + 1080 * (hoursElapsed % 24);
  var day = 1 + 29 * monthsElapsed + Math.floor(hoursElapsed / 24);
  var altDay = day;
  if (parts >= 19440 ||
      (day % 7 === 2 && parts >= 9924 && !hdIsLeapYear_(hebrewYear)) ||
      (day % 7 === 1 && parts >= 16789 && hdIsLeapYear_(prevYear))) {
    altDay++;
  }
  var weekday = altDay % 7;
  if (weekday === 0 || weekday === 3 || weekday === 5) {
    return altDay + 1;
  }
  return altDay;
}

/** אורך השנה בימים (353/354/355 או 383/384/385). */
function hdDaysInYear_(hebrewYear) {
  return hdElapsedDays_(hebrewYear + 1) - hdElapsedDays_(hebrewYear);
}

/** חשון מלא (30 יום) — קורה בשנים שאורכן מסתיים ב-5. */
function hdLongCheshvan_(hebrewYear) {
  return hdDaysInYear_(hebrewYear) % 10 === 5;
}

/** כסלו חסר (29 יום) — קורה בשנים שאורכן מסתיים ב-3. */
function hdShortKislev_(hebrewYear) {
  return hdDaysInYear_(hebrewYear) % 10 === 3;
}

/** מספר הימים בחודש עברי נתון באותה שנה. */
function hdMonthDays_(hebrewYear, month) {
  switch (month) {
    case 2:   // אייר
    case 4:   // תמוז
    case 6:   // אלול
    case 10:  // טבת
    case 13:  // אדר ב
      return 29;
    case HD_MONTH_ADAR:
      return hdIsLeapYear_(hebrewYear) ? 30 : 29;
    case 8:   // חשון
      return hdLongCheshvan_(hebrewYear) ? 30 : 29;
    case 9:   // כסלו
      return hdShortKislev_(hebrewYear) ? 29 : 30;
    default:
      return 30;
  }
}

/**
 * תאריך עברי -> abs (Rata Die).
 */
function hdHebrewToAbs_(hebrewYear, month, day) {
  var total = day;
  var m;
  if (month < HD_MONTH_TISHREI) {
    for (m = HD_MONTH_TISHREI; m <= hdMonthsInYear_(hebrewYear); m++) {
      total += hdMonthDays_(hebrewYear, m);
    }
    for (m = HD_MONTH_NISAN; m < month; m++) {
      total += hdMonthDays_(hebrewYear, m);
    }
  } else {
    for (m = HD_MONTH_TISHREI; m < month; m++) {
      total += hdMonthDays_(hebrewYear, m);
    }
  }
  return total + hdElapsedDays_(hebrewYear) + HD_HEBREW_EPOCH - 1;
}

/**
 * תאריך לועזי -> abs. החודש 1-12.
 */
function hdGregToAbs_(year, month, day) {
  var a = Math.floor((14 - month) / 12);
  var y = year + 4800 - a;
  var m = month + 12 * a - 3;
  var jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y +
            Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  return jdn - HD_GREG_JDN_OFFSET;
}

/**
 * abs -> תאריך לועזי {year, month, day}.
 */
function hdAbsToGreg_(abs) {
  var jdn = Math.trunc(abs) + HD_GREG_JDN_OFFSET;
  var a = jdn + 32044;
  var b = Math.floor((4 * a + 3) / 146097);
  var c = a - Math.floor((146097 * b) / 4);
  var d = Math.floor((4 * c + 3) / 1461);
  var e = c - Math.floor((1461 * d) / 4);
  var m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1
  };
}

/**
 * abs -> תאריך עברי {year, month, day}.
 */
function hdAbsToHebrew_(abs) {
  abs = Math.trunc(abs);
  // הערכה גסה, ואז תיקון לשני הכיוונים (השנה מתחילה בא׳ תשרי).
  var year = Math.floor((abs - HD_HEBREW_EPOCH) / 365.2468222);
  while (hdHebrewToAbs_(year, HD_MONTH_TISHREI, 1) <= abs) {
    year++;
  }
  year--;
  var month = abs < hdHebrewToAbs_(year, HD_MONTH_NISAN, 1) ? HD_MONTH_TISHREI : HD_MONTH_NISAN;
  while (abs > hdHebrewToAbs_(year, month, hdMonthDays_(year, month))) {
    month++;
  }
  return {
    year: year,
    month: month,
    day: 1 + abs - hdHebrewToAbs_(year, month, 1)
  };
}

/**
 * היום/חודש/שנה העבריים של רגע נתון (לפי אזור הזמן של הסקריפט).
 */
function hdHebrewDateOf_(date) {
  var abs = hdGregToAbs_(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return hdAbsToHebrew_(abs);
}

/**
 * מנרמל שם חודש: מסיר גרש/גרשיים, נקודות ומירכאות, ומצמצם רווחים.
 */
function hdNormalizeMonthName_(value) {
  return String(value == null ? '' : value)
    .replace(/[\u05F3\u05F4'`"\u2018\u2019\u201C\u201D.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * שם/מספר חודש -> המספר הקנוני (1-13), או null אם לא זוהה.
 * "אדר" נשאר 12; ההכרעה בין אדר א׳ לאדר ב׳ נעשית לפי השנה ב- hdResolveMonth_.
 */
function hdMonthNumber_(value) {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'number' && value >= 1 && value <= 13) {
    return Math.round(value);
  }
  var text = hdNormalizeMonthName_(value);
  if (!text) {
    return null;
  }
  if (/^\d{1,2}$/.test(text)) {
    var numeric = parseInt(text, 10);
    return numeric >= 1 && numeric <= 13 ? numeric : null;
  }
  var mapped = HD_MONTH_NAMES[text];
  return typeof mapped === 'number' ? mapped : null;
}

/**
 * האם הכיתוב מתייחס במפורש לאדר א׳ / אדר ב׳ / אדר סתמי.
 * מחזיר 'first' | 'second' | 'plain'.
 */
function hdAdarVariant_(value) {
  var text = hdNormalizeMonthName_(value);
  if (/^אדר\s*א$/.test(text)) {
    return 'first';
  }
  if (/^אדר\s*ב$/.test(text)) {
    return 'second';
  }
  return 'plain';
}

/**
 * ממיר חודש (שם או מספר) לחודש בפועל בשנת HebrewYear, כולל מדיניות אדר:
 *  - "אדר"   בשנה מעוברת -> אדר ב׳ (13)  [מנהג אזכרות/ימי הולדת]
 *  - "אדר"   בשנה רגילה  -> אדר (12)
 *  - "אדר א" בשנה מעוברת -> אדר א׳ (12)
 *  - "אדר א" בשנה רגילה  -> אדר (12)   [אין אדר א׳, משתמשים באדר היחיד]
 *  - "אדר ב" בשנה מעוברת -> אדר ב׳ (13)
 *  - "אדר ב" בשנה רגילה  -> אדר (12)
 *  - המספר 13          -> כמו "אדר ב"
 * מחזיר null אם החודש לא זוהה.
 */
function hdResolveMonth_(value, hebrewYear) {
  var month = hdMonthNumber_(value);
  if (month === null) {
    return null;
  }
  var leap = hdIsLeapYear_(hebrewYear);
  if (month === HD_MONTH_ADAR) {
    var variant = hdAdarVariant_(value);
    if (variant === 'first') {
      return HD_MONTH_ADAR; // 12 — קיים בשני סוגי השנים
    }
    if (variant === 'second') {
      return leap ? HD_MONTH_ADAR_II : HD_MONTH_ADAR;
    }
    return leap ? HD_MONTH_ADAR_II : HD_MONTH_ADAR;
  }
  if (month === HD_MONTH_ADAR_II) {
    return leap ? HD_MONTH_ADAR_II : HD_MONTH_ADAR;
  }
  return month;
}

/**
 * מגביל יום לחודש בפועל (למשל 30 בחשון בשנה חסרה -> 29).
 * מחזיר {day, clamped}.
 */
function hdClampDay_(hebrewYear, month, day) {
  var max = hdMonthDays_(hebrewYear, month);
  var wanted = Math.round(day);
  if (wanted > max) {
    return { day: max, clamped: true, max: max };
  }
  if (wanted < 1) {
    return { day: 1, clamped: true, max: max };
  }
  return { day: wanted, clamped: false, max: max };
}

/**
 * שם חודש לתצוגה, בהתאם ללוח השנה של השנה.
 */
function hdMonthDisplayName_(hebrewYear, month) {
  if (month === HD_MONTH_ADAR) {
    return hdIsLeapYear_(hebrewYear) ? 'אדר א' : 'אדר';
  }
  return HD_MONTH_DISPLAY[month] || String(month);
}

/* ------------------------------- גימטריה -------------------------------- */

var HD_GEMATRIA_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
var HD_GEMATRIA_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
var HD_GEMATRIA_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/**
 * מספר (1-999) באותיות עבריות, כולל ט״ו/ט״ז במקום יה/יו.
 */
function hdGematria_(number) {
  var n = Math.round(number);
  if (n <= 0 || n > 999) {
    return String(number);
  }
  if (n === 15) {
    return 'טו';
  }
  if (n === 16) {
    return 'טז';
  }
  var out = '';
  var hundreds = Math.floor(n / 100);
  while (hundreds > 4) {
    out += 'ת';
    hundreds -= 4;
  }
  out += HD_GEMATRIA_HUNDREDS[hundreds];
  var rest = n % 100;
  if (rest === 15) {
    out += 'טו';
    rest = 0;
  } else if (rest === 16) {
    out += 'טז';
    rest = 0;
  }
  out += HD_GEMATRIA_TENS[Math.floor(rest / 10)];
  out += HD_GEMATRIA_ONES[rest % 10];
  return out;
}

/**
 * מוסיף גרש (אות אחת) או גרשיים (שתיים ומעלה).
 */
function hdPunctuateGematria_(letters) {
  if (!letters) {
    return '';
  }
  if (letters.length === 1) {
    return letters + '\u05F3';
  }
  return letters.slice(0, -1) + '\u05F4' + letters.slice(-1);
}

/** שנה עברית באותיות: 5787 -> תשפ״ז (בלי האלף). */
function hdFormatHebrewYear_(hebrewYear) {
  return hdPunctuateGematria_(hdGematria_(hebrewYear % 1000));
}

/** יום בחודש באותיות: 15 -> ט״ו. */
function hdFormatHebrewDay_(day) {
  return hdPunctuateGematria_(hdGematria_(day));
}

/**
 * תאריך עברי קריא: "ט״ו כסלו תשפ״ז".
 */
function hdFormatHebrewDate_(hebrewYear, month, day) {
  return hdFormatHebrewDay_(day) + ' ' +
         hdMonthDisplayName_(hebrewYear, month) + ' ' +
         hdFormatHebrewYear_(hebrewYear);
}

/** תאריך עברי קריא מתוך abs. */
function hdFormatHebrewAbs_(abs) {
  var hd = hdAbsToHebrew_(abs);
  return hdFormatHebrewDate_(hd.year, hd.month, hd.day);
}

/** תאריך לועזי בפורמט ISO (yyyy-mm-dd). */
function hdFormatIso_(yearOrAbs, month, day) {
  var parts;
  if (month === undefined) {
    parts = hdAbsToGreg_(yearOrAbs);
  } else {
    parts = { year: yearOrAbs, month: month, day: day };
  }
  var mm = parts.month < 10 ? '0' + parts.month : String(parts.month);
  var dd = parts.day < 10 ? '0' + parts.day : String(parts.day);
  return parts.year + '-' + mm + '-' + dd;
}

/** יום בשבוע של abs: 0=ראשון ... 6=שבת. */
function hdWeekdayOfAbs_(abs) {
  // 1970-01-01 (abs 719163) היה יום חמישי (4).
  var diff = Math.trunc(abs) - 719163;
  return ((diff % 7) + 7 + 4) % 7;
}
