// Meetsko — toistuvien tapahtumien sääntölogiikka.
// Puhdasta logiikkaa ilman DOM-riippuvuuksia, jotta sama koodi voidaan
// myöhemmin ajaa myös palvelimella (vrt. slot-finding-periaate CLAUDE.md:ssä).
//
// Sääntö (rule):
//   freq:    'daily' (arkipäivät ma–pe) | 'weekly' | 'monthly' | 'yearly'
//   weekday: 0–6, ma = 0 … su = 6         (weekly, monthly, yearly)
//   nth:     1–4 = kuukauden n:s viikonpäivä, 5 = viimeinen (monthly, yearly)
//   month:   1–12                           (yearly)

const RECURRENCE_MAX_OCCURRENCES = 52;

const RECURRENCE_TIME_WINDOWS = {
  morning: { start: 8, end: 11 },
  midday: { start: 11, end: 14 },
  afternoon: { start: 14, end: 17 },
};

// Aikahaun päivärajat — samat kuin findAvailableSlotsissa.
const RECURRENCE_DAY_START_HOUR = 8;
const RECURRENCE_DAY_END_HOUR = 18;
const RECURRENCE_STEP_MS = 15 * 60000;
const DAY_MS = 24 * 60 * 60 * 1000;

function recWeekdayOf(date) {
  return (date.getDay() + 6) % 7;
}

function recIsWeekend(date) {
  return recWeekdayOf(date) >= 5;
}

function recStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function recAddDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// Kuukauden n:s viikonpäivä; nth = 5 tarkoittaa viimeistä.
function recNthWeekdayOfMonth(year, monthIdx, weekday, nth) {
  if (nth === 5) {
    const last = new Date(year, monthIdx + 1, 0);
    return recAddDays(last, -((recWeekdayOf(last) - weekday + 7) % 7));
  }
  const first = new Date(year, monthIdx, 1);
  return recAddDays(first, ((weekday - recWeekdayOf(first) + 7) % 7) + (nth - 1) * 7);
}

function recMatchesRule(date, rule) {
  const wd = recWeekdayOf(date);
  if (rule.freq === 'daily') return wd <= 4;
  if (wd !== rule.weekday) return false;
  if (rule.freq === 'weekly') return true;
  if (rule.freq === 'yearly' && date.getMonth() !== rule.month - 1) return false;
  const nthDate = recNthWeekdayOfMonth(date.getFullYear(), date.getMonth(), rule.weekday, rule.nth);
  return nthDate.getDate() === date.getDate();
}

// Seuraava säännön mukainen päivä alkaen fromDate (mukaan lukien).
function recNextMatchingDate(rule, fromDate) {
  let d = recStartOfDay(fromDate);
  if (rule.freq === 'daily' || rule.freq === 'weekly') {
    for (let i = 0; i < 8; i++, d = recAddDays(d, 1)) {
      if (recMatchesRule(d, rule)) return d;
    }
    return null;
  }
  // monthly / yearly: käydään kuukausia läpi.
  for (let i = 0; i < 26; i++) {
    const y = d.getFullYear() + Math.floor((d.getMonth() + i) / 12);
    const m = (d.getMonth() + i) % 12;
    if (rule.freq === 'yearly' && m !== rule.month - 1) continue;
    const candidate = recNthWeekdayOfMonth(y, m, rule.weekday, rule.nth);
    if (candidate >= d) return candidate;
  }
  return null;
}

// Säännön mukaiset päivät alkaen firstDate (mukaan lukien). Päättyy joko
// kertojen määrään (count) tai päivämäärään (endDate, mukaan lukien).
// Palauttaa korkeintaan yhden ylärajaa enemmän, jotta kutsuja voi havaita
// ylärajan ylityksen.
function recOccurrenceDates(rule, firstDate, { count, endDate }) {
  const limit = Math.min(count || RECURRENCE_MAX_OCCURRENCES + 1, RECURRENCE_MAX_OCCURRENCES + 1);
  const end = endDate ? recStartOfDay(endDate) : null;
  const dates = [];
  let d = recNextMatchingDate(rule, firstDate);
  while (d && dates.length < limit && (!end || d <= end)) {
    dates.push(d);
    d = recNextMatchingDate(rule, recAddDays(d, 1));
  }
  return dates;
}

// Ensimmäisen kerran valinta määrittää standardin: viikonpäivä, kuukauden
// n:s viikonpäivä ja kuukausi johdetaan valitusta päivästä.
function recDeriveRuleFromDate(rule, date) {
  const derived = { ...rule };
  if (rule.freq === 'daily') return derived;
  derived.weekday = recWeekdayOf(date);
  if (rule.freq === 'monthly' || rule.freq === 'yearly') {
    derived.nth = Math.ceil(date.getDate() / 7); // 5 = viimeinen
  }
  if (rule.freq === 'yearly') derived.month = date.getMonth() + 1;
  return derived;
}

