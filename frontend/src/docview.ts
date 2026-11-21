// DocView: the scrolling view of one tab's document.
// The document HTML is sanitised in Go (bluemonday) before it gets here.
import DOMPurify from 'dompurify';
import { api, type RenderResult, type Heading } from './api';
import type { Tab } from './layout';
import { dirname, errMessage, h } from './util';

export interface DocHost {
  openLink(path: string, anchor: string, split: boolean): void;
  openExternal(url: string): void;
  openSystem(path: string): void;
  status(msg: string, error?: boolean): void;
  rendered(view: DocView): void;
  scrolled(view: DocView): void;
}

const mdExt = /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i;

export function isMarkdownPath(p: string): boolean {
  return mdExt.test(p);
}

let mermaidSeq = 0;

export class DocView {
  readonly el: HTMLDivElement;
  readonly banner: HTMLDivElement;
  readonly content: HTMLElement;
  result: RenderResult | null = null;
  stale = true;
  private rendering: Promise<void> | null = null;
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
    this.el.addEventListener('scroll', () => {
      this.tab.scroll = this.el.scrollTop;
      if (!this.scrollTimer) {
        this.scrollTimer = window.setTimeout(() => {
          this.scrollTimer = 0;
          this.host.scrolled(this);
        }, 50);
      }
    });
    this.content.addEventListener('click', (e) => this.onClick(e));
    this.banner.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (t?.dataset.action === 'next-change') this.nextChange(1);
      if (t?.dataset.action === 'set-baseline') void api.SetBaseline(this.tab.path);
    });
  }

  get headings(): Heading[] {
    return this.result?.headings ?? [];
  }

  get changes(): number {
    return this.result?.changes ?? 0;
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
      this.host.rendered(this);
      return;
    }
    const first = this.result === null;
    const scroll = first ? this.tab.scroll : this.el.scrollTop;
    this.result = r;
    this.stale = false;
    this.changeIndex = -1;
    this.content.innerHTML = r.html;
    this.fixRawImages();
    this.updateBanner();
    await this.renderMermaid();
    this.el.scrollTop = scroll;
    this.host.rendered(this);
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

  /** Raw HTML <img src="relative"> is resolved against the document directory. */
  private fixRawImages(): void {
    const dir = dirname(this.tab.path);
    const sep = this.tab.path.includes('\\') ? '\\' : '/';
    this.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (/^([a-z][a-z0-9+.-]*:|\/\/|\/_mdv\/)/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return;
      let p = decodeURIComponent(src.split(/[?#]/)[0]);
      const isAbs = /^[a-z]:[\\/]/i.test(p) || p.startsWith('/');
      if (!isAbs) p = dir + sep + p.replace(/[\\/]/g, sep);
      img.src = '/_mdv/file?p=' + encodeURIComponent(p);
    });
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
    const path = a.dataset.mdvPath;
    const anchor = a.dataset.mdvAnchor ?? '';
    const href = a.getAttribute('href') ?? '';
    if (path) {
      if (/^(\\\\|\/\/)/.test(path)) {
        this.host.status('Network paths are not opened from links', true);
        return;
      }
      if (isMarkdownPath(path)) this.host.openLink(path, anchor, e.ctrlKey || e.metaKey);
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
