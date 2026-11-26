// Scroll marks: where search hits and changes are, drawn over the scrollbar.
// The track is an overlay next to the scrolling element (pointer-events: none),
// so the native scrollbar keeps working underneath.
import { h } from './util';

export type MarkKind = 'ins' | 'mod' | 'del' | 'hit' | 'current';

/** A marked range in scroll-content coordinates (px from the top of the scrolled content). */
export interface MarkSpan {
  kind: MarkKind;
  top: number;
  bottom: number;
}

/** A mark in track coordinates. */
export interface TrackMark {
  kind: MarkKind;
  y: number;
  h: number;
}

/**
 * Scales spans to a track of the given height and merges marks of the same
 * kind that touch, so that thousands of hits become a few elements.
 * The current hit is always kept as its own mark, last (drawn on top).
 */
export function layoutMarks(spans: MarkSpan[], scrollHeight: number, trackHeight: number, minHeight = 2): TrackMark[] {
  if (scrollHeight <= 0 || trackHeight <= 0) return [];
  const scale = trackHeight / scrollHeight;
  const byKind = new Map<MarkKind, TrackMark[]>();
  for (const s of [...spans].sort((a, b) => a.top - b.top)) {
    let y = Math.floor(s.top * scale);
    let hgt = Math.max(minHeight, Math.ceil(s.bottom * scale) - y);
    y = Math.max(0, Math.min(trackHeight - hgt, y));
    hgt = Math.min(hgt, trackHeight);
    const list = byKind.get(s.kind) ?? [];
    byKind.set(s.kind, list);
    const last = list[list.length - 1];
    if (last && s.kind !== 'current' && y <= last.y + last.h) {
      last.h = Math.max(last.h, y + hgt - last.y);
    } else {
      list.push({ kind: s.kind, y, h: hgt });
    }
  }
  const order: MarkKind[] = ['del', 'ins', 'mod', 'hit', 'current'];
  return order.flatMap((k) => byKind.get(k) ?? []);
}

/** Collects the spans to mark inside content, relative to the scroller's content. */
export function collectSpans(scroller: HTMLElement, content: HTMLElement): MarkSpan[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const span = (el: Element, kind: MarkKind): MarkSpan => {
    const r = el.getBoundingClientRect();
    return { kind, top: r.top - base, bottom: r.bottom - base };
  };
  const spans: MarkSpan[] = [];
  for (const el of Array.from(content.querySelectorAll(':scope > .mdv-diff-ins, :scope > .mdv-diff-del'))) {
    const kind: MarkKind = el.classList.contains('mdv-diff-del') ? 'del' : el.classList.contains('is-inline') ? 'mod' : 'ins';
    spans.push(span(el, kind));
  }
  for (const el of Array.from(content.querySelectorAll('mark.mdv-search-hit'))) {
    spans.push(span(el, el.classList.contains('is-current') ? 'current' : 'hit'));
  }
  return spans;
}

/**
 * Space at each end of the track for the scrollbar arrow buttons:
 * --mdv-scrollmarks-inset, or with "auto" the scrollbar width on Windows
 * (square arrow buttons) and 0 elsewhere.
 */
function arrowInset(el: HTMLElement, barWidth: number): number {
  const v = getComputedStyle(el).getPropertyValue('--mdv-scrollmarks-inset').trim();
  if (v && v !== 'auto') return parseFloat(v) || 0;
  return document.documentElement.dataset.platform === 'windows' ? barWidth : 0;
}

export class ScrollMarks {
  readonly el: HTMLElement;
  private track: HTMLElement;
  private frame = 0;
  private observer: ResizeObserver | null = null;

  constructor(
    private scroller: HTMLElement,
    private content: HTMLElement,
  ) {
    this.track = h('div', { class: 'mdv-scrollmarks-track' });
    this.el = h('div', { class: 'mdv-scrollmarks', 'aria-hidden': 'true' }, this.track);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.update());
      this.observer.observe(scroller);
      this.observer.observe(content);
    }
  }

  /** Redraws on the next frame (calls coalesce). */
  update(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const sc = this.scroller;
    const barWidth = sc.offsetWidth - sc.clientWidth;
    const spans = barWidth > 0 && sc.scrollHeight > sc.clientHeight ? collectSpans(sc, this.content) : [];
    this.el.classList.toggle('is-hidden', !spans.length);
    if (!spans.length) {
      this.track.replaceChildren();
      return;
    }
    this.el.style.width = `${barWidth}px`;
    // stop above the horizontal scrollbar, if any
    this.el.style.bottom = `${sc.offsetHeight - sc.clientHeight}px`;
    const inset = `${arrowInset(this.el, barWidth)}px`;
    this.track.style.top = inset;
    this.track.style.bottom = inset;
    const marks = layoutMarks(spans, sc.scrollHeight, this.track.clientHeight);
    this.track.replaceChildren(
      ...marks.map((m) => {
        const d = h('div', { class: `mdv-scrollmarks-mark mdv-scrollmarks-${m.kind}` });
        d.style.top = `${m.y}px`;
        d.style.height = `${m.h}px`;
        return d;
      }),
    );
  }
}
