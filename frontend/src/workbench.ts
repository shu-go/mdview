// Workbench: renders the pane layout (splits, panes, tab bars) and handles
// drag & drop of tabs and sidebar files.
import type { DocView } from './docview';
import type { Layout, LayoutNode, PaneNode, Side, SplitNode, Tab } from './layout';
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
}

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
      body.append(v.el);
    } else {
      body.append(this.host.emptyView());
    }
    if (isActive) body.append(this.search);
    const overlay = h('div', { class: 'mdv-pane-drop' });
    body.append(overlay);
    this.overlays.set(p.id, overlay);
    this.bodyDrop(body, p, overlay);

    const el = h('div', { class: `mdv-pane${isActive ? ' is-active' : ''}`, 'data-pane-id': p.id }, tabs, body);
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
