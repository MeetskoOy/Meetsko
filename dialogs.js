// Meetsko — sovelluksen omat vahvistus-, ilmoitus- ja kyselyikkunat selaimen
// confirm()/alert()/prompt()-ikkunoiden sijaan. Ladataan translations.js:n jälkeen:
//   <script src="/dialogs.js"></script>
//
//   if (!(await AppDialog.confirm(teksti, { danger: true, okLabel: '…' }))) return;
//   await AppDialog.alert(teksti);
//   const arvo = await AppDialog.prompt(teksti, { placeholder: '…' });   // null = peruttu
//
// Ikkunat ovat oman elementtinsä sisällä (ei modalHostissa), joten ne näkyvät avoimen
// sivuikkunan päällä eivätkä katoa, kun sivuikkuna suljetaan. Esc = peruuta,
// Enter = vahvista. Tekstit näytetään tekstinä (ei HTML:nä); rivinvaihdot säilyvät.

const AppDialog = (() => {
  const label = (key, fallback) => (typeof t === 'function' ? t(key) : fallback);
  let styled = false;
  const queue = [];
  let open = false;

  function ensureStyles() {
    if (styled) return;
    styled = true;
    const style = document.createElement('style');
    style.textContent = `
      .app-dialog-backdrop { position: fixed; inset: 0; background: rgba(14,34,64,0.35); display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 16px; }
      .app-dialog { background: var(--surface, #fff); color: var(--text, #0E2240); border-radius: 12px; padding: 24px; width: 100%; max-width: 420px; box-shadow: 0 16px 48px rgba(14,34,64,0.25); font-family: 'Manrope', -apple-system, 'Segoe UI', sans-serif; }
      .app-dialog-message { font-size: 14.5px; line-height: 1.55; white-space: pre-line; margin: 0; }
      .app-dialog input { width: 100%; box-sizing: border-box; margin-top: 14px; padding: 9px 11px; border: 1px solid #D0D5DD; border-radius: 8px; font: inherit; font-size: 14px; }
      .app-dialog input:focus { outline: none; border-color: var(--primary, #1B3A6B); box-shadow: 0 0 0 3px rgba(31,59,99,0.12); }
      .app-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
      .app-dialog-actions button { margin: 0; }
    `;
    document.head.appendChild(style);
  }

  // Yksi ikkuna kerrallaan; seuraavat odottavat jonossa.
  function show(kind, message, opts = {}) {
    return new Promise((resolve) => {
      queue.push({ kind, message, opts, resolve });
      if (!open) next();
    });
  }

  function next() {
    const item = queue.shift();
    if (!item) { open = false; return; }
    open = true;
    ensureStyles();
    const { kind, message, opts, resolve } = item;

    const backdrop = document.createElement('div');
    backdrop.className = 'app-dialog-backdrop';
    backdrop.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    const box = document.createElement('div');
    box.className = 'app-dialog';
    const text = document.createElement('p');
    text.className = 'app-dialog-message';
    text.textContent = String(message ?? '');
    box.appendChild(text);

    let input = null;
    if (kind === 'prompt') {
      input = document.createElement('input');
      input.type = opts.type || 'text';
      input.placeholder = opts.placeholder || '';
      input.value = opts.value || '';
      box.appendChild(input);
    }

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    let cancelBtn = null;
    if (kind !== 'alert') {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'secondary';
      cancelBtn.textContent = opts.cancelLabel || label('dialog_cancel', 'Peruuta');
      actions.appendChild(cancelBtn);
    }
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    if (opts.danger) okBtn.className = 'danger';
    okBtn.textContent = opts.okLabel || (opts.danger ? label('dialog_confirm', 'Vahvista') : label('dialog_ok', 'OK'));
    actions.appendChild(okBtn);
    box.appendChild(actions);
    backdrop.appendChild(box);

    const previousFocus = document.activeElement;
    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (previousFocus && previousFocus.focus) { try { previousFocus.focus(); } catch (e) {} }
      resolve(result);
      next();
    }
    const confirmResult = () => (kind === 'prompt' ? input.value : kind === 'confirm' ? true : undefined);
    const cancelResult = () => (kind === 'prompt' ? null : kind === 'confirm' ? false : undefined);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelResult()); }
      else if (e.key === 'Enter' && document.activeElement !== cancelBtn) { e.preventDefault(); e.stopPropagation(); close(confirmResult()); }
    }
    okBtn.onclick = () => close(confirmResult());
    if (cancelBtn) cancelBtn.onclick = () => close(cancelResult());
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    (input || okBtn).focus();
  }

  return {
    confirm: (message, opts) => show('confirm', message, opts),
    alert: (message, opts) => show('alert', message, opts),
    prompt: (message, opts) => show('prompt', message, opts),
  };
})();
