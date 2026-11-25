// DocView: the scrolling view of one tab's document.
// The document HTML is sanitised in Go (bluemonday) before it gets here.
import DOMPurify from 'dompurify';
import { api, type RenderResult, type Heading } from './api';
import type { Tab } from './layout';
import { errMessage, h } from './util';
import { FootnotePopup } from './footnote';
import { LinkPreview } from './linkpreview';
import { applyInlineDiffs, type DiffDetail } from './inlinediff';
import { ScrollMarks } from './scrollmarks';

export interface DocHost {
  openLink(path: string, anchor: string, split: boolean): void;
  openExternal(url: string): void;
  openSystem(path: string): void;
  status(msg: string, error?: boolean): void;
  rendered(view: DocView): void;
  scrolled(view: DocView): void;
  linkHover(target: string | null): void;
  diffDetail(): DiffDetail;
  selectionMenu(view: DocView, text: string, x: number, y: number): void;
}

/** What a link points to, as shown in the status bar. */
export function linkTarget(a: HTMLAnchorElement): string {
  const path = a.dataset.mdvPath;
  const anchor = a.dataset.mdvAnchor;
  if (path) return anchor ? `${path}#${anchor}` : path;
  const href = a.getAttribute('href') ?? '';
  if (href.startsWith('#')) return anchor ? `#${anchor}` : decodeURIComponent(href);
  return href;
}

const mdExt = /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i;

export function isMarkdownPath(p: string): boolean {
  return mdExt.test(p);
}

let mermaidSeq = 0;

export class DocView {
  /** what the pane shows: the scroller plus the scroll marks overlay */
  readonly frame: HTMLDivElement;
  /** the scrolling element */
  readonly el: HTMLDivElement;
  private marks: ScrollMarks;
  readonly banner: HTMLDivElement;
  readonly content: HTMLElement;
  result: RenderResult | null = null;
  stale = true;
  private rendering: Promise<void> | null = null;
  private footnotes: FootnotePopup;
  private preview: LinkPreview;
  private again = false;
  private scrollTimer = 0;
  /** index of the diff region focused by next/prev change */
  changeIndex = -1;

