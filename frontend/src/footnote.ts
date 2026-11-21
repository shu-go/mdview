// Footnote popup: hovering (or focusing) a footnote reference shows the
// footnote text next to it.
import { h } from './util';

const HIDE_DELAY = 250;

export class FootnotePopup {
  private popup: HTMLElement | null = null;
  private ref: HTMLAnchorElement | null = null;
  private hideTimer = 0;

  /** content: the rendered document (.mdv-content). */
  constructor(private content: HTMLElement) {
    content.addEventListener('mouseover', (e) => this.enter(e));
    content.addEventListener('focusin', (e) => this.enter(e));
    content.addEventListener('mouseout', (e) => this.leave(e));
    content.addEventListener('focusout', (e) => this.leave(e));
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.popup) this.hide();
    });
  }

  private refOf(t: EventTarget | null): HTMLAnchorElement | null {
    const a = (t as Element | null)?.closest?.<HTMLAnchorElement>('a.footnote-ref, a[href^="#fn:"]');
    return a && this.content.contains(a) && !this.popup?.contains(a) ? a : null;
  }

  private enter(e: Event): void {
    const target = e.target as Node;
    if (this.popup?.contains(target)) {
      window.clearTimeout(this.hideTimer); // pointer moved into the popup
      return;
    }
    const a = this.refOf(e.target);
    if (!a) return;
    window.clearTimeout(this.hideTimer);
    if (a !== this.ref) this.show(a);
  }

  private leave(e: Event): void {
    const to = (e as MouseEvent | FocusEvent).relatedTarget as Node | null;
    if (!this.popup) return;
    if (to && (this.popup.contains(to) || (this.ref && this.ref.contains(to)))) return;
    if (!this.refOf(e.target) && !this.popup.contains(e.target as Node)) return;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY);
  }

  private show(a: HTMLAnchorElement): void {
    this.hide();
    const id = decodeURIComponent((a.getAttribute('href') ?? '').replace(/^#/, ''));
    const note = this.content.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!note) return;
    const body = h('div', { class: 'mdv-footnote-popup-body' });
    for (const c of Array.from(note.childNodes)) body.append(c.cloneNode(true));
    // no duplicate ids, no "back to reference" links inside the popup
    body.querySelectorAll('.footnote-backref, a[href^="#fnref:"]').forEach((x) => x.remove());
    body.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    const label = h('span', { class: 'mdv-footnote-popup-label', text: a.textContent ?? '' });
    const popup = h('div', { class: 'mdv-footnote-popup', role: 'tooltip' }, label, body);
    this.content.append(popup);
    this.popup = popup;
    this.ref = a;
    this.place(a, popup);
  }

  private place(a: HTMLElement, popup: HTMLElement): void {
    const r = a.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    const margin = 6;
    let left = Math.min(r.left, window.innerWidth - p.width - margin);
    left = Math.max(margin, left);
    let top = r.bottom + margin;
    if (top + p.height > window.innerHeight - margin && r.top - p.height - margin > 0) top = r.top - p.height - margin;
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.popup?.remove();
    this.popup = null;
    this.ref = null;
  }
}
