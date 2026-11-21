import { h } from './util';

export type MenuItem = { label: string; run: () => void } | '-';

let open: HTMLElement | null = null;

export function closeMenu(): void {
  open?.remove();
  open = null;
}

/** Shows a context menu at client coordinates. */
export function showMenu(items: MenuItem[], x: number, y: number): void {
  closeMenu();
  const el = h('div', { class: 'mdv-menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') {
      el.append(h('div', { class: 'mdv-menu-separator' }));
      continue;
    }
    const row = h('div', { class: 'mdv-menu-item', role: 'menuitem', text: it.label });
    row.addEventListener('click', () => {
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
