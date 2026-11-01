// Aikavyöhykkeet (IANA-nimet, esim. Europe/Helsinki). Sama logiikka palvelimella
// tiedostossa supabase/functions/_shared/timezone.ts — pidä nämä yhdenmukaisina.
// Ei DOM-riippuvuuksia.
//
// Näkyvyysrajausten ajat tulkitaan käyttäjän valitsemassa aikavyöhykkeessä
// (user_profiles.time_zone). Rajoitusjaksot tallennetaan oikeina ajanhetkinä (UTC).

const MeetskoTZ = (() => {
  const DEFAULT = 'Europe/Helsinki';
  const formatters = new Map();

  function formatterFor(tz) {
    let f = formatters.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      formatters.set(tz, f);
    }
    return f;
  }

  function isValid(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  function browserZone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return isValid(tz) ? tz : DEFAULT;
    } catch (e) { return DEFAULT; }
  }

  function zonedParts(ms, tz) {
    const parts = formatterFor(tz).formatToParts(new Date(ms));
    const get = (type) => Number((parts.find((p) => p.type === type) || {}).value);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
  }

  function offsetMs(ms, tz) {
    const p = zonedParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }

  // 'YYYY-MM-DDTHH:MM' aikavyöhykkeessä tz → ISO-ajanhetki (UTC).
  function localInputToIso(value, tz) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
    if (!m) return null;
    return new Date(wallToMs(tz, +m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0)).toISOString();
  }

  // ISO-ajanhetki → 'YYYY-MM-DDTHH:MM' aikavyöhykkeessä tz (datetime-local-kenttään).
  function isoToLocalInput(iso, tz) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return '';
    const p = zonedParts(ms, tz);
    const pad = (n) => String(n).padStart(2, '0');
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  }

  // Esim. "Europe/Helsinki (UTC+2)" — siirtymä nykyhetkellä.
  function label(tz) {
    const off = Math.round(offsetMs(Date.now(), tz) / 60000);
    const sign = off >= 0 ? '+' : '−';
    const h = Math.floor(Math.abs(off) / 60);
    const m = Math.abs(off) % 60;
    return `${tz.replace(/_/g, ' ')} (UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''})`;
  }

  function list() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
    return zones.length ? zones : [DEFAULT, 'UTC'];
  }

  // <option>-lista valitulla arvolla; valittu lisätään, vaikka selain ei sitä listaisi.
  function optionsHtml(selected) {
    const zones = list();
    if (selected && !zones.includes(selected)) zones.unshift(selected);
    return zones.map((tz) => `<option value="${tz}" ${tz === selected ? 'selected' : ''}>${label(tz)}</option>`).join('');
  }

  // --- Näyttöaikavyöhyke (vaihe 2) -------------------------------------------------
  // Projektisivu näyttää ajat käyttäjän valitsemassa aikavyöhykkeessä (profiili), ei
  // selaimen. zdate(...) toimii kuten new Date(...), mutta paikalliset getterit ja setterit
  // (getHours, setDate …) sekä toLocale*-muotoilut toimivat näyttöaikavyöhykkeessä.
  // Ajanhetki (getTime/valueOf) on aina sama kuin vastaavalla Datella.

  let viewZone = browserZone();
  function setViewZone(tz) { if (isValid(tz)) viewZone = tz; }
  function getViewZone() { return viewZone; }

  // Siirtymä välimuistissa 15 minuutin jaksoittain: kesä-/talviaika vaihtuu tasavartein.
  const offsetCache = new Map();
  function cachedOffset(ms, tz) {
    const key = tz + '|' + Math.floor(ms / 900000);
    let off = offsetCache.get(key);
    if (off === undefined) {
      off = offsetMs(Math.floor(ms / 900000) * 900000, tz);
      if (offsetCache.size > 50000) offsetCache.clear();
      offsetCache.set(key, off);
    }
    return off;
  }

  // Seinäkelloaika (vuosi, kk 0–11, pv, h, min, s, ms; ylivuoto sallittu kuten Datessa) → ms.
  // Kesä-/talviajan vaihteessa kuten Date: kahdesti esiintyvästä ajasta aikaisempi hetki,
  // puuttuvasta ajasta (kevään siirtymä) siirrytään eteenpäin.
  function wallToMs(tz, y, mo, d, h, mi, s, msPart) {
    const guess = Date.UTC(y, mo, d, h, mi, s, msPart);
    const offBefore = cachedOffset(guess - 43200000, tz);
    const offAfter = cachedOffset(guess + 43200000, tz);
    const a = guess - offBefore;
    const b = guess - offAfter;
    const aOk = cachedOffset(a, tz) === offBefore;
    const bOk = cachedOffset(b, tz) === offAfter;
    if (aOk && bOk) return Math.min(a, b);
    if (aOk) return a;
    if (bOk) return b;
    return a;
  }

  class ZDate {
    constructor(ms, tz) { this._ms = ms; this._tz = tz; }
    _p() {
      const d = new Date(this._ms + cachedOffset(this._ms, this._tz));
      return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(), wd: d.getUTCDay() };
    }
    _set(p) { this._ms = wallToMs(this._tz, p.y, p.mo, p.d, p.h, p.mi, p.s, p.ms); return this._ms; }
    getTime() { return this._ms; }
    valueOf() { return this._ms; }
    toISOString() { return new Date(this._ms).toISOString(); }
    toJSON() { return this.toISOString(); }
    getFullYear() { return this._p().y; }
    getMonth() { return this._p().mo; }
    getDate() { return this._p().d; }
    getDay() { return this._p().wd; }
    getHours() { return this._p().h; }
    getMinutes() { return this._p().mi; }
    getSeconds() { return this._p().s; }
    getMilliseconds() { return this._p().ms; }
    setFullYear(y, mo, d) { const p = this._p(); p.y = y; if (mo !== undefined) p.mo = mo; if (d !== undefined) p.d = d; return this._set(p); }
    setMonth(mo, d) { const p = this._p(); p.mo = mo; if (d !== undefined) p.d = d; return this._set(p); }
    setDate(d) { const p = this._p(); p.d = d; return this._set(p); }
    setHours(h, mi, s, ms) { const p = this._p(); p.h = h; if (mi !== undefined) p.mi = mi; if (s !== undefined) p.s = s; if (ms !== undefined) p.ms = ms; return this._set(p); }
    setMinutes(mi, s, ms) { const p = this._p(); p.mi = mi; if (s !== undefined) p.s = s; if (ms !== undefined) p.ms = ms; return this._set(p); }
    setSeconds(s, ms) { const p = this._p(); p.s = s; if (ms !== undefined) p.ms = ms; return this._set(p); }
    setMilliseconds(ms) { const p = this._p(); p.ms = ms; return this._set(p); }
    setTime(ms) { this._ms = ms; return ms; }
    toLocaleDateString(loc, opts) { return new Date(this._ms).toLocaleDateString(loc, { ...(opts || {}), timeZone: this._tz }); }
    toLocaleTimeString(loc, opts) { return new Date(this._ms).toLocaleTimeString(loc, { ...(opts || {}), timeZone: this._tz }); }
    toLocaleString(loc, opts) { return new Date(this._ms).toLocaleString(loc, { ...(opts || {}), timeZone: this._tz }); }
  }

  // Kuten new Date(...): ei argumentteja = nyt; luku = ms; päivämäärä-olio = sama hetki;
  // merkkijono ilman aikavyöhykettä ('YYYY-MM-DD' tai 'YYYY-MM-DDTHH:MM[:SS]') =
  // seinäkelloaika näyttöaikavyöhykkeessä; muut merkkijonot (Z tai +02:00) = ajanhetki;
  // useampi luku = seinäkelloaika (vuosi, kk 0–11, …) näyttöaikavyöhykkeessä.
  function zdate(...args) {
    const tz = viewZone;
    if (args.length === 0) return new ZDate(Date.now(), tz);
    if (args.length === 1) {
      const a = args[0];
      if (typeof a === 'number') return new ZDate(a, tz);
      if (a instanceof ZDate || a instanceof Date) return new ZDate(a.valueOf(), tz);
      if (typeof a === 'string') {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(a);
        if (m) return new ZDate(wallToMs(tz, +m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || '0').padEnd(3, '0'))), tz);
        return new ZDate(Date.parse(a), tz);
      }
      return new ZDate(new Date(a).getTime(), tz);
    }
    const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = args;
    return new ZDate(wallToMs(tz, y, mo, d, h, mi, s, ms), tz);
  }

  // Viikoittaiset piilotusajat aikavyöhykkeestä toiseen: rows = [{ weekday (0 = ma), startMin,
  // endMin (≤ 1440) }]. Muunnos tehdään kuluvan viikon mukaan, joten kesä-/talviajan ero
  // aikavyöhykkeiden välillä näkyy sen hetkisenä. Keskiyön ylittävä aika jaetaan kahdelle
  // päivälle; samaan päivään osuvat päällekkäiset tai vierekkäiset ajat yhdistetään.
  function convertWeeklyWindows(rows, fromTz, toTz, refMs = Date.now()) {
    if (!rows || rows.length === 0) return [];
    if (fromTz === toTz) return rows.map((r) => ({ ...r }));
    const off = cachedOffset(refMs, fromTz);
    const ref = new Date(refMs + off);
    const mondayY = ref.getUTCFullYear(), mondayM = ref.getUTCMonth();
    const mondayD = ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7);
    const out = [];
    for (const r of rows) {
      let cur = wallToMs(fromTz, mondayY, mondayM, mondayD + r.weekday, 0, r.startMin, 0, 0);
      const endMs = wallToMs(fromTz, mondayY, mondayM, mondayD + r.weekday, 0, r.endMin, 0, 0);
      while (cur < endMs) {
        const local = new Date(cur + cachedOffset(cur, toTz));
        const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
        const nextMidnight = wallToMs(toTz, y, m, d + 1, 0, 0, 0, 0);
        const segEnd = Math.min(endMs, nextMidnight);
        const startMin = local.getUTCHours() * 60 + local.getUTCMinutes();
        let endMin = 1440;
        if (segEnd !== nextMidnight) {
          const e = new Date(segEnd + cachedOffset(segEnd, toTz));
          endMin = e.getUTCHours() * 60 + e.getUTCMinutes();
        }
        if (endMin > startMin) out.push({ weekday: (local.getUTCDay() + 6) % 7, startMin, endMin });
        cur = segEnd;
      }
    }
    out.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
    const merged = [];
    for (const r of out) {
      const last = merged[merged.length - 1];
      if (last && last.weekday === r.weekday && r.startMin <= last.endMin) last.endMin = Math.max(last.endMin, r.endMin);
      else merged.push({ ...r });
    }
    return merged;
  }

  // Asetuskenttien muoto { 0: [{ start: 'HH:MM', end: 'HH:MM' }], … } (loppu 00:00 = keskiyö)
  // ↔ convertWeeklyWindows-rivit. Muuntaa kentät aikavyöhykkeestä toiseen.
  function convertWindowsByDay(windowsByDay, fromTz, toTz) {
    const toMin = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
    const rows = [];
    for (let d = 0; d < 7; d++) {
      for (const r of windowsByDay[d] || []) {
        if (!r.start || !r.end) continue;
        const startMin = toMin(r.start);
        const endMin = r.end === '00:00' ? 1440 : toMin(r.end);
        if (endMin > startMin) rows.push({ weekday: d, startMin, endMin });
      }
    }
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (min) => (min >= 1440 ? '00:00' : `${pad(Math.floor(min / 60))}:${pad(min % 60)}`);
    const out = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    convertWeeklyWindows(rows, fromTz, toTz).forEach((r) => out[r.weekday].push({ start: fmt(r.startMin), end: fmt(r.endMin) }));
    return out;
  }

  return { DEFAULT, isValid, browserZone, localInputToIso, isoToLocalInput, label, list, optionsHtml, setViewZone, getViewZone, zdate, ZDate, convertWeeklyWindows, convertWindowsByDay };
})();
