// Sidebar SEARCH panel: grep over all files of the shared list, grouped by
// directory in the same order as FILES. Re-runs when files change.
import { api } from './api';
import type { GrepFile, GrepResult } from '../bindings/github.com/shu-go/mdview/internal/workspace/models';
import { errMessage, groupLabel, h } from './util';

export interface GrepHost {
  grepOpen(path: string, line: number, split: boolean): void;
}

export class GrepPanel {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private regexBtn: HTMLButtonElement;
  private caseBtn: HTMLButtonElement;
  private summary: HTMLElement;
  private results: HTMLElement;
  private regex = false;
  private caseSensitive = false;
  private timer = 0;
  private seq = 0;
  private stale = false;

  constructor(private host: GrepHost) {
    this.input = h('input', { class: 'mdv-sidebar-search-input', type: 'text', placeholder: 'Search in files', spellcheck: 'false' });
    this.regexBtn = h('button', { class: 'mdv-sidebar-search-toggle', type: 'button', title: 'Regular expression', text: '.*' });
    this.caseBtn = h('button', { class: 'mdv-sidebar-search-toggle', type: 'button', title: 'Match case', text: 'Aa' });
    this.summary = h('div', { class: 'mdv-sidebar-search-summary' });
    this.results = h('div', { class: 'mdv-sidebar-search-results' });
    this.el = h(
      'div',
      { class: 'mdv-sidebar-search is-hidden' },
      h('div', { class: 'mdv-sidebar-search-form' }, this.input, this.regexBtn, this.caseBtn),
      this.summary,
      this.results,
    );
    this.input.addEventListener('input', () => this.schedule(200));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.run();
        this.results.querySelector<HTMLElement>('.mdv-sidebar-search-match')?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.value = '';
        this.run();
      }
    });
    this.regexBtn.addEventListener('click', () => {
      this.regex = !this.regex;
      this.regexBtn.classList.toggle('is-active', this.regex);
      this.run();
    });
    this.caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.classList.toggle('is-active', this.caseSensitive);
      this.run();
    });
    // keyboard navigation in results
    this.results.addEventListener('keydown', (e) => {
      const items = Array.from(this.results.querySelectorAll<HTMLElement>('.mdv-sidebar-search-match'));
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      if (e.key === 'ArrowDown' || e.key === 'j') items[Math.min(items.length - 1, i + 1)].focus();
      else if (e.key === 'ArrowUp' || e.key === 'k') {
        if (i === 0) this.input.focus();
        else items[i - 1].focus();
      } else if (e.key === 'Enter') items[i].click();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  markStale(visible: boolean): void {
    if (!this.input.value) return;
    if (visible) this.schedule(300);
    else this.stale = true;
  }

  refreshIfStale(): void {
    if (this.stale) this.run();
  }

  private schedule(ms: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), ms);
  }

  async run(): Promise<void> {
    window.clearTimeout(this.timer);
    this.stale = false;
    const pattern = this.input.value;
    const seq = ++this.seq;
    this.input.classList.remove('is-error');
    if (!pattern) {
      this.summary.textContent = '';
      this.results.replaceChildren();
      return;
    }
    let r: GrepResult;
    try {
      r = await api.Grep({ pattern, regex: this.regex, caseSensitive: this.caseSensitive });
    } catch (e) {
      if (seq !== this.seq) return;
      this.input.classList.add('is-error');
      this.summary.textContent = errMessage(e);
      this.results.replaceChildren();
      return;
    }
    if (seq !== this.seq) return; // a newer search is running
    this.render(r);
  }

  private render(r: GrepResult): void {
    const files = r.files ?? [];
    this.summary.textContent = files.length
      ? `${r.total}${r.truncated ? '+' : ''} matches in ${files.length} file${files.length > 1 ? 's' : ''}`
      : 'No matches';
    const groups = new Map<string, GrepFile[]>();
    for (const f of files) {
      const g = groups.get(f.dir);
      if (g) g.push(f);
      else groups.set(f.dir, [f]);
    }
    const out: HTMLElement[] = [];
    for (const [dir, list] of groups) {
      const group = h(
        'div',
        { class: 'mdv-sidebar-search-group' },
        h('div', { class: 'mdv-sidebar-search-group-title', title: dir, text: groupLabel(dir, list[0].root) }),
      );
      for (const f of list) {
        const file = h(
          'div',
          { class: 'mdv-sidebar-search-file', title: f.path },
          h('span', { class: 'mdv-sidebar-search-file-name', text: f.name }),
          h('span', { class: 'mdv-sidebar-search-file-count', text: `${f.matches?.length ?? 0}${f.more ? '+' : ''}` }),
        );
        file.addEventListener('click', (e) => this.host.grepOpen(f.path, 1, e.ctrlKey || e.metaKey));
        const ul = h('ul', { class: 'mdv-sidebar-search-list' });
        for (const m of f.matches ?? []) {
          const text = m.text;
          const li = h(
            'li',
            { class: 'mdv-sidebar-search-match', tabindex: '0', title: `${f.name}:${m.line}` },
            h('span', { class: 'mdv-sidebar-search-match-line', text: String(m.line) }),
            h(
              'span',
              { class: 'mdv-sidebar-search-match-text' },
              text.slice(0, m.start),
              h('mark', { class: 'mdv-sidebar-search-hit', text: text.slice(m.start, m.end) }),
              text.slice(m.end),
            ),
          );
          li.addEventListener('click', (e) => this.host.grepOpen(f.path, m.line, e.ctrlKey || e.metaKey));
          ul.append(li);
        }
        group.append(file, ul);
      }
      out.push(group);
    }
    this.results.replaceChildren(...out);
  }
}
