// Meetsko — yhteinen yläpalkki kaikille kirjautuneille sivuille.
// Vaatii translations.js:n (t, getCurrentLanguage). Sivu määrittelee itse
// logout()- ja setLanguagePref(lang)-funktiot, joita palkin napit kutsuvat.
//
// Käyttö:
//   <div id="appNav"></div>               (body-elementin alkuun)
//   AppNav.mount('projects');             ('projects' | 'clients' | 'people' | 'settings')
//   AppNav.setProfile(profileData);       (get-my-profile -vastaus, käännösten latauksen jälkeen)

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
    // Asiakas- ja henkilösivut ovat vain pääkäyttäjälle. Jäsenten oma
    // organisaatiosivu on tulossa (CLAUDE.md).
    document.querySelectorAll('[data-superadmin-only]').forEach((el) => {
      el.style.display = data.isSuperadmin ? '' : 'none';
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

  escape(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
};
