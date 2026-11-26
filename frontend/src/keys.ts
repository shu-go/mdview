// Key bindings: less / lv style pager keys plus GUI shortcuts.
// Keys are written as: optional "C-" (Ctrl, or Cmd on macOS), "A-" (Alt),
// "S-" (Shift, only for non-character keys), then the KeyboardEvent.key.

export interface Binding {
  keys: string[];
  cmd: string;
  help: string;
  /** short form shown in the help instead of every key */
  display?: string;
}

export const bindings: Binding[] = [
  { keys: ['j', 'ArrowDown', 'Enter', 'e', 'C-e'], cmd: 'line-down', help: 'Scroll down one line (count: N lines)' },
  { keys: ['k', 'ArrowUp', 'y', 'C-y'], cmd: 'line-up', help: 'Scroll up one line' },
  { keys: [' ', 'f', 'PageDown', 'z'], cmd: 'page-down', help: 'Scroll down one page' },
  { keys: ['b', 'S- ', 'PageUp', 'w'], cmd: 'page-up', help: 'Scroll up one page' },
  { keys: ['d', 'C-d'], cmd: 'half-down', help: 'Scroll down half a page' },
  { keys: ['u', 'C-u'], cmd: 'half-up', help: 'Scroll up half a page' },
  { keys: ['g', '<', 'Home'], cmd: 'top', help: 'Go to the top (count: go to line N, e.g. 120g)' },
  { keys: ['G', '>', 'End'], cmd: 'bottom', help: 'Go to the bottom (count: go to line N)' },
  { keys: ['p', '%'], cmd: 'percent', help: 'Go to N percent (e.g. 50p)' },
  { keys: ['h', 'ArrowLeft'], cmd: 'left', help: 'Scroll left' },
  { keys: ['l', 'ArrowRight'], cmd: 'right', help: 'Scroll right' },
  { keys: ['}'], cmd: 'next-heading', help: 'Next heading' },
  { keys: ['{'], cmd: 'prev-heading', help: 'Previous heading' },
  { keys: ['/', 'C-f'], cmd: 'search', help: 'Search forward' },
  { keys: ['?'], cmd: 'search-back', help: 'Search backward' },
  { keys: ['A-/', 'C-S-F', 'C-S-f'], cmd: 'search-regex', help: 'Search with a regular expression' },
  { keys: ['n', 'F3'], cmd: 'search-next', help: 'Next match' },
  { keys: ['N', 'S-F3'], cmd: 'search-prev', help: 'Previous match' },
  { keys: [']'], cmd: 'next-change', help: 'Next change (diff)' },
  { keys: ['['], cmd: 'prev-change', help: 'Previous change (diff)' },
  { keys: ['D'], cmd: 'toggle-diff', help: 'Diff: toggle between off and the last used mode' },
  { keys: ['B'], cmd: 'set-baseline', help: 'Use the current content as the diff baseline' },
  { keys: ['r', 'R', 'C-r', 'F5'], cmd: 'reload', help: 'Reload from disk' },
  { keys: ['v', 'C-S-E', 'C-S-e'], cmd: 'editor', help: 'Open in the external editor' },
  { keys: ['='], cmd: 'info', help: 'Show file information' },
  { keys: ['q', 'C-w'], cmd: 'close-tab', help: 'Close tab' },
  { keys: ['t', 'C-Tab', 'C-PageDown'], cmd: 'next-tab', help: 'Next tab' },
  { keys: ['T', 'C-S-Tab', 'C-PageUp'], cmd: 'prev-tab', help: 'Previous tab' },
  { keys: ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9'], cmd: 'goto-tab', help: 'Go to tab 1-8 (Ctrl+9: last tab)', display: 'C-1 … C-9' },
  { keys: ['C-\\'], cmd: 'split-right', help: 'Split: open the tab to the right' },
  { keys: ['C-S-\\', 'C-|'], cmd: 'split-down', help: 'Split: open the tab below' },
  { keys: ['A-ArrowRight'], cmd: 'focus-next-pane', help: 'Focus next pane' },
  { keys: ['A-ArrowLeft'], cmd: 'focus-prev-pane', help: 'Focus previous pane' },
  { keys: ['C-b'], cmd: 'toggle-sidebar', help: 'Show / hide the sidebar' },
  { keys: ['o'], cmd: 'toggle-outline', help: 'Sidebar: files → outline → search' },
  { keys: ['C-o'], cmd: 'open-file', help: 'Open files' },
  { keys: ['C-S-O', 'C-S-o'], cmd: 'open-folder', help: 'Open folder' },
  { keys: ['C-n'], cmd: 'new-window', help: 'New window' },
  { keys: ['C-=', 'C-+', 'C-;'], cmd: 'zoom-in', help: 'Zoom in' },
  { keys: ['C--'], cmd: 'zoom-out', help: 'Zoom out' },
  { keys: ['C-0'], cmd: 'zoom-reset', help: 'Reset zoom' },
  { keys: ['C-S-ArrowRight', ')'], cmd: 'wider', help: 'Wider text column (less margin)' },
  { keys: ['C-S-ArrowLeft', '('], cmd: 'narrower', help: 'Narrower text column (more margin)' },
  { keys: ['C-,'], cmd: 'settings', help: 'Settings' },
  { keys: ['C-S-G', 'C-S-g'], cmd: 'toggle-search-panel', help: 'Search in all listed files (sidebar)' },
  { keys: ['F1', 'H'], cmd: 'help', help: 'Key bindings' },
  { keys: ['C-q'], cmd: 'quit', help: 'Quit mdview' },
  { keys: ['Escape'], cmd: 'escape', help: 'Close search / dialog, clear count' },
];

const table = new Map<string, string>();
for (const b of bindings) for (const k of b.keys) table.set(k, b.cmd);

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** Normalises a keyboard event into a binding key. */
export function keyName(e: KeyboardEvent): string {
  let k = e.key;
  if (k === 'Spacebar') k = ' ';
  const ctrl = isMac ? e.metaKey : e.ctrlKey;
  const printable = k.length === 1;
  let s = '';
  if (ctrl) s += 'C-';
  if (e.altKey) s += 'A-';
  if (e.shiftKey && (!printable || ctrl || k === ' ')) s += 'S-';
  // Ctrl+Shift+letter reports an upper-case key; keep it as is ("C-S-O").
  return s + k;
}

export interface KeyResult {
  cmd: string;
  count: number | null;
}

/** Accumulates a numeric count prefix (as in less) and resolves commands. */
export class KeyState {
  private digits = '';

  get pendingCount(): string {
    return this.digits;
  }

  reset(): void {
    this.digits = '';
  }

  handle(e: KeyboardEvent): KeyResult | null {
    const name = keyName(e);
    if (/^[0-9]$/.test(name) && (this.digits !== '' || name !== '0')) {
      this.digits += name;
      return { cmd: 'count', count: Number(this.digits) };
    }
    const cmd = table.get(name);
    const count = this.digits ? Number(this.digits) : null;
    this.digits = '';
    if (!cmd) return null;
    return { cmd, count };
  }
}

export function displayKey(k: string): string {
  return k
    .replace(/^C-/, isMac ? '⌘' : 'Ctrl+')
    .replace('C-', isMac ? '⌘' : 'Ctrl+')
    .replace('A-', isMac ? '⌥' : 'Alt+')
    .replace('S-', 'Shift+')
    .replace(/ $/, 'Space')
    .replace(/^ $/, 'Space')
    .replace('Arrow', '');
}
