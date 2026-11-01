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
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const first = guess - offsetMs(guess, tz);
    return new Date(guess - offsetMs(first, tz)).toISOString();
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

  return { DEFAULT, isValid, browserZone, localInputToIso, isoToLocalInput, label, list, optionsHtml };
})();
