import type { Settings } from './api';

const media = window.matchMedia('(prefers-color-scheme: dark)');
let current: Settings | null = null;

export function resolvedTheme(s: Settings): 'light' | 'dark' {
  if (s.theme === 'light' || s.theme === 'dark') return s.theme;
  return media.matches ? 'dark' : 'light';
}

/** Applies appearance settings as CSS variables / attributes on <html>. */
export function applySettings(s: Settings): void {
  current = s;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(s);
  const st = root.style;
  const set = (k: string, v: string | null) => (v ? st.setProperty(k, v) : st.removeProperty(k));
  set('--mdv-font-body', s.fontFamily.trim() || null);
  set('--mdv-font-code', s.codeFontFamily.trim() || null);
  set('--mdv-font-size', `${s.fontSize}px`);
  set('--mdv-zoom', String(s.zoom / 100));
  set('--mdv-content-max-width', s.contentMaxWidth > 0 ? `${s.contentMaxWidth}px` : 'none');
  set('--mdv-content-padding', `${s.contentPadding}px`);
  set('--mdv-sidebar-width', `${s.sidebarWidth}px`);
}

media.addEventListener('change', () => {
  if (current) applySettings(current);
});

let customStyle: HTMLStyleElement | null = null;

/** Installs the user stylesheet after the built-in ones. */
export function setCustomCSS(css: string): void {
  if (!customStyle) {
    customStyle = document.createElement('style');
    customStyle.id = 'mdv-custom-css';
  }
  customStyle.textContent = css;
  document.head.append(customStyle); // keep it last
}
