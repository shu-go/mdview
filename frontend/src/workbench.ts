// Workbench: renders the pane layout (splits, panes, tab bars) and handles
// drag & drop of tabs and sidebar files.
import type { DocView } from './docview';
import type { Layout, LayoutNode, PaneNode, Side, SplitNode, Tab } from './layout';
import { closeMenu } from './menu';
import { basename, h } from './util';

export const MIME_TAB = 'application/x-mdview-tab';
export const MIME_FILE = 'application/x-mdview-file';

export interface DragTab {
  windowId: number;
  tabId: string;
  path: string;
  diffMode: Tab['diffMode'];
  scroll: number;
}

export type DropTarget = { paneId: string; index: number } | { paneId: string; side: Side | 'center' };

export interface WorkbenchHost {
  windowId(): number;
  view(tab: Tab): DocView;
  activatePane(paneId: string): void;
  activateTab(tabId: string): void;
  closeTab(tabId: string): void;
  dropTab(data: DragTab, target: DropTarget): void;
  dropFile(path: string, target: DropTarget): void;
  tabMenu(tab: Tab, x: number, y: number): void;
  dragOut(data: DragTab, screenX: number, screenY: number): void;
  layoutResized(): void;
  emptyView(): HTMLElement;
  /** Opens the pane's active tab in a new pane on that side. */
  splitPane(paneId: string, side: 'right' | 'bottom'): void;
  /** Shows the open dialog; files open in this pane. */
  openInPane(paneId: string, what: 'file' | 'folder'): void;
  /** Shows the recent files / folders menu at client coordinates; `button` is marked active while it is open. */
  recentMenu(paneId: string, what: 'file' | 'folder', x: number, y: number, button: HTMLElement): void;
}

// Static, trusted icon markup (no user data): small down-pointing triangle.
const caretSvg = '<svg viewBox="0 0 8 16" aria-hidden="true"><path d="M1.5 6.5h5L4 9.5z" fill="currentColor"/></svg>';

// Static, trusted icon markup (no user data).
const openButtons: ['file' | 'folder', string, string][] = [
  [
    'file',
    'Open files (Ctrl+O)',
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h5l4 4v9h-9z M8.5 1.5v4h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 8v4.5M5.8 10.3H10.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  ],
  [
    'folder',
    'Open folder (Ctrl+Shift+O)',
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4a1 1 0 0 1 1-1h3.6l1.5 1.6h5.9a1 1 0 0 1 1 1V12.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  ],
];

// Static, trusted icon markup (no user data).
const splitButtons: ['right' | 'bottom', string, string][] = [
  [
    'right',
    'Split right (Ctrl+\\)',
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.5v11" stroke="currentColor" stroke-width="1.3"/></svg>',
  ],
  [
    'bottom',
    'Split down (Ctrl+Shift+\\)',
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 8h13" stroke="currentColor" stroke-width="1.3"/></svg>',
  ],
];

/** The tab being dragged from this window, if any. */
let localDrag: { tabId: string; handled: boolean } | null = null;

export class Workbench {
  readonly el: HTMLElement;
  private overlays = new Map<string, HTMLElement>();

  constructor(
    private host: WorkbenchHost,
    private search: HTMLElement,
  ) {
    this.el = h('div', { class: 'mdv-workbench' });
  }

  render(layout: Layout, activePaneId: string): void {
    this.overlays.clear();
    const root = this.node(layout.root, layout, activePaneId);
    this.el.replaceChildren(root);
    // keep each pane's active tab visible in its (scrolling) tab list
    this.el.querySelectorAll<HTMLElement>('.mdv-pane-tabs').forEach((bar) => {
      const tab = bar.querySelector<HTMLElement>('.mdv-pane-tab.is-active');
      if (!tab) return;
      const left = tab.offsetLeft - bar.offsetLeft;
      if (left < bar.scrollLeft) bar.scrollLeft = left;
      else if (left + tab.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = left + tab.offsetWidth - bar.clientWidth;
    });
  }

  private node(n: LayoutNode, layout: Layout, activePaneId: string): HTMLElement {
    if (n.kind === 'pane') return this.pane(n, layout, activePaneId);
    return this.split(n, layout, activePaneId);
  }

  private split(n: SplitNode, layout: Layout, activePaneId: string): HTMLElement {
    const el = h('div', { class: `mdv-split mdv-split-${n.dir}` });
    n.children.forEach((c, i) => {
      if (i > 0) el.append(this.gutter(n, i, el));
      const child = this.node(c, layout, activePaneId);
      child.style.flex = `${n.sizes[i]} 1 0`;
      el.append(child);
    });
    return el;
  }

  private gutter(n: SplitNode, i: number, container: HTMLElement): HTMLElement {
    const g = h('div', { class: 'mdv-split-gutter' });
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.classList.add('is-active');
      const horizontal = n.dir === 'row';
      const rect = container.getBoundingClientRect();
      const total = horizontal ? rect.width : rect.height;
      const start = horizontal ? e.clientX : e.clientY;
      const a = n.sizes[i - 1];
      const b = n.sizes[i];
      const kids = Array.from(container.children).filter((c) => !c.classList.contains('mdv-split-gutter')) as HTMLElement[];
      const move = (ev: PointerEvent) => {
        const d = ((horizontal ? ev.clientX : ev.clientY) - start) / total;
        const min = 0.05;
        const na = Math.max(min, Math.min(a + b - min, a + d));
        n.sizes[i - 1] = na;
        n.sizes[i] = a + b - na;
        kids[i - 1].style.flex = `${n.sizes[i - 1]} 1 0`;
        kids[i].style.flex = `${n.sizes[i]} 1 0`;
      };
      const up = () => {
        g.classList.remove('is-active');
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        this.host.layoutResized();
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
    });
    return g;
  }

