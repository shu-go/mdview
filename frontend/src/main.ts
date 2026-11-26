import './styles/tokens.css';
import './styles/ui.css';
import './styles/content.css';
import './styles/highlight.css';
import tokensCSS from './styles/tokens.css?raw';
import uiCSS from './styles/ui.css?raw';
import contentCSS from './styles/content.css?raw';
import highlightCSS from './styles/highlight.css?raw';
// guide for people / LLMs editing the template; only in the exported file
import guideCSS from './styles/guide.css?raw';

import { Window as WailsWindow } from '@wailsio/runtime';
import { api, Ev, on, type FileItem, type OpenPathsEvent, type OpenResult, type RecentList, type Settings, type Snapshot, type TabReceiveEvent } from './api';
import { DocView, type DocHost } from './docview';
import { Layout, newTab, type DiffMode, type PaneNode, type Side, type Tab } from './layout';
import { Sidebar, icons, type SidebarHost } from './sidebar';
import { SearchBar, selectionQuery } from './search';
import { KeyState } from './keys';
import { isDialogOpen, openHelp, openSettings } from './dialogs';
import { showMenu, closeMenu, type MenuItem } from './menu';
import { applySettings, setCustomCSS } from './theme';
import { installNavigationGuard } from './navguard';
import appIconUrl from './assets/appicon.png';
import type { DiffDetail } from './inlinediff';
import { Workbench, type DragTab, type DropTarget, type WorkbenchHost } from './workbench';
import { basename, dirname, errMessage, h, isEditableTarget } from './util';

const builtinCSS = [guideCSS, tokensCSS, uiCSS, contentCSS, highlightCSS].join('\n\n');

const diffModes: DiffMode[] = ['baseline', 'initial', 'off'];
const diffLabel: Record<DiffMode, string> = { baseline: 'Diff: baseline', initial: 'Diff: first load', off: 'Diff: off' };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

// Window buttons, drawn thin like the native ones (10x10 in a 10x10 box).
const winSvg = (body: string) =>
  `<svg viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">${body}</svg>`;
const windowIcons = {
  minimise: winSvg('<path d="M0 5.5h10"/>'),
  maximise: winSvg('<rect x="0.5" y="0.5" width="9" height="9"/>'),
  restore: winSvg('<rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/>'),
  close: winSvg('<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>'),
};

// Static, trusted icon markup (no user data).
const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const statusIcons = {
  // arrows pointing inwards / outwards between two bars
  narrower: svg('<path d="M1.5 3v10M14.5 3v10M3.5 8h3M4.8 6.5L6.5 8 4.8 9.5M12.5 8h-3M11.2 6.5L9.5 8l1.7 1.5"/>'),
  wider: svg('<path d="M1.5 3v10M14.5 3v10M7 8H3.5M5 6.5L3.5 8 5 9.5M9 8h3.5M11 6.5L12.5 8 11 9.5"/>'),
  // a line wrapping back to the start of the next line
  wrap: svg('<path d="M1.5 3.5h13M1.5 8h11a2.5 2.5 0 010 5H8.5M10 11.3L8.3 13l1.7 1.7M1.5 12.5h4"/>'),
  zoomOut: svg('<circle cx="6.8" cy="6.8" r="4.3"/><path d="M10 10l4.2 4.2M4.8 6.8h4"/>'),
  zoomIn: svg('<circle cx="6.8" cy="6.8" r="4.3"/><path d="M10 10l4.2 4.2M4.8 6.8h4M6.8 4.8v4"/>'),
  // window split in two, the left part narrower (sidebar)
  sidebar: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6 2.5v11"/>'),
  // circular arrow (refresh): "take the current content as the new baseline"
  baseline: svg('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M12.2 1.8v2.6H9.6"/>'),
  pencil: svg('<path d="M11.2 2.3l2.5 2.5L5.5 13H3v-2.5z"/><path d="M9.7 3.8l2.5 2.5"/>'),
};

class Controller implements WorkbenchHost, DocHost, SidebarHost {
  winId = 0;
  platform = '';
  settings!: Settings;
  recent: RecentList = { files: [], folders: [] };
  layout = new Layout();
  activePaneId = this.layout.root.id;
  views = new Map<string, DocView>();
  keys = new KeyState();

  sidebar = new Sidebar(this);
  search = new SearchBar(() => this.focusDoc(true));
  workbench = new Workbench(this, this.search.el);
  toolbar = h('header', { class: 'mdv-toolbar' });
  private titleEl = h('span', { class: 'mdv-toolbar-brand-title', text: 'mdview' });
  sb = {
    link: h('span', { class: 'mdv-statusbar-link' }),
    message: h('span', { class: 'mdv-statusbar-message' }),
    zoom: h('span', { class: 'mdv-statusbar-zoom' }),
  };
  private msgTimer = 0;
  private zoomTimer = 0;
  private diffSelect!: HTMLSelectElement;
  private sidebarButton!: HTMLButtonElement;
  private wrapButton!: HTMLButtonElement;

  // ---------- startup ----------

