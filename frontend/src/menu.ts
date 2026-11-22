import { h } from './util';

export type MenuItem =
  | {
      label: string;
      run: () => void;
      /** secondary text shown after the label (e.g. the folder of a file) */
      detail?: string;
      title?: string;
      disabled?: boolean;
    }
  | '-';

let open: HTMLElement | null = null;
let onClosed: (() => void) | null = null;

export function closeMenu(): void {
  open?.remove();
  open = null;
  const cb = onClosed;
  onClosed = null;
  cb?.();
}

/** Shows a context menu at client coordinates. `onClose` runs when it closes. */
export function showMenu(items: MenuItem[], x: number, y: number, onClose?: () => void): void {
  closeMenu();
  onClosed = onClose ?? null;
  const el = h('div', { class: 'mdv-menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') {
      el.append(h('div', { class: 'mdv-menu-separator' }));
      continue;
    }
    const row = h('div', { class: `mdv-menu-item${it.disabled ? ' is-disabled' : ''}`, role: 'menuitem' });
    if (it.detail === undefined) row.textContent = it.label;
    else row.append(h('span', { class: 'mdv-menu-item-label', text: it.label }), h('span', { class: 'mdv-menu-item-detail', text: it.detail }));
    if (it.title) row.title = it.title;
    row.addEventListener('click', () => {
      if (it.disabled) return;
      closeMenu();
      it.run();
    });
    el.append(row);
  }
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  el.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  open = el;
}

document.addEventListener('mousedown', (e) => {
  if (open && !open.contains(e.target as Node)) closeMenu();
});
document.addEventListener(
  'keydown',
  (e) => {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  },
  true,
);
window.addEventListener('blur', closeMenu);
