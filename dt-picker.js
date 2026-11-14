// Meetsko — yhteinen päivä- ja kellonaikavalitsin (sama ulkoasu kuin tapahtuman luonnin
// ajanvalitsimessa, tyylit app.css:n .dt-field- ja .dtp-*-luokissa). Käytössä
// näkyvyysrajauksissa: projektin asetukset (projekti.html) ja kutsusivu (kutsu.html).
// UAT 11/2026: vanhat selaimen minuuttivalitsimet (type=time, type=datetime-local) korvattu.
//
// Arvot ovat merkkijonoja ilman aikavyöhykemuunnosta, kuten aiemmissa kentissä:
//   mode 'datetime': 'YYYY-MM-DDTHH:MM' tai '' (tyhjä)
//   mode 'time':     'HH:MM'; endOfDay = true näyttää '00:00' muodossa 24:00 (päivän loppu)
//
//   DtPicker.fieldHtml(id, value, opts)  → kentän HTML (nappi)
//   DtPicker.open(id, value, opts)       → avaa valitsimen kentän alle
//   opts: { mode, endOfDay, allowClear, placeholder, compact, defaultTime, onclick (fieldHtml),
//           onChange: (value) => void (open) }
// Kellonajat listassa 30 min välein; lisäksi ajan voi kirjoittaa minuutin tarkkuudella.
// Utility-skripti ilman DOM-riippuvuuksia latauksessa; vaatii translations.js:n t():n.

