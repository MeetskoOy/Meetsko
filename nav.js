// Meetsko — yhteinen yläpalkki kaikille kirjautuneille sivuille.
// Vaatii translations.js:n (t, getCurrentLanguage). Sivu määrittelee itse
// logout()- ja setLanguagePref(lang)-funktiot, joita palkin napit kutsuvat.
//
// Käyttö:
//   <div id="appNav"></div>               (body-elementin alkuun)
//   AppNav.mount('projects');             ('projects' | 'clients' | 'people' | 'settings')
//   AppNav.setProfile(profileData);       (get-my-profile -vastaus, käännösten latauksen jälkeen)
//
// Istunto (bugi 3, CLAUDE.md): Supabasen access token vanhenee tunnissa, joten sitä ei
// tallenneta kerran latauksessa, vaan haetaan tuoreena ennen jokaista kutsua.
//   AppNav.initSession({ client, url, anonKey });
//   const data = await AppNav.api('get-my-organization', { ... });
//   const res = await AppNav.fetch(url, { method: 'POST', body });   (vastaus käsitellään itse)
// 401-vastaus tai puuttuva istunto avaa yhteisen "Istunto on vanhentunut" -ikkunan.
// Sivut siirtyvät tähän sitä mukaa kuin niitä muutenkin muokataan.