  constructor(
    public tab: Tab,
    private host: DocHost,
  ) {
    this.banner = h('div', { class: 'mdv-doc-banner' });
    this.content = h('article', { class: 'mdv-content' });
    this.el = h('div', { class: 'mdv-doc', tabindex: '-1' }, this.banner, this.content);
    this.marks = new ScrollMarks(this.el, this.content);
    this.frame = h('div', { class: 'mdv-doc-frame' }, this.el, this.marks.el);
    this.el.addEventListener('scroll', () => {
      this.tab.scroll = this.el.scrollTop;
      if (!this.scrollTimer) {
        this.scrollTimer = window.setTimeout(() => {
          this.scrollTimer = 0;
          this.host.scrolled(this);
        }, 50);
      }
    });
    this.footnotes = new FootnotePopup(this.content);
    this.preview = new LinkPreview(this.content);
    this.el.addEventListener(
      'scroll',
      () => {
        this.footnotes.hide();
        this.preview.hide();
      },
      { passive: true },
    );
    this.content.addEventListener('click', (e) => this.onClick(e));
    // Middle click on a link: open to the right, never let the webview navigate.
    this.content.addEventListener('mousedown', (e) => {
      if (e.button === 1 && (e.target as Element).closest?.('a')) e.preventDefault(); // no autoscroll
    });
    this.content.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const a = (e.target as Element).closest?.<HTMLAnchorElement>('a');
      if (!a || !this.content.contains(a)) return;
      e.preventDefault();
      this.followLink(a, true);
    });
    const linkOf = (e: Event) => (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a') ?? null;
    const show = (e: Event) => {
      const a = linkOf(e);
      if (a && this.content.contains(a)) this.host.linkHover(linkTarget(a) || null);
    };
    const hide = (e: Event) => {
      const a = linkOf(e);
      const to = (e as MouseEvent | FocusEvent).relatedTarget as Node | null;
      if (a && !(to && a.contains(to))) this.host.linkHover(null);
    };
    this.content.addEventListener('mouseover', show);
    this.content.addEventListener('mouseout', hide);
    this.content.addEventListener('focusin', show);
    this.content.addEventListener('focusout', hide);
    // Right click on selected text: our own menu (copy / search). Without a
    // selection the webview's default menu is left as is.
    this.content.addEventListener('contextmenu', (e) => {
      const text = this.selectedText();
      if (!text) return;
      e.preventDefault();
      this.host.selectionMenu(this, text, e.clientX, e.clientY);
    });
    this.banner.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (t?.dataset.action === 'next-change') this.nextChange(1);
      if (t?.dataset.action === 'set-baseline') void api.SetBaseline(this.tab.path);
    });
  }

  /** The selected text when the selection lies inside this document, else ''. */
  selectedText(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    if (!this.content.contains(sel.getRangeAt(0).commonAncestorContainer)) return '';
    return sel.toString();
  }

  get headings(): Heading[] {
    return this.result?.headings ?? [];
  }

  get changes(): number {
    return this.result?.changes ?? 0;
  }

  /**
   * Resolves once the view shows the document: waits for a render in progress,
   * renders when stale, and never forces an extra render (unlike render()).
   */
  ready(): Promise<void> {
    if (this.rendering) return this.rendering;
    return this.stale ? this.render() : Promise.resolve();
  }

  /** Renders (again). Concurrent calls coalesce into one extra render. */
  render(): Promise<void> {
    if (this.rendering) {
      this.again = true;
      return this.rendering;
    }
    this.rendering = (async () => {
      try {
        do {
          this.again = false;
          await this.renderOnce();
        } while (this.again);
      } finally {
        this.rendering = null;
      }
    })();
    return this.rendering;
  }

  private async renderOnce(): Promise<void> {
    let r: RenderResult;
    try {
      r = await api.Render(this.tab.path, this.tab.diffMode);
    } catch (e) {
      this.result = null;
      this.stale = false;
      this.banner.replaceChildren(h('span', { class: 'mdv-doc-banner-missing', text: `Cannot open: ${errMessage(e)}` }));
      this.content.replaceChildren();
      this.marksChanged();
      this.host.rendered(this);
      return;
    }
    const first = this.result === null;
    const scroll = first ? this.tab.scroll : this.el.scrollTop;
    this.result = r;
    this.stale = false;
    this.changeIndex = -1;
    this.footnotes.hide();
    this.preview.hide();
    this.content.innerHTML = r.html;
    if (this.tab.diffMode !== 'off' && r.changes > 0) applyInlineDiffs(this.content, this.host.diffDetail());
    this.updateBanner();
    await this.renderMermaid();
    this.el.scrollTop = scroll;
    this.marksChanged();
    this.host.rendered(this);
  }

  /** Redraws the scrollbar marks (search hits, changes). */
  marksChanged(): void {
    this.marks.update();
  }

  private updateBanner(): void {
    const r = this.result;
    const parts: HTMLElement[] = [];
    if (r?.missing) parts.push(h('span', { class: 'mdv-doc-banner-missing', text: 'File not found on disk (showing last content)' }));
    if (r && r.changes > 0) {
      const base = this.tab.diffMode === 'initial' ? 'first load' : 'baseline';
      parts.push(
        h('span', { class: 'mdv-doc-banner-diff', text: `${r.changes} change${r.changes > 1 ? 's' : ''} since ${base}` }),
        h('span', { class: 'mdv-doc-banner-link', 'data-action': 'next-change', text: 'Next change ( ] )' }),
      );
      if (this.tab.diffMode === 'baseline') {
        parts.push(h('span', { class: 'mdv-doc-banner-link', 'data-action': 'set-baseline', text: 'Set as baseline' }));
      }
    }
    this.banner.replaceChildren(...parts);
  }

  private async renderMermaid(): Promise<void> {
    const blocks = Array.from(this.content.querySelectorAll<HTMLElement>('.mdv-mermaid'));
    if (!blocks.length) return;
    let pele: typeof import('pele/lazy');
    try {
      pele = await import('pele/lazy');
    } catch (e) {
      this.host.status(`Mermaid unavailable: ${errMessage(e)}`, true);
      return;
    }
    await Promise.all(
      blocks.map(async (div) => {
        const src = div.querySelector('.mdv-mermaid-source')?.textContent ?? '';
        try {
          mermaidSeq += 1;
          const { svg } = await pele.renderAsync(src, { idPrefix: `mmd${mermaidSeq}-` } as never);
          // The diagram source comes from the document: sanitise the SVG.
          div.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        } catch (e) {
          div.append(h('div', { class: 'mdv-mermaid-error', text: `Mermaid: ${errMessage(e)}` }));
        }
      }),
    );
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>('.mdv-code-copy');
    if (copy) {
      e.preventDefault();
      const pre = copy.closest('.mdv-code')?.querySelector('pre');
      const text = (pre as HTMLElement | null)?.innerText ?? '';
      navigator.clipboard.writeText(text.replace(/\n$/, '')).then(
        () => {
          copy.textContent = 'Copied';
          copy.classList.add('is-done');
          window.setTimeout(() => {
            copy.textContent = 'Copy';
            copy.classList.remove('is-done');
          }, 1200);
        },
        (err) => this.host.status(`Copy failed: ${errMessage(err)}`, true),
      );
      return;
    }
    const a = target.closest<HTMLAnchorElement>('a');
    if (!a || !this.content.contains(a)) return;
    e.preventDefault();
    this.followLink(a, e.ctrlKey || e.metaKey);
  }

  /** Follows a document link. The webview itself never navigates. */
  private followLink(a: HTMLAnchorElement, split: boolean): void {
    const path = a.dataset.mdvPath;
    const anchor = a.dataset.mdvAnchor ?? '';
    const href = a.getAttribute('href') ?? '';
    if (path) {
      // network paths are refused by the Go side (OpenLink / OpenWithSystem)
      if (isMarkdownPath(path)) this.host.openLink(path, anchor, split);
      else this.host.openSystem(path);
      return;
    }
    if (href.startsWith('#')) {
      this.scrollToAnchor(anchor || decodeURIComponent(href.slice(1)));
      return;
    }
    if (/^(https?|mailto):/i.test(href)) this.host.openExternal(href);
  }

  /** Scrolls to the element with the given id (heading anchors, footnotes). */
  scrollToAnchor(id: string): boolean {
    if (!id) return false;
    const candidates = [id, id.toLowerCase(), id.toLowerCase().replace(/\s+/g, '-')];
    for (const c of candidates) {
      const el = this.content.querySelector<HTMLElement>(`[id="${CSS.escape(c)}"]`);
      if (el) {
        this.scrollToElement(el);
        return true;
      }
    }
    return false;
  }

  scrollToElement(el: HTMLElement, center = false): void {
    const top = el.getBoundingClientRect().top - this.el.getBoundingClientRect().top + this.el.scrollTop;
    this.el.scrollTop = center ? top - this.el.clientHeight / 3 : top - 8;
  }

  /** Index of the heading at the top of the viewport (-1 when above all). */
  currentHeading(): number {
    const hs = this.headings;
    const top = this.el.getBoundingClientRect().top;
    let cur = -1;
    for (let i = 0; i < hs.length; i++) {
      const el = this.content.querySelector<HTMLElement>(`[id="${CSS.escape(hs[i].id)}"]`);
      if (!el) continue;
      if (el.getBoundingClientRect().top - top <= 24) cur = i;
      else break;
    }
    return cur;
  }

  /** Jumps to the next (dir=1) or previous (dir=-1) heading. */
  jumpHeading(dir: 1 | -1): void {
    const hs = this.headings;
    if (!hs.length) return;
    const cur = this.currentHeading();
    const next = Math.max(0, Math.min(hs.length - 1, cur + dir));
    if (dir === -1 && cur >= 0) {
      // if not exactly at the current heading, go to its top first
      const el = this.content.querySelector<HTMLElement>(`[id="${CSS.escape(hs[cur].id)}"]`);
      if (el && el.getBoundingClientRect().top - this.el.getBoundingClientRect().top < -10) {
        this.scrollToElement(el);
        return;
      }
    }
    this.scrollToAnchor(hs[next].id);
  }

  /** Change regions: consecutive .mdv-diff-* siblings form one region. */
  private changeRegions(): HTMLElement[] {
    const all = Array.from(this.content.querySelectorAll<HTMLElement>(':scope > .mdv-diff-ins, :scope > .mdv-diff-del'));
    return all.filter((el) => {
      const prev = el.previousElementSibling;
      return !(prev && (prev.classList.contains('mdv-diff-ins') || prev.classList.contains('mdv-diff-del')));
    });
  }

  nextChange(dir: 1 | -1): void {
    const regions = this.changeRegions();
    if (!regions.length) {
      this.host.status('No changes');
      return;
    }
    this.content.querySelectorAll('.mdv-diff-ins.is-current, .mdv-diff-del.is-current').forEach((e) => e.classList.remove('is-current'));
    if (this.changeIndex < 0) {
      // start from the viewport position
      const top = this.el.getBoundingClientRect().top;
      const idx = regions.findIndex((r) => r.getBoundingClientRect().top - top > 30);
      this.changeIndex = dir === 1 ? (idx < 0 ? 0 : idx) : (idx <= 0 ? regions.length - 1 : idx - 1);
    } else {
      this.changeIndex = (this.changeIndex + dir + regions.length) % regions.length;
    }
    let el: Element | null = regions[this.changeIndex];
    const first = el as HTMLElement;
    while (el && (el.classList.contains('mdv-diff-ins') || el.classList.contains('mdv-diff-del'))) {
      el.classList.add('is-current');
      el = el.nextElementSibling;
    }
    this.scrollToElement(first, true);
    this.host.status(`Change ${this.changeIndex + 1} / ${regions.length}`);
  }

  /** Scrolls to the top-level block containing a source line, and flashes it. */
  scrollToLine(line: number): void {
    let best: HTMLElement | null = null;
    for (const b of Array.from(this.content.querySelectorAll<HTMLElement>(':scope > [data-line], :scope > .mdv-diff-ins > [data-line]'))) {
      if (Number(b.dataset.line) <= line) best = b;
      else break;
    }
    if (!best) return;
    this.scrollToElement(best, true);
    best.classList.remove('is-flash');
    void best.offsetWidth; // restart the animation
    best.classList.add('is-flash');
  }

  /** Source line of the first block visible at the top of the viewport. */
  topLine(): number {
    const top = this.el.getBoundingClientRect().top;
    const blocks = this.content.querySelectorAll<HTMLElement>('[data-line]');
    let line = 1;
    for (const b of Array.from(blocks)) {
      const r = b.getBoundingClientRect();
      line = Number(b.dataset.line) || line;
      if (r.bottom - top > 0) break;
    }
    return line;
  }
}