const DtPicker = (() => {
  const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/></svg>';
  const CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.6"/></svg>';
  const STEP = 30;
  const WD = ['weekday_short_mon', 'weekday_short_tue', 'weekday_short_wed', 'weekday_short_thu', 'weekday_short_fri', 'weekday_short_sat', 'weekday_short_sun'];
  let st = null; // { id, mode, value, opts, view: {y, m} }

  const pad = (n) => String(n).padStart(2, '0');
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dateStr = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m, d));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m: m - 1, d }; };
  const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

  // Tämä päivä näyttöaikavyöhykkeessä (timezone.js), jos ladattu.
  function todayStr() {
    if (typeof MeetskoTZ !== 'undefined' && MeetskoTZ.zdate) {
      const z = MeetskoTZ.zdate();
      return dateStr(z.getFullYear(), z.getMonth(), z.getDate());
    }
    const n = new Date();
    return dateStr(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function timeLabel(value, opts) {
    if (!value) return '';
    return opts.endOfDay && value === '00:00' ? '24:00' : value;
  }

  function label(value, opts) {
    if (opts.mode === 'time') return timeLabel(value, opts);
    if (!value) return '';
    const [ds, tm] = value.split('T');
    const { y, m, d } = parseDate(ds);
    const wd = (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7;
    // Kellonaika kuten tapahtuman luonnin valitsimessa (suomeksi 10.00, englanniksi 10:00).
    const clock = typeof getCurrentLanguage === 'function' && getCurrentLanguage() === 'en' ? tm.slice(0, 5) : tm.slice(0, 5).replace(':', '.');
    return `${t(WD[wd])} ${d}.${m + 1}.${y} ${clock}`;
  }

  function fieldHtml(id, value, opts = {}) {
    const text = label(value, opts) || opts.placeholder || t('dtp_choose');
    return `<button type="button" class="dt-field${opts.compact ? ' compact' : ''}${value ? '' : ' empty'}" id="${esc(id)}" data-dtp="1"${opts.onclick ? ` onclick="${esc(opts.onclick)}"` : ''}>`
      + `${opts.mode === 'time' ? CLOCK : ICON}<span style="flex:1;">${esc(text)}</span></button>`;
  }

  function open(id, value, opts = {}) {
    const mode = opts.mode === 'time' ? 'time' : 'datetime';
    const base = mode === 'datetime' && value ? value.split('T')[0] : todayStr();
    const { y, m } = parseDate(base);
    st = { id, mode, value: value || '', opts: { ...opts, mode }, view: { y, m }, error: '' };
    render(true);
  }

  function close() {
    st = null;
    const el = document.getElementById('dtPickerPopover');
    if (el) el.remove();
  }

  function set(value) {
    st.value = value;
    st.error = '';
    const trigger = document.getElementById(st.id);
    if (trigger) {
      const text = label(value, st.opts) || st.opts.placeholder || t('dtp_choose');
      trigger.querySelector('span').textContent = text;
      trigger.classList.toggle('empty', !value);
    }
    if (st.opts.onChange) st.opts.onChange(value);
    render(false);
  }

  function pickDate(ds) {
    const time = st.value ? st.value.split('T')[1] : (st.opts.defaultTime || '09:00');
    set(`${ds}T${time}`);
  }

  function pickTime(min) {
    if (st.mode === 'time') { set(hhmm(min)); return; }
    const ds = st.value ? st.value.split('T')[0] : todayStr();
    set(`${ds}T${hhmm(min)}`);
  }

  // Kirjoitettu aika: "13", "13.10", "13:10" tai "1310"; päivän loppuun myös "24".
  function typed(raw) {
    const m = String(raw).trim().match(/^(\d{1,2})(?:[.:]?(\d{2}))?$/);
    const h = m ? Number(m[1]) : NaN, min = m ? Number(m[2] || 0) : NaN;
    const endOfDay = st.opts.endOfDay && h === 24 && min === 0;
    if (!m || (!endOfDay && (h > 23 || min > 59))) { st.error = t('dtp_invalid_time'); render(false); return; }
    pickTime(endOfDay ? 0 : h * 60 + min);
  }

  function shift(delta) {
    const d = new Date(Date.UTC(st.view.y, st.view.m + delta, 1));
    st.view = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    render(false);
  }

  function render(scrollTimes) {
    if (!st) return;
    const trigger = document.getElementById(st.id);
    if (!trigger) { close(); return; }
    const isDt = st.mode === 'datetime';
    const selDay = isDt && st.value ? st.value.split('T')[0] : null;
    const curTime = isDt ? (st.value ? st.value.split('T')[1] : '') : st.value;
    const curMin = curTime ? minutesOf(curTime) : null;

    let cal = '';
    if (isDt) {
      const first = new Date(Date.UTC(st.view.y, st.view.m, 1));
      const offset = (first.getUTCDay() + 6) % 7;
      const today = todayStr();
      let days = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(Date.UTC(st.view.y, st.view.m, 1 - offset + i));
        const ds = dateStr(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        const cls = ['dtp-day'];
        if (d.getUTCMonth() !== st.view.m) cls.push('other');
        if (ds === today) cls.push('today');
        if (ds === selDay) cls.push('sel');
        days += `<button type="button" class="${cls.join(' ')}" data-day="${ds}">${d.getUTCDate()}</button>`;
      }
      const wd = WD.map((k) => `<span class="dtp-wd">${t(k)}</span>`).join('');
      cal = `
        <div class="dtp-cal">
          <div class="dtp-cal-head">
            <button type="button" data-shift="-1" aria-label="‹">‹</button>
            <span>${t('rec_month_nom_' + (st.view.m + 1))} ${st.view.y}</span>
            <button type="button" data-shift="1" aria-label="›">›</button>
          </div>
          <div class="dtp-grid">${wd}${days}</div>
        </div>`;
    }

    let times = '';
    const last = st.opts.endOfDay ? 24 * 60 : 24 * 60 - STEP;
    for (let m = st.opts.endOfDay ? STEP : 0; m <= last; m += STEP) {
      const value = m === 24 * 60 ? 0 : m;
      const lbl = m === 24 * 60 ? '24:00' : hhmm(m);
      const sel = curMin !== null && value === curMin && (m === 24 * 60) === !!(st.opts.endOfDay && curMin === 0);
      times += `<button type="button" class="dtp-time ${sel ? 'sel' : ''}" data-min="${value}" data-pos="${m}">${lbl}</button>`;
    }

    let el = document.getElementById('dtPickerPopover');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dtPickerPopover';
      el.className = 'dtp-pop';
      document.body.appendChild(el);
      el.addEventListener('click', onClick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); typed(e.target.value); } });
      el.addEventListener('change', (e) => { if (e.target.matches('input')) typed(e.target.value); });
    }
    el.innerHTML = `
      <div class="dtp-body">
        ${cal}
        <div class="dtp-times">
          <input type="text" inputmode="numeric" placeholder="${esc(t('dtp_type_time'))}" value="${esc(timeLabel(curTime, st.opts))}" />
          <div class="dtp-time-list">${times}</div>
        </div>
      </div>
      ${st.error ? `<div class="dtp-error">${esc(st.error)}</div>` : ''}
      <div class="dtp-foot">
        ${st.opts.allowClear ? `<button type="button" class="secondary" data-act="clear">${t('dtp_clear')}</button>` : '<span></span>'}
        <button type="button" data-act="done">${t('dtp_done')}</button>
      </div>`;

    // Sijainti kentän alle (tai yläpuolelle, jos tila ei riitä), näkymän sisällä.
    const r = trigger.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.min(r.left, window.innerWidth - w - 12);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
    el.style.left = Math.max(12, left) + 'px';
    el.style.top = top + 'px';

    if (scrollTimes) {
      const list = el.querySelector('.dtp-time-list');
      const target = list.querySelector('.dtp-time.sel') || list.querySelector(`[data-pos="${curMin !== null ? Math.floor(curMin / STEP) * STEP : 9 * 60}"]`);
      if (target) list.scrollTop = Math.max(0, target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2);
    }
  }

  function onClick(e) {
    const b = e.target.closest('button');
    if (!b || !st) return;
    if (b.dataset.day) pickDate(b.dataset.day);
    else if (b.dataset.min !== undefined) pickTime(Number(b.dataset.min));
    else if (b.dataset.shift) shift(Number(b.dataset.shift));
    else if (b.dataset.act === 'clear') { set(''); close(); }
    else if (b.dataset.act === 'done') close();
  }

  // Sulkeutuu, kun klikataan valitsimen ja kenttien ulkopuolelle, tai Escillä.
  document.addEventListener('mousedown', (e) => {
    if (st && !e.target.closest('#dtPickerPopover') && !e.target.closest(`#${CSS.escape(st.id)}`)) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st) close(); });

  // 'YYYY-MM-DDTHH:MM' + minuutit (seinäkelloaikana, ilman aikavyöhykemuunnosta).
  function addMinutes(value, minutes) {
    const [ds, tm] = value.split('T');
    const { y, m, d } = parseDate(ds);
    const dt = new Date(Date.UTC(y, m, d, 0, minutesOf(tm) + minutes));
    return `${dateStr(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
  }

  return { fieldHtml, open, close, addMinutes };
})();
