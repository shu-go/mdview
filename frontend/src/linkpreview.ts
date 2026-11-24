// Link preview popup: Ctrl + hovering a link to a heading of this document or
// to another Markdown file shows the linked section (or the file's head).
import { api } from './api';
import { errMessage, h } from './util';

const HIDE_DELAY = 250;
/** top-level blocks copied when previewing a whole file */
const MAX_BLOCKS = 120;
const mdExt = /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i;

/** The preview whose content the pointer is over (Ctrl pressed later shows it). */
let hovered: { preview: LinkPreview; a: HTMLAnchorElement } | null = null;

window.addEventListener('keydown', (e) => {
  if (e.key === 'Control' && hovered) hovered.preview.show(hovered.a);
});

export class LinkPreview {
  private popup: HTMLElement | null = null;
  private ref: HTMLAnchorElement | null = null;
  private hideTimer = 0;
  private seq = 0;

  /** content: the rendered document (.mdv-content); the popup is placed inside it. */
  constructor(private content: HTMLElement) {
    content.addEventListener('mouseover', (e) => this.enter(e));
    content.addEventListener('mouseout', (e) => this.leave(e));
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.popup) this.hide();
    });
    // clicking the link itself (Ctrl+click opens it to the right) closes the popup
    content.addEventListener('click', (e) => {
      if (this.ref && this.ref.contains(e.target as Node)) this.hide();
    });
  }

  /** A link this popup can preview, outside the popup. */
  private refOf(t: EventTarget | null): HTMLAnchorElement | null {
    const a = (t as Element | null)?.closest?.<HTMLAnchorElement>('a');
    if (!a || !this.content.contains(a) || this.popup?.contains(a) || a.closest('.mdv-footnote-popup')) return null;
    if (a.matches('.footnote-ref, .footnote-backref, a[href^="#fn:"], a[href^="#fnref:"]')) return null; // footnote popup
    const path = a.dataset.mdvPath;
    if (path) return mdExt.test(path) ? a : null;
    return (a.getAttribute('href') ?? '').startsWith('#') ? a : null;
  }

  private enter(e: MouseEvent): void {
    const target = e.target as Node;
    if (this.popup?.contains(target)) {
      window.clearTimeout(this.hideTimer); // pointer moved into the popup
      return;
    }
    const a = this.refOf(e.target);
    if (!a) return;
    hovered = { preview: this, a };
    if (a === this.ref) window.clearTimeout(this.hideTimer);
    else if (e.ctrlKey) this.show(a);
  }

  private leave(e: MouseEvent): void {
    const to = e.relatedTarget as Node | null;
    const a = this.refOf(e.target);
    if (a && hovered?.a === a && !(to && a.contains(to))) hovered = null;
    if (!this.popup) return;
    if (to && (this.popup.contains(to) || (this.ref && this.ref.contains(to)))) return;
    if (!a && !this.popup.contains(e.target as Node)) return;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY);
  }

  async show(a: HTMLAnchorElement): Promise<void> {
    if (a === this.ref) return;
    this.hide();
    this.ref = a;
    const seq = ++this.seq;
    const path = a.dataset.mdvPath ?? '';
    const anchor = a.dataset.mdvAnchor ?? (path ? '' : decodeURIComponent((a.getAttribute('href') ?? '').slice(1)));
    let nodes: Node[];
    try {
      nodes = path ? await this.fileNodes(path, anchor) : this.sectionNodes(this.content, anchor);
    } catch (e) {
      nodes = [h('p', { class: 'mdv-link-popup-error', text: `Cannot preview: ${errMessage(e)}` })];
    }
    if (seq !== this.seq) return; // hidden or another link meanwhile
    if (!nodes.length || !a.isConnected || hovered?.a !== a) {
      this.ref = null;
      return;
    }
    const body = h('div', { class: 'mdv-link-popup-body' });
    body.append(...nodes);
    // no duplicate ids, and the document's line/scroll lookups ignore the popup
    body.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    body.querySelectorAll('[data-line]').forEach((x) => x.removeAttribute('data-line'));
    const name = path ? path.split(/[\\/]/).pop() ?? path : '';
    const title = h('div', { class: 'mdv-link-popup-title', text: anchor ? `${name}#${anchor}` : name });
    const popup = h('div', { class: 'mdv-link-popup', role: 'tooltip' }, title, body);
    this.content.append(popup);
    this.popup = popup;
    this.place(a, popup);
  }

  /** The linked file's section (or its head), rendered by Go (sanitised). */
  private async fileNodes(path: string, anchor: string): Promise<Node[]> {
    const doc = document.createElement('div');
    doc.innerHTML = await api.Preview(path);
    // in-page links of the previewed file point into that file, not this one
    doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((x) => {
      if (!x.dataset.mdvPath) x.dataset.mdvPath = path;
    });
    const nodes = anchor ? this.sectionNodes(doc, anchor) : [];
    if (nodes.length) return nodes;
    const top = Array.from(doc.childNodes).slice(0, MAX_BLOCKS);
    if (doc.childNodes.length > MAX_BLOCKS) top.push(h('p', { class: 'mdv-link-popup-more', text: '…' }));
    return top;
  }

  /** Copies of the element with the id and, for a heading, its section. */
  private sectionNodes(root: HTMLElement, id: string): Node[] {
    const target = findById(root, id);
    if (!target) return [];
    const level = headingLevel(target);
    if (!level) return [target.cloneNode(true)];
    const out: Node[] = [target.cloneNode(true)];
    for (let n = target.nextElementSibling; n && out.length < MAX_BLOCKS; n = n.nextElementSibling) {
      if (n.classList.contains('mdv-link-popup') || n.classList.contains('mdv-footnote-popup')) break;
      const l = headingLevel(n);
      if (l && l <= level) break;
      if (n.classList.contains('footnotes')) break;
      out.push(n.cloneNode(true));
    }
    return out;
  }

  private place(a: HTMLElement, popup: HTMLElement): void {
    const r = a.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    const margin = 6;
    let left = Math.min(r.left, window.innerWidth - p.width - margin);
    left = Math.max(margin, left);
    let top = r.bottom + margin;
    if (top + p.height > window.innerHeight - margin) {
      // above when it fits there, else wherever there is more room
      top = r.top - p.height - margin > 0 || r.top > window.innerHeight - r.bottom ? Math.max(margin, r.top - p.height - margin) : top;
    }
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.seq++;
    this.popup?.remove();
    this.popup = null;
    this.ref = null;
  }
}

function findById(root: HTMLElement, id: string): HTMLElement | null {
  if (!id) return null;
  for (const c of [id, id.toLowerCase(), id.toLowerCase().replace(/\s+/g, '-')]) {
    const el = root.querySelector<HTMLElement>(`[id="${CSS.escape(c)}"]`);
    if (el && !el.closest('.mdv-link-popup, .mdv-footnote-popup')) return el;
  }
  return null;
}

function headingLevel(el: Element): number {
  const m = /^H([1-6])$/.exec(el.tagName);
  return m ? Number(m[1]) : 0;
}