  async start(): Promise<void> {
    this.buildDOM();
    // independent calls: one round trip instead of two
    const [st, customCSS] = await Promise.all([api.Init(), api.CustomCSS()]);
    this.winId = st.windowId;
    this.platform = st.platform;
    document.documentElement.dataset.platform = st.platform;
    this.applySettings(st.settings);
    const sideTab = st.settings.sidebarTab;
    this.sidebar.show(sideTab === 'outline' || sideTab === 'search' ? sideTab : 'files', false);
    this.sidebar.setFiles(st.files as Snapshot);
    setCustomCSS(customCSS);
    this.setRecent(st.recent);

    on<string>(Ev.docChanged, (p) => {
      this.docChanged(p);
      this.sidebar.grepStale();
    });
    on<Snapshot>(Ev.filesChanged, (s) => {
      this.sidebar.setFiles(s);
      this.updateSidebarActive();
      this.sidebar.grepStale();
    });
    on<Settings>(Ev.settingsChanged, (s) => this.applySettings(s));
    on<string>(Ev.customCSS, (css) => setCustomCSS(css));
    on<RecentList>(Ev.recentChanged, (r) => this.setRecent(r));
    on<OpenPathsEvent>(Ev.openPaths, (e) => {
      if (e.target === this.winId) void this.openPaths(e.paths);
    });
    on<TabReceiveEvent>(Ev.tabReceive, (e) => {
      if (e.target === this.winId) this.receiveTab(e);
    });
    on<{ target: number; tabId: string }>('tab:adopted', (e) => {
      if (e.target === this.winId) this.tabLeft(e.tabId);
    });
    window.addEventListener('focus', () => void api.NotifyFocus());
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Ctrl (Cmd) + mouse wheel: zoom
    window.addEventListener(
      'wheel',
      (e) => {
        if (!(isMac ? e.metaKey : e.ctrlKey)) return;
        e.preventDefault();
        if (e.deltaY !== 0) this.zoomBy(e.deltaY < 0 ? 10 : -10, true);
      },
      { passive: false },
    );

    for (const t of st.tabs ?? []) {
      this.addTab(this.activePaneId, newTab(t.path, (t.diffMode as DiffMode) || this.settings.diffMode as DiffMode, t.scroll));
    }
    this.renderAll();
    this.showOpened(st.opened);
    this.focusDoc();
  }

  private setRecent(r: RecentList | null | undefined): void {
    this.recent = { files: r?.files ?? [], folders: r?.folders ?? [] };
  }

