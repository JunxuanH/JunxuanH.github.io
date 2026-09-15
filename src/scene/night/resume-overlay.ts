/** Keep the loaded city alive while reading the separate, printable résumé document. */
let dialog: HTMLDialogElement | undefined;
let frame: HTMLIFrameElement;
let trigger: HTMLElement | null = null;
const marker = 'neonResume';

function show() {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'resume-overlay';
    dialog.setAttribute('aria-label', 'Résumé');
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'resume-close'; close.textContent = '← Back to city';
    close.addEventListener('click', dismiss);
    frame = document.createElement('iframe');
    frame.title = 'Ivan He résumé'; frame.src = '/resume?embedded=1';
    dialog.append(close, frame); document.body.append(dialog);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); dismiss(); });
  }
  if (!dialog.open) dialog.showModal();
  document.documentElement.classList.add('resume-open');
}

function hide() {
  dialog?.close();
  document.documentElement.classList.remove('resume-open');
  trigger?.focus({ preventScroll: true });
}

function dismiss() {
  if (history.state?.[marker]) history.back();
  else hide();
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !/^\/resume\/?$/.test(url.pathname)) return;
  e.preventDefault();
  trigger = a;
  if (dialog?.open) return;
  history.pushState({ ...history.state, [marker]: true }, '', location.href);
  show();
});
addEventListener('popstate', () => { if (history.state?.[marker]) show(); else hide(); });
addEventListener('message', (e) => {
  if (dialog?.open && e.origin === location.origin && e.source === frame.contentWindow && e.data === 'close-resume') dismiss();
});
// A reload of an overlay history entry should not resurrect a stale modal over the gate.
if (history.state?.[marker]) history.replaceState({ ...history.state, [marker]: false }, '', location.href);