function recOverlaps(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

function recConflictsRequired(startMs, endMs, requiredBusy) {
  return requiredBusy.some((b) => recOverlaps(startMs, endMs, b.startMs, b.endMs));
}

function recOptionalConflictCount(startMs, endMs, optionalBusyLists) {
  return optionalBusyLists.filter((list) => list.some((b) => recOverlaps(startMs, endMs, b.startMs, b.endMs))).length;
}

// Tila yksittäiselle kerralle annetulla ajalla:
//   'free'     — pakolliset osallistujat vapaina (sääntöajalla)
//   'moved'    — vapaa, mutta siirretty sääntöajasta
//   'conflict' — pakollisella osallistujalla päällekkäisyys
//   'nodata'   — kalenteritietoa ei ole (yli 3 kk päässä)
function recOccurrenceStatus(startMs, endMs, targetStartMs, ctx) {
  if (endMs > ctx.horizonMs) return 'nodata';
  if (recConflictsRequired(startMs, endMs, ctx.requiredBusy)) return 'conflict';
  return startMs === targetStartMs ? 'free' : 'moved';
}

// Sallitut päivät älykkäälle haulle sääntöpäivän ympärillä:
// päivittäinen ja viikoittainen samana päivänä, kuukausittainen ja
// vuosittainen ±3 päivää (vain arkipäivät).
function recSearchDays(freq, date) {
  if (freq === 'daily' || freq === 'weekly') return [date];
  const days = [];
  for (let i = -3; i <= 3; i++) {
    const d = recAddDays(date, i);
    if (!recIsWeekend(d)) days.push(d);
  }
  return days;
}

// Rakentaa sarjan kerrat. Ensimmäinen kerta on käyttäjän valitsema aika;
// sen kellonaika ja kesto ovat standardi tuleville kerroille.
//
// ctx: { requiredBusy, optionalBusyLists, horizonMs, nowMs }
// smart = false → kaikki kerrat standardiajalla.
// smart = true  → varatulle kerralle haetaan lähin vapaa aika sallituilta
//                 päiviltä; jos ei löydy, pidetään alkuperäinen aika.
function recBuildOccurrences({ rule, firstStartMs, durationMs, count, endDate, smart }, ctx) {
  const first = new Date(firstStartMs);
  const standardMinutes = first.getHours() * 60 + first.getMinutes();
  const dates = recOccurrenceDates(rule, first, { count, endDate });

  const occurrences = [];
  let prevEndMs = 0;

  dates.forEach((date, idx) => {
    const target = new Date(date);
    target.setMinutes(standardMinutes);
    const targetStartMs = idx === 0 ? firstStartMs : target.getTime();
    let startMs = targetStartMs;

    const canOptimize = smart && idx > 0 && targetStartMs + durationMs <= ctx.horizonMs;
    if (canOptimize && recConflictsRequired(startMs, startMs + durationMs, ctx.requiredBusy)) {
      const found = recFindNearestFree(targetStartMs, durationMs, recSearchDays(rule.freq, date), prevEndMs, ctx);
      if (found !== null) startMs = found;
    }

    occurrences.push({
      startMs,
      endMs: startMs + durationMs,
      targetStartMs,
      status: recOccurrenceStatus(startMs, startMs + durationMs, targetStartMs, ctx),
    });
    prevEndMs = startMs + durationMs;
  });

  return occurrences;
}

// Lähin vapaa aloitusaika tavoiteajasta; tasapelissä vähemmän
// valinnaisten osallistujien päällekkäisyyksiä, sitten aikaisempi.
function recFindNearestFree(targetStartMs, durationMs, days, notBeforeMs, ctx) {
  let best = null;
  days.forEach((day) => {
    for (let min = RECURRENCE_DAY_START_HOUR * 60; min + durationMs / 60000 <= RECURRENCE_DAY_END_HOUR * 60; min += RECURRENCE_STEP_MS / 60000) {
      const s = new Date(day);
      s.setMinutes(min);
      const startMs = s.getTime();
      const endMs = startMs + durationMs;
      if (startMs < notBeforeMs || startMs < ctx.nowMs || endMs > ctx.horizonMs) continue;
      if (recConflictsRequired(startMs, endMs, ctx.requiredBusy)) continue;
      const cand = {
        startMs,
        distance: Math.abs(startMs - targetStartMs),
        optional: recOptionalConflictCount(startMs, endMs, ctx.optionalBusyLists),
      };
      if (!best
        || cand.distance < best.distance
        || (cand.distance === best.distance && cand.optional < best.optional)
        || (cand.distance === best.distance && cand.optional === best.optional && cand.startMs < best.startMs)) {
        best = cand;
      }
    }
  });
  return best ? best.startMs : null;
}