  /**
   * Minimise / maximise (restore) / close buttons for the frameless window.
   * macOS keeps its native traffic lights, so the buttons are hidden there by CSS.
   */
  private windowControls(): HTMLElement {
    const button = (cls: string, title: string, icon: string, run: () => void) => {
      const b = h('button', { class: `mdv-window-button mdv-window-button-${cls}`, type: 'button', title });
      b.innerHTML = icon; // static, trusted icon markup
      b.addEventListener('click', run);
      return b;
    };
    const max = button('maximise', 'Maximise', windowIcons.maximise, () => void WailsWindow.ToggleMaximise());
    const updateMax = async () => {
      const maximised = await WailsWindow.IsMaximised().catch(() => false);
      max.innerHTML = maximised ? windowIcons.restore : windowIcons.maximise;
      max.title = maximised ? 'Restore' : 'Maximise';
      document.documentElement.classList.toggle('is-maximised', maximised);
    };
    let timer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void updateMax(), 100);
    });
    void updateMax();
    return h(
      'div',
      { class: 'mdv-window-controls' },
      button('minimise', 'Minimise', windowIcons.minimise, () => void WailsWindow.Minimise()),
      max,
      button('close', 'Close', windowIcons.close, () => void WailsWindow.Close()),
    );
  }

  private buildDOM(): void {
    // static, trusted icon markup
    const iconButton = (b: HTMLButtonElement, svg: string) => {
      b.innerHTML = svg;
      b.classList.add('mdv-toolbar-button-icon');
      return b;
    };
    const tb = (label: string, title: string, cmd: string) => {
      const b = h('button', { class: 'mdv-toolbar-button', type: 'button', title, 'data-cmd': cmd, text: label });
      b.addEventListener('click', () => {
        this.run(cmd, null);
      });
      return b;
    };
    this.sidebarButton = iconButton(tb('', 'Sidebar (Ctrl+B)', 'toggle-sidebar'), statusIcons.sidebar);
    this.diffSelect = h('select', { class: 'mdv-statusbar-select', title: 'Diff mode (D toggles on/off)' });
    for (const m of diffModes) this.diffSelect.append(h('option', { value: m, text: diffLabel[m] }));
    this.diffSelect.addEventListener('change', () => {
      const t = this.activeTab;
      if (t) this.setDiffMode(t, this.diffSelect.value as DiffMode);
      this.focusDoc();
    });
    // App icon + window title; this part (and the empty space) works like the
    // native title bar: drag to move the window, double-click to maximise.
    const brand = h(
      'div',
      { class: 'mdv-toolbar-brand', title: '' },
      h('img', { class: 'mdv-toolbar-brand-icon', src: appIconUrl, alt: '', draggable: 'false' }),
      this.titleEl,
    );
    brand.addEventListener('dblclick', (e: MouseEvent) => {
      // macOS: the Wails runtime handles double-clicks on drag regions itself
      if (isMac) return;
      e.preventDefault();
      void WailsWindow.ToggleMaximise();
    });
    this.toolbar.append(
      this.sidebarButton,
      brand,
      iconButton(tb('', 'Search (/ or Ctrl+F)', 'search'), icons.search),
      iconButton(tb('', 'Open in external editor (v)', 'editor'), statusIcons.pencil),
      tb('⚙', 'Settings (Ctrl+,)', 'settings'),
      tb('?', 'Key bindings (F1)', 'help'),
      this.windowControls(),
    );
    // status bar (right): text width and zoom controls, icon buttons
    const sbButton = (title: string, cmd: string, svg: string) => {
      const b = h('button', { class: 'mdv-statusbar-button', type: 'button', title, 'data-cmd': cmd });
      b.innerHTML = svg; // static, trusted icon markup
      b.addEventListener('click', () => {
        this.run(cmd, null);
        this.focusDoc();
      });
      return b;
    };
    this.wrapButton = sbButton('Text file: wrap long lines (Alt+Z)', 'toggle-wrap', statusIcons.wrap);
    this.sb.zoom.title = 'Zoom (click to reset: Ctrl+0)';
    this.sb.zoom.addEventListener('click', () => this.run('zoom-reset', null));
    const controls = h(
      'span',
      { class: 'mdv-statusbar-controls' },
      this.diffSelect,
      sbButton('Use the current content as the diff baseline (B)', 'set-baseline', statusIcons.baseline),
      h('span', { class: 'mdv-statusbar-separator' }),
      this.wrapButton,
      sbButton('Narrower text column ( ( )', 'narrower', statusIcons.narrower),
      sbButton('Wider text column ( ) )', 'wider', statusIcons.wider),
      h('span', { class: 'mdv-statusbar-separator' }),
      sbButton('Zoom out (Ctrl+-)', 'zoom-out', statusIcons.zoomOut),
      this.sb.zoom,
      sbButton('Zoom in (Ctrl++)', 'zoom-in', statusIcons.zoomIn),
    );
    const statusbar = h('footer', { class: 'mdv-statusbar' }, this.sb.link, this.sb.message, controls);
    const main = h('div', { class: 'mdv-main' }, this.sidebar.el, this.sidebar.resizer, this.workbench.el);
    const app = h('div', { class: 'mdv-app', 'data-file-drop-target': true }, this.toolbar, main, statusbar);
    document.body.className = 'mdv';
    document.body.replaceChildren(app);
    // Resize grips on the window edges (frameless window). They sit above
    // everything - e.g. the document's scrollbar at the right edge, which would
    // otherwise take the mouse - and the Wails runtime resizes from their position.
    // No text selection while resizing. Windows does not always report the
    // button release at the end of a native resize, so selection stays blocked
    // until the page sees the button up again.
    let resizing = false;
    for (const edge of ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const grip = h('div', { class: `mdv-resize-edge mdv-resize-edge-${edge}`, 'aria-hidden': 'true' });
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizing = true;
      });
      document.body.append(grip);
    }
    document.addEventListener('selectstart', (e) => {
      if (resizing) e.preventDefault();
    });
    const released = (e: MouseEvent) => {
      if (resizing && (e.type === 'mouseup' || (e.buttons & 1) === 0)) {
        resizing = false;
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener('mouseup', released, true);
    window.addEventListener('mousemove', released, true);
  }

  diffDetail(): DiffDetail {
    return (this.settings?.diffDetail as DiffDetail) || 'word';
  }

  private applySettings(s: Settings): void {
    const detailChanged = this.settings !== undefined && this.settings.diffDetail !== s.diffDetail;
    this.settings = s;
    applySettings(s);
    if (detailChanged) {
      // re-render documents showing a diff; hidden tabs render when shown
      const visible = new Set(this.visibleViews());
      this.views.forEach((v) => {
        if (v.tab.diffMode === 'off' || !v.changes) return;
        if (visible.has(v)) void v.render();
        else v.stale = true;
      });
    }
    this.sidebar.setVisible(s.sidebarVisible);
    this.sidebarButton?.classList.toggle('is-active', s.sidebarVisible);
    this.sb.zoom.textContent = `${s.zoom}%`;
    this.wrapButton?.classList.toggle('is-active', s.wrapText);
    this.updateOutline();
  }

  /** Changes the zoom (percent). Wheel zooming saves once it settles. */
  private zoomBy(delta: number, debounce = false): void {
    const zoom = Math.max(30, Math.min(400, Math.round((this.settings.zoom + delta) / 10) * 10));
    if (zoom === this.settings.zoom) return;
    if (!debounce) {
      void this.saveSettings({ zoom });
      return;
    }
    this.settings = { ...this.settings, zoom };
    this.applySettings(this.settings);
    window.clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => void this.saveSettings({ zoom: this.settings.zoom }), 400);
  }

  private setDiffMode(t: Tab, mode: DiffMode): void {
    if (mode !== 'off') t.lastDiffMode = mode;
    if (t.diffMode === mode) return;
    t.diffMode = mode;
    this.updateStatus();
    const v = this.views.get(t.id);
    if (v) void v.render();
    // no status message: the status bar select shows the mode
  }

  // DocHost: link under the pointer / keyboard focus
  linkHover(target: string | null): void {
    this.sb.link.textContent = target ?? '';
  }

  private async saveSettings(patch: Partial<Settings>): Promise<void> {
    const s = { ...this.settings, ...patch };
    this.applySettings(s); // immediate feedback; the broadcast confirms
    try {
      await api.SaveSettings(s);
    } catch (e) {
      this.statusMsg(`Cannot save settings: ${errMessage(e)}`, true);
    }
  }

  // ---------- views and tabs ----------

  windowId(): number {
    return this.winId;
  }

  view(tab: Tab): DocView {
    let v = this.views.get(tab.id);
    if (!v) {
      v = new DocView(tab, this);
      this.views.set(tab.id, v);
    }
    return v;
  }

  get activePane(): PaneNode {
    return this.layout.pane(this.activePaneId) ?? this.layout.panes()[0];
  }

  get activeTab(): Tab | undefined {
    const p = this.activePane;
    return p.tabs.find((t) => t.id === p.active);
  }

  get activeView(): DocView | undefined {
    const t = this.activeTab;
    return t ? this.view(t) : undefined;
  }

  private visibleViews(): DocView[] {
    return this.layout
      .panes()
      .map((p) => p.tabs.find((t) => t.id === p.active))
      .filter((t): t is Tab => !!t)
      .map((t) => this.view(t));
  }

  private addTab(paneId: string, tab: Tab, index?: number): void {
    this.layout.addTab(paneId, tab, index);
    this.activePaneId = paneId;
  }

  /** Rebuilds the workbench DOM, keeping scroll positions. */
  renderAll(): void {
    const scrolls = new Map<string, number>();
    this.views.forEach((v, id) => scrolls.set(id, v.tab.scroll));
    if (!this.layout.pane(this.activePaneId)) this.activePaneId = this.layout.panes()[0].id;
    this.workbench.render(this.layout, this.activePaneId);
    for (const v of this.visibleViews()) {
      const s = scrolls.get(v.tab.id) ?? 0;
      v.el.scrollTop = s;
      v.tab.scroll = s;
      if (v.stale) void v.render();
    }
    // drop views of closed tabs
    const live = new Set(this.layout.tabs().map((x) => x.tab.id));
    for (const id of [...this.views.keys()]) if (!live.has(id)) this.views.delete(id);
    this.activeChanged();
  }

  /** Updates everything that depends on the active tab. */
  private activeChanged(): void {
    const v = this.activeView;
    const t = this.activeTab;
    this.search.setTarget(v ?? null, true);
    this.updateOutline();
    this.updateSidebarActive();
    this.updateStatus();
    const title = t ? `${basename(t.path)} - mdview` : 'mdview';
    document.title = title;
    this.titleEl.textContent = title;
    void api.SetTitle(title);
  }

  private updateOutline(): void {
    const v = this.activeView;
    if (!this.settings) return;
    this.sidebar.setOutline(v?.headings ?? [], this.settings.outlineMaxLevel);
    if (v) this.sidebar.setCurrentHeading(v.currentHeading());
  }

  private updateSidebarActive(): void {
    const open = this.layout.tabs().map((x) => x.tab.path);
    this.sidebar.setActive(this.activeTab?.path ?? '', open);
  }

  private updateStatus(): void {
    const t = this.activeTab;
    this.diffSelect.value = t ? t.diffMode : this.settings?.diffMode ?? 'baseline';
    this.diffSelect.disabled = !t;
    // the wrap toggle only applies to text files
    this.wrapButton.classList.toggle('is-hidden', this.activeView?.result?.kind !== 'text');
    this.wrapButton.classList.toggle('is-active', !!this.settings?.wrapText);
    this.linkHover(null);
  }

  private updateTabClasses(): void {
    this.workbench.el.querySelectorAll<HTMLElement>('.mdv-pane-tab[data-tab-id]').forEach((el) => {
      const v = this.views.get(el.dataset.tabId ?? '');
      if (!v) return;
      el.classList.toggle('is-changed', v.changes > 0);
      el.classList.toggle('is-missing', !!v.result?.missing);
    });
  }

  activatePane(paneId: string): void {
    if (paneId === this.activePaneId) return;
    this.activePaneId = paneId;
    // light update: no DOM rebuild (a click may be in progress)
    this.workbench.el.querySelectorAll<HTMLElement>('.mdv-pane').forEach((p) => p.classList.toggle('is-active', p.dataset.paneId === paneId));
    const body = this.workbench.el.querySelector(`.mdv-pane[data-pane-id="${paneId}"] .mdv-pane-body`);
    body?.append(this.search.el);
    this.activeChanged();
  }

  activateTab(tabId: string): void {
    const f = this.layout.findTab(tabId);
    if (!f) return;
    f.pane.active = tabId;
    this.activePaneId = f.pane.id;
    this.renderAll();
    this.focusDoc();
  }

  closeTab(tabId: string): void {
    this.layout.removeTab(tabId);
    this.views.delete(tabId);
    if (this.layout.tabs().length === 0 && this.settings.closeWindowOnLastTab) {
      void WailsWindow.Close();
      return;
    }
    this.renderAll();
    this.focusDoc();
  }

  /** A tab of this window was taken by another window. */
  private tabLeft(tabId: string): void {
    if (!this.layout.findTab(tabId)) return;
    this.closeTab(tabId);
    this.closeIfEmpty();
  }

  private closeIfEmpty(): void {
    if (this.layout.tabs().length === 0) void WailsWindow.Close();
  }

  // ---------- opening ----------

  async openPaths(paths: string[]): Promise<void> {
    let res;
    try {
      res = await api.OpenPaths(paths);
    } catch (e) {
      this.statusMsg(errMessage(e), true);
      return;
    }
    this.showOpened(res);
  }

  /** Shows what OpenPaths opened: files as tabs, folders in the sidebar, errors. */
  private showOpened(res: OpenResult): void {
    for (const f of res.files ?? []) this.openFile(f, 'tab');
    if (res.folders?.length) {
      this.sidebar.show('files');
      if (!this.settings.sidebarVisible) void this.saveSettings({ sidebarVisible: true });
      this.statusMsg(`Folder added: ${res.folders.join(', ')}`);
    }
    if (res.errors?.length) this.statusMsg(res.errors.join('; '), true);
  }

  openFile(path: string, how: 'tab' | 'right' | 'below', anchor = ''): void {
    const pane = this.activePane;
    if (how === 'tab') {
      const existing = pane.tabs.find((t) => t.path === path);
      if (existing) {
        pane.active = existing.id;
        this.renderAll();
        if (anchor) this.view(existing).scrollToAnchor(anchor);
        this.focusDoc();
        return;
      }
      const tab = newTab(path, this.settings.diffMode as DiffMode);
      this.addTab(pane.id, tab);
      this.renderAll();
      this.afterOpen(tab, anchor);
      return;
    }
    const tab = newTab(path, this.settings.diffMode as DiffMode);
    const np = this.layout.split(pane.id, how === 'right' ? 'right' : 'bottom', tab);
    this.activePaneId = np.id;
    this.renderAll();
    this.afterOpen(tab, anchor);
  }

  private afterOpen(tab: Tab, anchor: string): void {
    // renderAll() has already started the render of the new view
    const v = this.view(tab);
    void v.ready().then(() => {
      if (anchor) v.scrollToAnchor(anchor);
    });
    this.focusDoc();
  }

  // DocHost
  openLink(path: string, anchor: string, split: boolean): void {
    void (async () => {
      let res;
      try {
        res = await api.OpenLink(path); // validated in Go (no network paths)
      } catch (e) {
        this.statusMsg(errMessage(e), true);
        return;
      }
      if (res.binary?.length) {
        this.openSystem(path); // not text (PDF, image, ...): system application, after confirmation
        return;
      }
      if (res.errors?.length) {
        this.statusMsg(res.errors.join('; '), true);
        return;
      }
      const f = res.files?.[0] ?? path;
      this.openFile(f, split ? 'right' : 'tab', anchor);
    })();
  }

  openExternal(url: string): void {
    api.OpenURL(url).catch((e) => this.statusMsg(errMessage(e), true));
  }

  openSystem(path: string): void {
    api.OpenWithSystem(path).catch((e) => this.statusMsg(errMessage(e), true));
  }

  rendered(view: DocView): void {
    this.updateTabClasses();
    if (view === this.activeView) {
      this.updateOutline();
      this.updateStatus();
      this.search.refresh();
    }
  }

  scrolled(view: DocView): void {
    if (view === this.activeView) this.sidebar.setCurrentHeading(view.currentHeading());
  }

  private docChanged(path: string): void {
    const visible = new Set(this.visibleViews());
    for (const { tab } of this.layout.tabs()) {
      if (tab.path !== path) continue;
      const v = this.view(tab);
      if (visible.has(v)) void v.render();
      else v.stale = true;
    }
  }

  // ---------- drag & drop ----------

  private targetPane(target: DropTarget): string {
    return target.paneId;
  }

  private placeTab(tab: Tab, target: DropTarget, existing: boolean): void {
    const paneId = this.targetPane(target);
    if ('index' in target) {
      if (existing) this.layout.moveTab(tab.id, paneId, target.index);
      else this.addTab(paneId, tab, target.index);
      this.activePaneId = this.layout.findTab(tab.id)?.pane.id ?? paneId;
    } else if (target.side === 'center') {
      if (existing) this.layout.moveTab(tab.id, paneId);
      else this.addTab(paneId, tab);
      this.activePaneId = this.layout.findTab(tab.id)?.pane.id ?? paneId;
    } else {
      const np = this.layout.split(paneId, target.side as Side, tab);
      this.activePaneId = this.layout.findTab(tab.id)?.pane.id ?? np.id;
    }
    this.renderAll();
    this.focusDoc();
  }

  dropTab(data: DragTab, target: DropTarget): void {
    if (data.windowId === this.winId) {
      const f = this.layout.findTab(data.tabId);
      if (f) this.placeTab(f.tab, target, true);
      return;
    }
    // from another window: adopt it, then tell the source to close its tab
    const tab = newTab(data.path, data.diffMode, data.scroll);
    this.placeTab(tab, target, false);
    void api.NotifyTabAdopted(data.windowId, data.tabId);
  }

  dropFile(path: string, target: DropTarget): void {
    this.placeTab(newTab(path, this.settings.diffMode as DiffMode), target, false);
  }

  dragOut(data: DragTab, screenX: number, screenY: number): void {
    void (async () => {
      try {
        await api.DetachTab({ path: data.path, diffMode: data.diffMode, scroll: data.scroll }, Math.round(screenX), Math.round(screenY));
      } catch (e) {
        this.statusMsg(errMessage(e), true);
        return;
      }
      this.tabLeft(data.tabId);
    })();
  }

  private receiveTab(e: TabReceiveEvent): void {
    const borderX = (window.outerWidth - window.innerWidth) / 2;
    const cx = e.x - window.screenX - borderX;
    const cy = e.y - window.screenY - (window.outerHeight - window.innerHeight - borderX);
    const paneId = this.workbench.paneAt(cx, cy) ?? this.activePaneId;
    const tab = newTab(e.tab.path, (e.tab.diffMode as DiffMode) || 'baseline', e.tab.scroll);
    this.addTab(paneId, tab);
    this.renderAll();
    this.focusDoc();
  }

  layoutResized(): void {
    /* sizes are kept in the layout tree */
  }

  emptyView(): HTMLElement {
    const open = h('button', { class: 'mdv-button mdv-button-primary', type: 'button', text: 'Open files…' });
    const folder = h('button', { class: 'mdv-button', type: 'button', text: 'Open folder…' });
    open.addEventListener('click', () => this.run('open-file', null));
    folder.addEventListener('click', () => this.run('open-folder', null));
    return h(
      'div',
      { class: 'mdv-empty' },
      h('div', { class: 'mdv-empty-title', text: 'mdview' }),
      h('div', { class: 'mdv-empty-actions' }, open, folder),
      h('div', {
        class: 'mdv-empty-hint',
        text: 'Drop Markdown / text files or folders here, or pick one from the sidebar. Press F1 for key bindings.',
      }),
    );
  }

  // ---------- menus ----------

  tabMenu(tab: Tab, x: number, y: number): void {
    const items: MenuItem[] = [
      { label: 'Close', run: () => this.closeTab(tab.id) },
      { label: 'Close others', run: () => this.closeOthers(tab.id) },
      '-',
      { label: 'Reload', run: () => this.reloadTab(tab) },
      '-',
      { label: 'Split right', run: () => this.splitTab(tab, 'right') },
      { label: 'Split down', run: () => this.splitTab(tab, 'bottom') },
      { label: 'Move to new window', run: () => this.dragOut(this.dragData(tab), window.screenX + 60, window.screenY + 60) },
      '-',
      { label: 'Open in editor', run: () => this.openEditor(tab) },
      { label: 'Copy path', run: () => void navigator.clipboard.writeText(tab.path) },
    ];
    showMenu(items, x, y);
  }

  selectionMenu(view: DocView, text: string, x: number, y: number): void {
    const query = selectionQuery(text);
    const items: MenuItem[] = [
      { label: 'Copy', run: () => void navigator.clipboard.writeText(text).catch((e) => this.statusMsg(errMessage(e), true)) },
    ];
    if (query) {
      items.push(
        '-',
        {
          label: 'Find in document',
          run: () => {
            const f = this.layout.findTab(view.tab.id);
            if (f) this.activatePane(f.pane.id);
            this.search.searchFor(query);
          },
        },
        {
          label: 'Search in all files',
          run: () => {
            if (!this.settings.sidebarVisible) void this.saveSettings({ sidebarVisible: true });
            this.sidebar.grepFor(query);
          },
        },
      );
    }
    showMenu(items, x, y);
  }

  /** Re-reads the tab's file from disk and renders it again (also refreshes images). */
  private reloadTab(tab: Tab): void {
    void api.Reload(tab.path);
    const v = this.view(tab);
    if (this.visibleViews().includes(v)) void v.render();
    else v.stale = true;
  }

  private dragData(tab: Tab): DragTab {
    return { windowId: this.winId, tabId: tab.id, path: tab.path, diffMode: tab.diffMode, scroll: tab.scroll };
  }

  private closeOthers(tabId: string): void {
    const f = this.layout.findTab(tabId);
    if (!f) return;
    for (const t of [...f.pane.tabs]) if (t.id !== tabId) this.layout.removeTab(t.id);
    this.renderAll();
  }

  openInPane(paneId: string, what: 'file' | 'folder'): void {
    this.activatePane(paneId);
    this.run(what === 'file' ? 'open-file' : 'open-folder', null);
  }

  recentMenu(paneId: string, what: 'file' | 'folder', x: number, y: number, button: HTMLElement): void {
    const list = (what === 'file' ? this.recent.files : this.recent.folders) ?? [];
    const items: MenuItem[] = list.length
      ? list.map((p) => ({
          label: basename(p),
          detail: what === 'file' ? dirname(p) : p,
          title: p,
          run: () => {
            this.activatePane(paneId);
            void api.OpenRecent(p).then(
              (r) => this.handleOpenResult(r),
              (e) => this.statusMsg(errMessage(e), true),
            );
          },
        }))
      : [{ label: what === 'file' ? 'No recent files' : 'No recent folders', disabled: true, run: () => {} }];
    button.classList.add('is-active');
    showMenu(items, x, y, () => button.classList.remove('is-active'));
  }

  splitPane(paneId: string, side: 'right' | 'bottom'): void {
    const p = this.layout.pane(paneId);
    const t = p?.tabs.find((x) => x.id === p.active);
    if (t) this.splitTab(t, side);
    this.focusDoc();
  }

  private splitTab(tab: Tab, side: Side): void {
    const f = this.layout.findTab(tab.id);
    if (!f) return;
    // keep the tab where it is when it is the pane's only tab: split a copy
    const moving = f.pane.tabs.length > 1 ? tab : newTab(tab.path, tab.diffMode, tab.scroll);
    const np = this.layout.split(f.pane.id, side, moving);
    this.activePaneId = np.id;
    this.renderAll();
  }

  fileMenu(item: FileItem, x: number, y: number): void {
    const items: MenuItem[] = [
      { label: 'Open', run: () => this.openFile(item.path, 'tab') },
      { label: 'Open to the right', run: () => this.openFile(item.path, 'right') },
      { label: 'Open below', run: () => this.openFile(item.path, 'below') },
      { label: 'Open in new window', run: () => void api.DetachTab({ path: item.path, diffMode: this.settings.diffMode, scroll: 0 }, window.screenX + 60, window.screenY + 60) },
      '-',
      { label: 'Open in editor', run: () => void api.OpenInEditor(item.path, 1).catch((e) => this.statusMsg(errMessage(e), true)) },
      { label: 'Copy path', run: () => void navigator.clipboard.writeText(item.path) },
      '-',
    ];
    if (item.root) items.push({ label: `Remove folder ${basename(item.root)}`, run: () => void api.RemoveFromList(item.root) });
    else items.push({ label: 'Remove from list', run: () => void api.RemoveFromList(item.path) });
    showMenu(items, x, y);
  }

  folderMenu(dir: string, root: string, x: number, y: number): void {
    const items: MenuItem[] = [{ label: 'Copy path', run: () => void navigator.clipboard.writeText(dir) }];
    if (root) items.push({ label: `Remove folder ${basename(root)}`, run: () => void api.RemoveFromList(root) });
    showMenu(items, x, y);
  }

  jumpHeading(index: number): void {
    const v = this.activeView;
    const hd = v?.headings[index];
    if (v && hd) {
      v.scrollToAnchor(hd.id);
      this.sidebar.setCurrentHeading(index);
      this.focusDoc();
    }
  }

  /** Opens a grep result: the file, scrolled to the block of the line. */
  grepOpen(path: string, line: number, split: boolean): void {
    const pane = this.activePane;
    const existing = pane.tabs.find((t) => t.path === path);
    this.openFile(path, split ? 'right' : 'tab');
    const tab = split ? this.activeTab : (existing ?? this.activeTab);
    if (!tab) return;
    const v = this.view(tab);
    void v.ready().then(() => v.scrollToLine(line));
  }

  tabChanged(tab: 'files' | 'outline' | 'search'): void {
    void this.saveSettings({ sidebarTab: tab });
  }

  resized(width: number): void {
    void this.saveSettings({ sidebarWidth: width });
  }

  // ---------- misc ----------

  status(msg: string, error = false): void {
    this.statusMsg(msg, error);
  }

  statusMsg(msg: string, error = false): void {
    this.sb.message.textContent = msg;
    this.sb.message.classList.toggle('is-error', error);
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => (this.sb.message.textContent = ''), error ? 8000 : 3000);
  }

  focusDoc(force = false): void {
    if (!force && this.search.isOpen && document.activeElement === this.search.input) return;
    this.activeView?.el.focus({ preventScroll: true });
  }

  private openEditor(tab: Tab | undefined = this.activeTab): void {
    if (!tab) return;
    const line = tab === this.activeTab ? (this.activeView?.topLine() ?? 1) : 1;
    api.OpenInEditor(tab.path, line).catch((e) => this.statusMsg(errMessage(e), true));
  }

  private async exportCSS(): Promise<void> {
    try {
      const p = await api.ExportCSS(builtinCSS);
      if (p) this.statusMsg(`Stylesheet template saved: ${p}`);
    } catch (e) {
      this.statusMsg(errMessage(e), true);
    }
  }

  // ---------- keys and commands ----------

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing) return;
    if (isDialogOpen()) return;
    if (isEditableTarget(e.target)) return; // the search box handles its own keys
    const r = this.keys.handle(e);
    if (!r) return;
    if (r.cmd === 'count') {
      e.preventDefault();
      this.statusMsg(`${r.count}`);
      return;
    }
    e.preventDefault();
    if (r.cmd === 'goto-tab') {
      this.gotoTab(Number(e.key));
      return;
    }
    this.run(r.cmd, r.count);
  }

  /** Ctrl+1..8: the tab at that position in the active pane; Ctrl+9: the last tab. */
  private gotoTab(n: number): void {
    const tabs = this.activePane.tabs;
    if (!tabs.length || !(n >= 1 && n <= 9)) return;
    const t = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (t) this.activateTab(t.id);
  }

  run(cmd: string, count: number | null): void {
    const v = this.activeView;
    const n = count ?? 1;
    const line = () => (v ? parseFloat(getComputedStyle(v.content).fontSize) * 1.7 : 24);
    const page = () => (v ? v.el.clientHeight * 0.9 : 0);
    const by = (dy: number) => v?.el.scrollBy({ top: dy });
    closeMenu();
    switch (cmd) {
      case 'line-down': return void by(line() * n);
      case 'line-up': return void by(-line() * n);
      case 'page-down': return void by(page() * n);
      case 'page-up': return void by(-page() * n);
      case 'half-down': return void by((page() / 2) * n);
      case 'half-up': return void by((-page() / 2) * n);
      case 'top':
      case 'bottom':
        if (!v) return;
        if (count !== null) {
          // less: Ng / NG go to line N (text: the line; Markdown: its block)
          const shown = v.scrollToLine(count);
          this.statusMsg(shown === count ? `Line ${count}` : `Line ${count} (showing ${shown})`);
          return;
        }
        v.el.scrollTop = cmd === 'top' ? 0 : v.el.scrollHeight;
        return;
      case 'percent':
        if (v) v.el.scrollTop = ((v.el.scrollHeight - v.el.clientHeight) * Math.min(100, count ?? 0)) / 100;
        return;
      case 'left':
      case 'right': {
        if (!v) return;
        const dx = (cmd === 'left' ? -40 : 40) * n;
        v.el.querySelectorAll('pre, table').forEach((x) => (x as HTMLElement).scrollBy({ left: dx }));
        v.el.scrollBy({ left: dx }); // the whole document (text file without wrapping)
        return;
      }
      case 'toggle-wrap': {
        const wrap = !this.settings.wrapText;
        // applied synchronously (saveSettings applies before saving)
        const apply = () => void this.saveSettings({ wrapText: wrap });
        if (v) v.keepPosition(apply);
        else apply();
        if (wrap) this.visibleViews().forEach((x) => (x.el.scrollLeft = 0));
        this.statusMsg(wrap ? 'Text files: wrap long lines' : 'Text files: no wrapping (scroll horizontally)');
        return;
      }
      case 'next-heading': for (let i = 0; i < n; i++) v?.jumpHeading(1); return;
      case 'prev-heading': for (let i = 0; i < n; i++) v?.jumpHeading(-1); return;
      case 'search': return this.search.open(false, false);
      case 'search-back': return this.search.open(true, false);
      case 'search-regex': return this.search.open(false, true);
      case 'search-next': return this.search.step(1, true);
      case 'search-prev': return this.search.step(-1, true);
      case 'next-change': return v?.nextChange(1);
      case 'prev-change': return v?.nextChange(-1);
      case 'toggle-diff': {
        // off <-> the most recently used diff mode
        const t = this.activeTab;
        if (!t) return;
        if (t.diffMode !== 'off') this.setDiffMode(t, 'off');
        else {
          const fallback = this.settings.diffMode !== 'off' ? (this.settings.diffMode as DiffMode) : 'baseline';
          this.setDiffMode(t, t.lastDiffMode ?? fallback);
        }
        return;
      }
      case 'quit': return void api.Quit();
      case 'toggle-search-panel':
        if (!this.settings.sidebarVisible) void this.saveSettings({ sidebarVisible: true });
        this.sidebar.show('search');
        this.sidebar.focusGrep();
        return;
      case 'set-baseline': {
        const t = this.activeTab;
        if (t) {
          void api.SetBaseline(t.path);
          this.statusMsg('Baseline set to the current content');
        }
        return;
      }
      case 'reload': {
        const t = this.activeTab;
        if (t) this.reloadTab(t);
        return;
      }
      case 'editor': return this.openEditor();
      case 'info': {
        const t = this.activeTab;
        if (t && v) {
          const pct = Math.round((v.el.scrollTop / Math.max(1, v.el.scrollHeight - v.el.clientHeight)) * 100);
          this.statusMsg(`${t.path} — ${pct}% — ${v.headings.length} headings — ${diffLabel[t.diffMode]} (${v.changes})`);
        }
        return;
      }
      case 'close-tab': {
        const t = this.activeTab;
        if (t) this.closeTab(t.id);
        return;
      }
      case 'next-tab':
      case 'prev-tab': {
        const p = this.activePane;
        if (p.tabs.length < 2) return;
        const i = p.tabs.findIndex((t) => t.id === p.active);
        const d = cmd === 'next-tab' ? n : -n;
        this.activateTab(p.tabs[(((i + d) % p.tabs.length) + p.tabs.length) % p.tabs.length].id);
        return;
      }
      case 'split-right':
      case 'split-down': {
        const t = this.activeTab;
        if (t) this.splitTab(t, cmd === 'split-right' ? 'right' : 'bottom');
        return;
      }
      case 'focus-next-pane':
      case 'focus-prev-pane': {
        const ps = this.layout.panes();
        const i = ps.findIndex((p) => p.id === this.activePaneId);
        const np = ps[(i + (cmd === 'focus-next-pane' ? 1 : -1) + ps.length) % ps.length];
        this.activatePane(np.id);
        this.focusDoc();
        return;
      }
      case 'toggle-sidebar': return void this.saveSettings({ sidebarVisible: !this.settings.sidebarVisible });
      case 'toggle-outline':
        if (!this.settings.sidebarVisible) void this.saveSettings({ sidebarVisible: true });
        // files -> outline -> search -> files (focus stays on the document)
        this.sidebar.show(({ files: 'outline', outline: 'search', search: 'files' } as const)[this.sidebar.tab]);
        return;
      case 'open-file':
        void api.OpenFileDialog().then((r) => this.handleOpenResult(r), (e) => this.statusMsg(errMessage(e), true));
        return;
      case 'open-folder':
        void api.OpenFolderDialog().then((r) => this.handleOpenResult(r), (e) => this.statusMsg(errMessage(e), true));
        return;
      case 'new-window': return void api.OpenNewWindow();
      case 'zoom-in': return this.zoomBy(10 * n);
      case 'zoom-out': return this.zoomBy(-10 * n);
      case 'zoom-reset': return void this.saveSettings({ zoom: 100 });
      case 'wider':
      case 'narrower': {
        const cur = this.settings.contentMaxWidth || (v ? v.el.clientWidth : 1200);
        const next = cmd === 'wider' ? cur + 80 * n : Math.max(320, cur - 80 * n);
        const full = v && next >= v.el.clientWidth;
        void this.saveSettings({ contentMaxWidth: full ? 0 : next });
        this.statusMsg(full ? 'Text width: full' : `Text width: ${next}px`);
        return;
      }
      case 'settings': return openSettings(this.settings, () => void this.exportCSS(), (m, err) => this.statusMsg(m, err));
      case 'help': return openHelp();
      case 'escape':
        this.keys.reset();
        if (this.search.isOpen) this.search.close();
        this.sb.message.textContent = '';
        return;
    }
  }

  private handleOpenResult(r: { files: string[] | null; folders: string[] | null; errors: string[] | null }): void {
    for (const f of r.files ?? []) this.openFile(f, 'tab');
    if (r.folders?.length) {
      this.sidebar.show('files');
      if (!this.settings.sidebarVisible) void this.saveSettings({ sidebarVisible: true });
    }
    if (r.errors?.length) this.statusMsg(r.errors.join('; '), true);
  }
}

installNavigationGuard();
const controller = new Controller();
void controller.start().catch((e) => {
  document.body.textContent = `mdview failed to start: ${errMessage(e)}`;
});
