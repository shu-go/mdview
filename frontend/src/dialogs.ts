// Settings and help dialogs.
import { api, type Settings } from './api';
import { bindings, displayKey } from './keys';
import { errMessage, h } from './util';

type FieldKind = 'text' | 'number' | 'select' | 'checkbox';

interface Field {
  key: keyof Settings;
  label: string;
  kind: FieldKind;
  options?: [string, string][];
  hint?: string;
  placeholder?: string;
  step?: string;
  browse?: () => Promise<string>;
  extra?: { label: string; run: () => void };
}

function dialog(title: string, body: HTMLElement, footer: HTMLElement[]): { root: HTMLElement; close: () => void } {
  const box = h(
    'div',
    { class: 'mdv-dialog-box', role: 'dialog' },
    h('h2', { class: 'mdv-dialog-title', text: title }),
    body,
    h('div', { class: 'mdv-dialog-footer' }, ...footer),
  );
  const root = h('div', { class: 'mdv-dialog' }, box);
  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) close();
  });
  document.body.append(root);
  return { root, close };
}

export function isDialogOpen(): boolean {
  return document.querySelector('.mdv-dialog') !== null;
}

export function openSettings(current: Settings, exportCSS: () => void, status: (m: string, err?: boolean) => void): void {
  const s: Settings = { ...current };
  const fontHint = 'CSS font-family list, e.g. "Noto Sans JP", sans-serif. Empty = default.';
  const sections: [string, Field[]][] = [
    [
      'Appearance',
      [
        { key: 'theme', label: 'Color scheme', kind: 'select', options: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] },
        { key: 'fontFamily', label: 'Body font', kind: 'text', hint: fontHint, placeholder: 'system-ui, sans-serif' },
        { key: 'codeFontFamily', label: 'Code font', kind: 'text', placeholder: 'ui-monospace, Consolas, monospace' },
        { key: 'fontSize', label: 'Font size (px)', kind: 'number', step: '1' },
        { key: 'zoom', label: 'Zoom (%)', kind: 'number', step: '10', hint: '100 = actual size. Ctrl + / Ctrl - / Ctrl 0, Ctrl + mouse wheel' },
        { key: 'contentMaxWidth', label: 'Text width (px)', kind: 'number', step: '20', hint: '0 = use the full width. ( and ) adjust it.' },
        { key: 'contentPadding', label: 'Side margin (px)', kind: 'number', step: '4', hint: 'Left/right padding of the render area.' },
        {
          key: 'customCssPath',
          label: 'Custom CSS',
          kind: 'text',
          hint: 'Loaded after the built-in stylesheet and reloaded when it changes.',
          browse: () => api.ChooseCSSFile(),
          extra: { label: 'Export template…', run: exportCSS },
        },
      ],
    ],
    [
      'Behaviour',
      [
        { key: 'diffMode', label: 'Default diff', kind: 'select', options: [['baseline', 'Since baseline'], ['initial', 'Since first load'], ['off', 'Off']] },
        {
          key: 'diffDetail',
          label: 'Diff detail',
          kind: 'select',
          options: [['word', 'Words (inline)'], ['char', 'Characters (inline)'], ['block', 'Whole blocks']],
          hint: 'How changes inside a changed paragraph are shown.',
        },
        { key: 'outlineMaxLevel', label: 'Outline depth', kind: 'number', step: '1' },
        { key: 'closeWindowOnLastTab', label: 'Close window with last tab', kind: 'checkbox', hint: 'Close the window when its last tab is closed.' },
        {
          key: 'editorCommand',
          label: 'External editor',
          kind: 'text',
          hint: 'Command line; {file} and {line} are replaced. e.g. code -g "{file}:{line}"',
          placeholder: 'code -g "{file}:{line}"',
          browse: () => api.ChooseEditor(),
        },
      ],
    ],
  ];

  const body = h('div', { class: 'mdv-dialog-body' });
  const inputs = new Map<keyof Settings, HTMLInputElement | HTMLSelectElement>();
  for (const [title, fields] of sections) {
    body.append(h('div', { class: 'mdv-dialog-section', text: title }));
    for (const f of fields) {
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.kind === 'select') {
        input = h('select', { name: f.key });
        for (const [v, l] of f.options ?? []) input.append(h('option', { value: v, text: l }));
      } else {
        input = h('input', { type: f.kind, name: f.key, placeholder: f.placeholder, step: f.step, spellcheck: 'false' });
      }
      if (f.kind === 'checkbox') (input as HTMLInputElement).checked = !!s[f.key];
      else input.value = String(s[f.key] ?? '');
      inputs.set(f.key, input);
      const control = h('div', { class: 'mdv-dialog-field-control' }, input);
      if (f.browse) {
        const btn = h('button', { class: 'mdv-button', type: 'button', text: 'Browse…' });
        btn.addEventListener('click', async () => {
          try {
            const v = await f.browse!();
            if (v) input.value = v;
          } catch (e) {
            status(errMessage(e), true);
          }
        });
        control.append(btn);
      }
      if (f.extra) {
        const btn = h('button', { class: 'mdv-button', type: 'button', text: f.extra.label });
        btn.addEventListener('click', f.extra.run);
        control.append(btn);
      }
      const field = h('label', { class: 'mdv-dialog-field' }, h('span', { class: 'mdv-dialog-field-label', text: f.label }), control);
      if (f.hint) field.append(h('span', { class: 'mdv-dialog-field-hint', text: f.hint }));
      body.append(field);
    }
  }
  const pathNote = h('div', { class: 'mdv-dialog-field-hint' });
  void api.SettingsPath().then((p) => (pathNote.textContent = `Saved to: ${p}`));
  body.append(pathNote);

  const cancel = h('button', { class: 'mdv-button', type: 'button', text: 'Cancel' });
  const save = h('button', { class: 'mdv-button mdv-button-primary', type: 'button', text: 'Save' });
  const d = dialog('Settings', body, [cancel, save]);
  cancel.addEventListener('click', d.close);
  save.addEventListener('click', async () => {
    const out = { ...s } as Record<string, unknown>;
    for (const [k, input] of inputs) {
      const field = sections.flatMap((x) => x[1]).find((f) => f.key === k)!;
      out[k] = field.kind === 'number' ? Number(input.value) : field.kind === 'checkbox' ? (input as HTMLInputElement).checked : input.value;
    }
    try {
      await api.SaveSettings(out as unknown as Settings);
      d.close();
      status('Settings saved');
    } catch (e) {
      status(`Cannot save settings: ${errMessage(e)}`, true);
    }
  });
  (inputs.get('theme') as HTMLElement).focus();
}

export function openHelp(): void {
  const rows = bindings.map((b) => {
    const keys = b.display
      ? b.display.split(' ').map((k) => (k === '…' ? k : displayKey(k)))
      : [...new Map(b.keys.map((k) => [displayKey(k).toLowerCase(), displayKey(k)])).values()];
    return h('tr', {}, h('td', { text: keys.join('  ') }), h('td', { text: b.help }));
  });
  const body = h(
    'div',
    { class: 'mdv-dialog-body' },
    h('p', { text: 'A number before a key repeats it (e.g. 5j). Pager keys work when the document has focus.' }),
    h('table', { class: 'mdv-help-table' }, h('tbody', {}, ...rows)),
    h('p', {
      text: 'Mouse: drag tabs between panes, onto pane edges to split, or out of the window to open a new window. Ctrl+click a file or link to open it to the right.',
    }),
  );
  const ok = h('button', { class: 'mdv-button mdv-button-primary', type: 'button', text: 'Close' });
  const d = dialog('Key bindings', body, [ok]);
  ok.addEventListener('click', d.close);
  ok.focus();
}