const AppNav = {
  mount(active) {
    const host = document.getElementById('appNav');
    if (!host) return;
    const link = (key, href, i18n, extra = '') =>
      `<a href="${href}" class="${active === key ? 'active' : ''}" data-i18n="${i18n}" ${extra}></a>`;

    host.outerHTML = `
      <header class="app-nav">
        <div class="app-nav-inner">
          <a class="brand" href="/projektit.html">
            <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><rect x="4" y="4" width="36" height="36" rx="8" fill="#FFFFFF"/><rect x="24" y="24" width="36" height="36" rx="8" fill="#8FB3E8"/><path d="M24 32A8 8 0 0 1 32 24H40V32A8 8 0 0 1 32 40H24Z" fill="#2BB39A"/></svg>
            Meetsko
          </a>
          <nav class="nav-links">
            ${link('projects', '/projektit.html', 'nav_projects')}
            ${link('clients', '/asiakkaat.html', 'admin_link_clients', 'data-superadmin-only style="display:none;"')}
            ${link('people', '/henkilot.html', 'admin_link_people', 'data-superadmin-only style="display:none;"')}
            ${link('organization', '/organisaatio.html', 'nav_organization', 'data-org-member-only style="display:none;"')}
            ${link('settings', '/oma-profiili.html', 'nav_settings')}
          </nav>
          <div class="nav-user">
            <button type="button" class="nav-user-btn" onclick="AppNav.togglePanel(event)">
              <span class="nav-avatar" id="navAvatar"></span>
              <span class="nav-user-name" id="navUserName" data-i18n="loading"></span>
            </button>
            <button type="button" class="nav-logout" onclick="logout()" data-i18n="logout"></button>
            <div class="profile-panel" id="myProfilePanel">
              <div class="pp-name" id="panelName"></div>
              <div class="pp-sub" id="panelEmail"></div>
              <div class="pp-sub" id="panelOrg"></div>
              <div class="pp-role" id="panelRole"></div>
              <div><a class="pp-link" href="/oma-profiili.html" data-i18n="my_settings"></a></div>
              <div class="lang-picker">
                <span data-i18n="language_label"></span>
                <div id="langButtons"></div>
              </div>
            </div>
          </div>
        </div>
      </header>
    `;

    // Paneeli sulkeutuu, kun klikataan sen ulkopuolelle.
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('myProfilePanel');
      if (panel && panel.classList.contains('open') && !e.target.closest('.nav-user')) {
        panel.classList.remove('open');
      }
    });
  },

  setProfile(data) {
    if (!data) return;
    const name = (data.firstName || data.lastName) ? `${data.firstName || ''} ${data.lastName || ''}`.trim() : data.email;
    document.getElementById('navUserName').textContent = name;
    document.getElementById('navAvatar').textContent = AppNav.initials(name);
    document.getElementById('panelName').textContent = name;
    document.getElementById('panelEmail').textContent = data.email || '';
    document.getElementById('panelOrg').innerHTML = data.organization
      ? AppNav.escape(data.organization) + (data.team ? '<br><span class="pp-team">' + AppNav.escape(data.team) + '</span>' : '')
      : '';
    const role = document.getElementById('panelRole');
    role.textContent = data.roleKey ? t(data.roleKey) : '';
    role.style.display = data.roleKey ? '' : 'none';
    // Asiakas- ja henkilösivut ovat vain superadminille; organisaation jäsenille
    // oma organisaatiosivu (superadmin avaa organisaatiot Asiakkaat-sivulta).
    document.querySelectorAll('[data-superadmin-only]').forEach((el) => {
      el.style.display = data.isSuperadmin ? '' : 'none';
    });
    document.querySelectorAll('[data-org-member-only]').forEach((el) => {
      el.style.display = !data.isSuperadmin && data.memberOrganization ? '' : 'none';
    });
    AppNav.renderLangButtons();
  },

  renderLangButtons() {
    const current = getCurrentLanguage();
    document.getElementById('langButtons').innerHTML = `
      <button class="lang-btn ${current === 'fi' ? 'active' : ''}" onclick="setLanguagePref('fi')">${t('language_fi')}</button>
      <button class="lang-btn ${current === 'en' ? 'active' : ''}" onclick="setLanguagePref('en')">${t('language_en')}</button>
    `;
  },

  togglePanel(e) {
    if (e) e.stopPropagation();
    document.getElementById('myProfilePanel').classList.toggle('open');
  },

  initials(label) {
    const parts = String(label).trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(label).slice(0, 2).toUpperCase();
  },

  // ---------- Istunto ----------
  _session: null,

  initSession({ client, url, anonKey }) {
    AppNav._session = { client, url, anonKey };
    // Vanhentunut istunto keskeyttää kesken olevan toiminnon; ikkuna on jo näkyvissä.
    window.addEventListener('unhandledrejection', (e) => {
      if (e.reason && e.reason.message === 'session_expired') e.preventDefault();
    });
  },

  // Tuore access token (supabase-js uusii vanhentuneen istunnon getSessionissa).
  async accessToken() {
    const { data: { session } } = await AppNav._session.client.auth.getSession();
    return session ? session.access_token : null;
  },

  async authHeaders() {
    const token = await AppNav.accessToken();
    if (!token) { AppNav.showSessionExpired(); throw new Error('session_expired'); }
    return { 'Content-Type': 'application/json', 'apikey': AppNav._session.anonKey, 'Authorization': 'Bearer ' + token };
  },

  // Edge Function -kutsu. Palauttaa vastauksen JSONina; 401 avaa istuntoikkunan.
  async api(fn, body) {
    const headers = await AppNav.authHeaders();
    const res = await fetch(`${AppNav._session.url}/functions/v1/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    if (res.status === 401) { AppNav.showSessionExpired(); throw new Error('session_expired'); }
    return res.json().catch(() => ({ error: t('error_generic') }));
  },

  // fetch-korvike sivuille, joiden kutsut käsittelevät vastauksen itse: lisää tuoreet
  // otsakkeet ja avaa istuntoikkunan 401-vastauksesta.
  async fetch(url, opts = {}) {
    const headers = await AppNav.authHeaders();
    const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    if (res.status === 401) { AppNav.showSessionExpired(); throw new Error('session_expired'); }
    return res;
  },

  showSessionExpired() {
    if (document.getElementById('sessionExpiredDialog')) return;
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    document.body.classList.add('session-expired');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="session-expired-backdrop" id="sessionExpiredDialog" role="alertdialog" aria-modal="true" aria-labelledby="sessionExpiredTitle">
        <div class="session-expired-box">
          <h2 id="sessionExpiredTitle">${AppNav.escape(t('session_expired_title'))}</h2>
          <p>${AppNav.escape(t('session_expired_body'))}</p>
          <a class="btn" href="/login.html?next=${next}">${AppNav.escape(t('session_expired_login'))}</a>
        </div>
      </div>
    `);
  },

  escape(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
};