  private pane(p: PaneNode, layout: Layout, activePaneId: string): HTMLElement {
    const isActive = p.id === activePaneId;
    const tabs = h('div', { class: 'mdv-pane-tabs' });
    p.tabs.forEach((t, i) => tabs.append(this.tab(p, t, i)));
    const filler = h('div', { class: 'mdv-pane-tabs-filler' });
    tabs.append(filler);
    this.tabBarDrop(tabs, p);

    const body = h('div', { class: 'mdv-pane-body' });
    const active = p.tabs.find((t) => t.id === p.active);
    if (active) {
      const v = this.host.view(active);
      body.append(v.frame);
    } else {
      body.append(this.host.emptyView());
    }
    if (isActive) body.append(this.search);
    const overlay = h('div', { class: 'mdv-pane-drop' });
    body.append(overlay);
    this.overlays.set(p.id, overlay);
    this.bodyDrop(body, p, overlay);

    // tab bar: scrolling tab list + actions fixed at the right end
    const actions = h('div', { class: 'mdv-pane-actions' });
    if (active) {
      for (const [side, title, svg] of splitButtons) {
        const b = h('button', { class: 'mdv-pane-action', type: 'button', title, 'data-side': side });
        b.innerHTML = svg; // static icon markup
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.host.splitPane(p.id, side);
        });
        actions.append(b);
      }
    }
    const opens = h('div', { class: 'mdv-pane-actions mdv-pane-actions-start' });
    for (const [what, title, svg] of openButtons) {
      const b = h('button', { class: 'mdv-pane-action', type: 'button', title, 'data-open': what });
      b.innerHTML = svg; // static icon markup
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.host.openInPane(p.id, what);
      });
      const more = h('button', {
        class: 'mdv-pane-action mdv-pane-action-recent',
        type: 'button',
        title: what === 'file' ? 'Recent files' : 'Recent folders',
        'data-recent': what,
      });
      more.innerHTML = caretSvg; // static icon markup
      // open on mousedown so that the menu's outside-click handler does not
      // close it again right away; a second press on the caret closes it
      more.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (more.classList.contains('is-active')) {
          closeMenu();
          return;
        }
        const r = group.getBoundingClientRect();
        this.host.recentMenu(p.id, what, r.left, r.bottom + 2, more);
      });
      more.addEventListener('click', (e) => e.stopPropagation());
      const group = h('div', { class: 'mdv-pane-open', 'data-open': what }, b, more);
      opens.append(group);
    }
    const header = h('div', { class: 'mdv-pane-header' }, opens, tabs, actions);

    const el = h('div', { class: `mdv-pane${isActive ? ' is-active' : ''}`, 'data-pane-id': p.id }, header, body);
    el.addEventListener('mousedown', () => this.host.activatePane(p.id), true);
    tabs.addEventListener('dblclick', (e) => {
      if (e.target === tabs || e.target === filler) this.host.activatePane(p.id);
    });
    void layout;
    return el;
  }

  private tab(p: PaneNode, t: Tab, index: number): HTMLElement {
    const v = this.host.view(t);
    const cls = ['mdv-pane-tab'];
    if (t.id === p.active) cls.push('is-active');
    if (v.changes > 0) cls.push('is-changed');
    if (v.result?.missing) cls.push('is-missing');
    const close = h('button', { class: 'mdv-pane-tab-close', type: 'button', title: 'Close (q / Ctrl+W)', text: '×' });
    const el = h(
      'div',
      { class: cls.join(' '), draggable: 'true', title: t.path, 'data-tab-id': t.id, 'data-index': String(index) },
      h('span', { class: 'mdv-pane-tab-title', text: basename(t.path) }),
      close,
    );
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.mdv-pane-tab-close')) return;
      this.host.activateTab(t.id);
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.host.closeTab(t.id);
      }
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.host.closeTab(t.id);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.host.tabMenu(t, e.clientX, e.clientY);
    });
    el.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      const data: DragTab = { windowId: this.host.windowId(), tabId: t.id, path: t.path, diffMode: t.diffMode, scroll: t.scroll };
      e.dataTransfer.setData(MIME_TAB, JSON.stringify(data));
      e.dataTransfer.setData('text/plain', t.path);
      e.dataTransfer.effectAllowed = 'move';
      localDrag = { tabId: t.id, handled: false };
    });
    el.addEventListener('dragend', (e) => {
      const drag = localDrag;
      localDrag = null;
      this.clearIndicators();
      if (!drag || drag.handled) return;
      const dt = e.dataTransfer;
      if (dt && dt.dropEffect !== 'none') return; // accepted by another window
      if (e.screenX === 0 && e.screenY === 0) return; // cancelled
      const outside =
        e.screenX < window.screenX ||
        e.screenY < window.screenY ||
        e.screenX >= window.screenX + window.outerWidth ||
        e.screenY >= window.screenY + window.outerHeight;
      if (outside) {
        this.host.dragOut({ windowId: this.host.windowId(), tabId: t.id, path: t.path, diffMode: t.diffMode, scroll: t.scroll }, e.screenX, e.screenY);
      }
    });
    return el;
  }

  private accepts(e: DragEvent): boolean {
    const types = e.dataTransfer?.types ?? [];
    return types.includes(MIME_TAB) || types.includes(MIME_FILE);
  }

  private clearIndicators(): void {
    this.el.querySelectorAll('.is-drop-before').forEach((x) => x.classList.remove('is-drop-before'));
    this.overlays.forEach((o) => o.classList.remove('is-active'));
  }

  private tabBarDrop(bar: HTMLElement, p: PaneNode): void {
    const indexAt = (e: DragEvent): { index: number; el: Element } => {
      const items = Array.from(bar.querySelectorAll('.mdv-pane-tab'));
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) return { index: i, el: items[i] };
      }
      return { index: items.length, el: bar.querySelector('.mdv-pane-tabs-filler')! };
    };
    bar.addEventListener('dragover', (e) => {
      if (!this.accepts(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      this.clearIndicators();
      indexAt(e).el.classList.add('is-drop-before');
    });
    bar.addEventListener('dragleave', (e) => {
      if (!bar.contains(e.relatedTarget as Node)) this.clearIndicators();
    });
    bar.addEventListener('drop', (e) => {
      if (!this.accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const { index } = indexAt(e);
      this.clearIndicators();
      this.handleDrop(e, { paneId: p.id, index });
    });
  }

  private bodyDrop(body: HTMLElement, p: PaneNode, overlay: HTMLElement): void {
    const zone = (e: DragEvent): Side | 'center' => {
      const r = body.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const d = { left: x, right: 1 - x, top: y, bottom: 1 - y };
      const [side, dist] = (Object.entries(d) as [Side, number][]).sort((a, b) => a[1] - b[1])[0];
      return dist < 0.22 ? side : 'center';
    };
    const show = (z: Side | 'center') => {
      const s = overlay.style;
      s.left = z === 'right' ? '50%' : '0';
      s.top = z === 'bottom' ? '50%' : '0';
      s.width = z === 'left' || z === 'right' ? '50%' : '100%';
      s.height = z === 'top' || z === 'bottom' ? '50%' : '100%';
      overlay.classList.add('is-active');
    };
    body.addEventListener('dragover', (e) => {
      if (!this.accepts(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      this.clearIndicators();
      show(zone(e));
    });
    body.addEventListener('dragleave', (e) => {
      if (!body.contains(e.relatedTarget as Node)) overlay.classList.remove('is-active');
    });
    body.addEventListener('drop', (e) => {
      if (!this.accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const z = zone(e);
      this.clearIndicators();
      this.handleDrop(e, { paneId: p.id, side: z });
    });
  }

  private handleDrop(e: DragEvent, target: DropTarget): void {
    const dt = e.dataTransfer!;
    const tabJSON = dt.getData(MIME_TAB);
    if (tabJSON) {
      let data: DragTab;
      try {
        data = JSON.parse(tabJSON) as DragTab;
      } catch {
        return;
      }
      if (localDrag && data.windowId === this.host.windowId()) localDrag.handled = true;
      this.host.dropTab(data, target);
      return;
    }
    const file = dt.getData(MIME_FILE);
    if (file) this.host.dropFile(file, target);
  }

  /** Pane under a client point, for tabs arriving from another window. */
  paneAt(clientX: number, clientY: number): string | null {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.mdv-pane');
    return el?.dataset.paneId ?? null;
  }
}
