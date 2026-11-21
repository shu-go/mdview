// Sidebar: shared file list grouped by directory, and the outline of the
// active document.
import type { FileItem, Heading, Snapshot } from './api';
import { MIME_FILE } from './workbench';
import { h } from './util';

export interface SidebarHost {
  openFile(path: string, how: 'tab' | 'right' | 'below'): void;
  fileMenu(item: FileItem, x: number, y: number): void;
  folderMenu(dir: string, root: string, x: number, y: number): void;
  jumpHeading(index: number): void;
  tabChanged(tab: 'files' | 'outline'): void;
  resized(width: number): void;
}

const COLLAPSED_KEY = 'mdview.collapsedDirs';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export class Sidebar {
  readonly el: HTMLElement;
  readonly resizer: HTMLElement;
  private filesTab: HTMLButtonElement;
  private outlineTab: HTMLButtonElement;
  private files: HTMLElement;
  private outline: HTMLElement;
  private collapsed = loadCollapsed();
  private snapshot: Snapshot = { folders: [], files: [] };
  private activePath = '';
  private openPaths = new Set<string>();
  private headings: Heading[] = [];
  private current = -1;
  private maxLevel = 6;
  tab: 'files' | 'outline' = 'files';

  constructor(private host: SidebarHost) {
    this.filesTab = h('button', { class: 'mdv-sidebar-tab', type: 'button', text: 'Files' });
    this.outlineTab = h('button', { class: 'mdv-sidebar-tab', type: 'button', text: 'Outline' });
    this.files = h('div', { class: 'mdv-sidebar-files' });
    this.outline = h('div', { class: 'mdv-sidebar-outline' });
    this.el = h('aside', { class: 'mdv-sidebar' }, h('div', { class: 'mdv-sidebar-tabs' }, this.filesTab, this.outlineTab), this.files, this.outline);
    this.resizer = h('div', { class: 'mdv-sidebar-resizer' });
    this.filesTab.addEventListener('click', () => this.show('files'));
    this.outlineTab.addEventListener('click', () => this.show('outline'));
    this.initResize();
    this.show('files', false);
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle('is-hidden', !v);
  }

  show(tab: 'files' | 'outline', notify = true): void {
    this.tab = tab;
    this.filesTab.classList.toggle('is-active', tab === 'files');
    this.outlineTab.classList.toggle('is-active', tab === 'outline');
    this.files.classList.toggle('is-hidden', tab !== 'files');
    this.outline.classList.toggle('is-hidden', tab !== 'outline');
    if (notify) this.host.tabChanged(tab);
  }

  setWidth(px: number): void {
    document.documentElement.style.setProperty('--mdv-sidebar-width', `${px}px`);
  }

  private initResize(): void {
    this.resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.resizer.setPointerCapture(e.pointerId);
      this.resizer.classList.add('is-active');
      const startX = e.clientX;
      const startW = this.el.getBoundingClientRect().width;
      let w = startW;
      const move = (ev: PointerEvent) => {
        w = Math.max(120, Math.min(window.innerWidth * 0.7, startW + ev.clientX - startX));
        this.setWidth(Math.round(w));
      };
      const up = () => {
        this.resizer.classList.remove('is-active');
        this.resizer.removeEventListener('pointermove', move);
        this.resizer.removeEventListener('pointerup', up);
        this.host.resized(Math.round(w));
      };
      this.resizer.addEventListener('pointermove', move);
      this.resizer.addEventListener('pointerup', up);
    });
  }

  setFiles(s: Snapshot): void {
    this.snapshot = s;
    this.renderFiles();
  }

  setActive(path: string, open: Iterable<string>): void {
    this.activePath = path;
    this.openPaths = new Set(open);
    this.files.querySelectorAll<HTMLElement>('.mdv-sidebar-files-item').forEach((li) => {
      li.classList.toggle('is-active', li.dataset.path === path);
      li.classList.toggle('is-open', this.openPaths.has(li.dataset.path ?? ''));
    });
  }

  private renderFiles(): void {
    const s = this.snapshot;
    if (!s.files?.length) {
      this.files.replaceChildren(
        h('div', { class: 'mdv-sidebar-empty', text: 'No files. Open files or a folder (Ctrl+O / Ctrl+Shift+O), or drop them on the window.' }),
      );
      return;
    }
    const groups = new Map<string, FileItem[]>();
    for (const f of s.files) {
      const g = groups.get(f.dir);
      if (g) g.push(f);
      else groups.set(f.dir, [f]);
    }
    const out: HTMLElement[] = [];
    for (const [dir, items] of groups) {
      const root = items.find((i) => i.root)?.root ?? '';
      const title = h(
        'div',
        { class: 'mdv-sidebar-files-group-title', title: dir },
        h('span', { class: 'mdv-sidebar-files-group-toggle' }),
        h('span', { class: 'mdv-sidebar-files-group-name', text: dir }),
      );
      const list = h('ul', { class: 'mdv-sidebar-files-list' });
      for (const it of items) {
        const cls = ['mdv-sidebar-files-item'];
        if (it.path === this.activePath) cls.push('is-active');
        if (this.openPaths.has(it.path)) cls.push('is-open');
        if (it.missing) cls.push('is-missing');
        const li = h('li', { class: cls.join(' '), title: it.path, draggable: 'true', 'data-path': it.path, text: it.name });
        li.addEventListener('click', (e) => this.host.openFile(it.path, e.ctrlKey || e.metaKey ? 'right' : 'tab'));
        li.addEventListener('auxclick', (e) => {
          if (e.button === 1) this.host.openFile(it.path, 'right');
        });
        li.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.host.fileMenu(it, e.clientX, e.clientY);
        });
        li.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(MIME_FILE, it.path);
          e.dataTransfer?.setData('text/plain', it.path);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
        });
        list.append(li);
      }
      const group = h('div', { class: `mdv-sidebar-files-group${this.collapsed.has(dir) ? ' is-collapsed' : ''}` }, title, list);
      title.addEventListener('click', () => {
        group.classList.toggle('is-collapsed');
        if (group.classList.contains('is-collapsed')) this.collapsed.add(dir);
        else this.collapsed.delete(dir);
        try {
          localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...this.collapsed]));
        } catch {
          /* ignore */
        }
      });
      title.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.host.folderMenu(dir, root, e.clientX, e.clientY);
      });
      out.push(group);
    }
    this.files.replaceChildren(...out);
  }

  setOutline(headings: Heading[], maxLevel: number): void {
    this.headings = headings;
    this.maxLevel = maxLevel;
    this.current = -1;
    this.renderOutline();
  }

  private renderOutline(): void {
    const items = this.headings
      .map((hd, i) => ({ hd, i }))
      .filter(({ hd }) => hd.level <= this.maxLevel);
    if (!items.length) {
      this.outline.replaceChildren(h('div', { class: 'mdv-sidebar-empty', text: 'No headings.' }));
      return;
    }
    const list = h('ul', { class: 'mdv-sidebar-outline-list' });
    for (const { hd, i } of items) {
      const li = h('li', {
        class: `mdv-sidebar-outline-item mdv-sidebar-outline-level-${hd.level}${i === this.current ? ' is-current' : ''}`,
        title: hd.text,
        'data-index': String(i),
        text: hd.text,
      });
      li.addEventListener('click', () => this.host.jumpHeading(i));
      list.append(li);
    }
    this.outline.replaceChildren(list);
  }

  setCurrentHeading(i: number): void {
    if (i === this.current) return;
    this.current = i;
    let cur: HTMLElement | null = null;
    this.outline.querySelectorAll<HTMLElement>('.mdv-sidebar-outline-item').forEach((li) => {
      const on = Number(li.dataset.index) === i;
      li.classList.toggle('is-current', on);
      if (on) cur = li;
    });
    // keep the current heading visible
    const c = cur as HTMLElement | null;
    if (c) {
      const r = c.getBoundingClientRect();
      const o = this.outline.getBoundingClientRect();
      if (r.top < o.top || r.bottom > o.bottom) c.scrollIntoView({ block: 'nearest' });
    }
  }
}
