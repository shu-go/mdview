// In-document search: plain text or regular expression, with highlighting.
import { h } from './util';

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
}

/** Builds the RegExp for a query; throws on an invalid regex. */
export function buildPattern(query: string, opts: SearchOptions): RegExp {
  const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(src, opts.caseSensitive ? 'g' : 'gi');
}

/** Wraps all matches inside root in <mark class="mdv-search-hit">. */
export function highlight(root: HTMLElement, re: RegExp): HTMLElement[] {
  const nodes: Text[] = [];
  const skip = new Set(['SVG', 'svg', 'SCRIPT', 'STYLE']);
  const collect = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.TEXT_NODE) {
        if (c.nodeValue) nodes.push(c as Text);
      } else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as Element;
        if (skip.has(el.tagName) || el.classList.contains('mdv-code-header') || el.classList.contains('mdv-mermaid-source')) continue;
        collect(el);
      }
    }
  };
  collect(root);
  const hits: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    re.lastIndex = 0;
    const ranges: [number, number][] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      ranges.push([m.index, m.index + m[0].length]);
    }
    if (!ranges.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [s, e] of ranges) {
      if (s > pos) frag.append(text.slice(pos, s));
      const mark = h('mark', { class: 'mdv-search-hit', text: text.slice(s, e) });
      frag.append(mark);
      hits.push(mark);
      pos = e;
    }
    if (pos < text.length) frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
  return hits;
}

/** Removes highlighting added by highlight(). */
export function unhighlight(root: HTMLElement): void {
  const marks = root.querySelectorAll('mark.mdv-search-hit');
  const parents = new Set<Node>();
  marks.forEach((m) => {
    const p = m.parentNode;
    if (!p) return;
    p.replaceChild(document.createTextNode(m.textContent ?? ''), m);
    parents.add(p);
  });
  parents.forEach((p) => p.normalize());
}

export interface SearchTarget {
  content: HTMLElement;
  scrollToElement(el: HTMLElement, center?: boolean): void;
  el: HTMLElement;
}

export class SearchBar {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private regexBtn: HTMLButtonElement;
  private caseBtn: HTMLButtonElement;
  private count: HTMLElement;
  private target: SearchTarget | null = null;
  private hits: HTMLElement[] = [];
  private index = -1;
  private timer = 0;
  opts: SearchOptions = { regex: false, caseSensitive: false };
  backward = false;

  constructor(private onClose: () => void) {
    this.input = h('input', { class: 'mdv-search-input', type: 'text', placeholder: 'Search', spellcheck: 'false' });
    this.regexBtn = h('button', { class: 'mdv-search-toggle', type: 'button', title: 'Regular expression (Alt+R)', text: '.*' });
    this.caseBtn = h('button', { class: 'mdv-search-toggle', type: 'button', title: 'Match case (Alt+C)', text: 'Aa' });
    this.count = h('span', { class: 'mdv-search-count' });
    const prev = h('button', { class: 'mdv-search-button', type: 'button', title: 'Previous (Shift+Enter / N)', text: '↑' });
    const next = h('button', { class: 'mdv-search-button', type: 'button', title: 'Next (n)', text: '↓' });
    const close = h('button', { class: 'mdv-search-button', type: 'button', title: 'Close (Esc)', text: '×' });
    this.el = h('div', { class: 'mdv-search is-hidden' }, this.input, this.regexBtn, this.caseBtn, this.count, prev, next, close);

    this.input.addEventListener('input', () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.run(true), 150);
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.step(-1);
          return;
        }
        // Run the search if still pending, then hand focus to the document
        // so that n / N and the pager keys work right away.
        if (this.timer) {
          window.clearTimeout(this.timer);
          this.run(true);
        } else if (!this.hits.length) this.run(true);
        this.onClose();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        this.toggle('regex');
      } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        this.toggle('caseSensitive');
      }
    });
    this.regexBtn.addEventListener('click', () => this.toggle('regex'));
    this.caseBtn.addEventListener('click', () => this.toggle('caseSensitive'));
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    close.addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  get query(): string {
    return this.input.value;
  }

  private toggle(k: keyof SearchOptions): void {
    this.opts[k] = !this.opts[k];
    this.regexBtn.classList.toggle('is-active', this.opts.regex);
    this.caseBtn.classList.toggle('is-active', this.opts.caseSensitive);
    this.run(true);
  }

  open(backward = false, regex?: boolean): void {
    this.backward = backward;
    if (regex !== undefined) {
      this.opts.regex = regex;
      this.regexBtn.classList.toggle('is-active', regex);
    }
    this.el.classList.remove('is-hidden');
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.el.classList.add('is-hidden');
    if (this.target) unhighlight(this.target.content);
    this.hits = [];
    this.index = -1;
    this.count.textContent = '';
    this.onClose();
  }

  /** Changes the searched document (e.g. tab switch or re-render). */
  setTarget(t: SearchTarget | null, rerun: boolean): void {
    if (this.target && this.target !== t) unhighlight(this.target.content);
    this.target = t;
    this.hits = [];
    this.index = -1;
    if (rerun && this.query && this.isOpen) this.run(false);
  }

  /** Re-applies highlighting (after the target was re-rendered). */
  refresh(): void {
    if (this.query && this.isOpen) this.run(false);
  }

  run(jump: boolean): void {
    this.timer = 0;
    const t = this.target;
    if (!t) return;
    unhighlight(t.content);
    this.hits = [];
    this.index = -1;
    this.input.classList.remove('is-error');
    const q = this.query;
    if (!q) {
      this.count.textContent = '';
      return;
    }
    let re: RegExp;
    try {
      re = buildPattern(q, this.opts);
    } catch {
      this.input.classList.add('is-error');
      this.count.textContent = 'invalid';
      return;
    }
    this.hits = highlight(t.content, re);
    if (!this.hits.length) {
      this.count.textContent = '0 / 0';
      return;
    }
    // first hit at/after the viewport top (or before, when searching backward)
    const top = t.el.getBoundingClientRect().top;
    let i = this.hits.findIndex((m) => m.getBoundingClientRect().top >= top);
    if (i < 0) i = this.backward ? this.hits.length - 1 : 0;
    else if (this.backward) i = Math.max(0, i - 1);
    this.select(i, jump);
  }

  /** Moves to the next (1) or previous (-1) hit; n/N follow the search direction. */
  step(dir: 1 | -1, followDirection = false): void {
    if (!this.hits.length) {
      if (this.query) this.run(true);
      return;
    }
    const d = followDirection && this.backward ? -dir : dir;
    this.select((this.index + d + this.hits.length) % this.hits.length, true);
  }

  private select(i: number, jump: boolean): void {
    this.hits[this.index]?.classList.remove('is-current');
    this.index = i;
    const m = this.hits[i];
    m.classList.add('is-current');
    this.count.textContent = `${i + 1} / ${this.hits.length}`;
    if (jump && this.target) this.target.scrollToElement(m, true);
  }
}
