// Pane layout model: a tree of splits whose leaves are panes holding tabs.
// All functions are pure-ish: they mutate the given tree in place and keep it
// normalised (no empty panes except a lone root, no single-child splits,
// no nested splits in the same direction).

export type DiffMode = 'baseline' | 'initial' | 'off';

export interface Tab {
  id: string;
  path: string;
  diffMode: DiffMode;
  scroll: number;
  /** last diff mode other than 'off' (for toggling) */
  lastDiffMode?: DiffMode;
}

export interface PaneNode {
  kind: 'pane';
  id: string;
  tabs: Tab[];
  active: string | null; // tab id
}

export interface SplitNode {
  kind: 'split';
  id: string;
  dir: 'row' | 'column'; // row = side by side, column = stacked
  children: LayoutNode[];
  sizes: number[]; // fractions summing to 1
}

export type LayoutNode = PaneNode | SplitNode;
export type Side = 'left' | 'right' | 'top' | 'bottom';

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export function newPane(tabs: Tab[] = []): PaneNode {
  return { kind: 'pane', id: newId('p'), tabs, active: tabs.length ? tabs[tabs.length - 1].id : null };
}

export function newTab(path: string, diffMode: DiffMode, scroll = 0): Tab {
  return { id: newId('t'), path, diffMode, scroll };
}

export class Layout {
  root: LayoutNode;

  constructor(root?: LayoutNode) {
    this.root = root ?? newPane();
  }

  panes(): PaneNode[] {
    const out: PaneNode[] = [];
    const walk = (n: LayoutNode) => {
      if (n.kind === 'pane') out.push(n);
      else n.children.forEach(walk);
    };
    walk(this.root);
    return out;
  }

  pane(id: string): PaneNode | undefined {
    return this.panes().find((p) => p.id === id);
  }

  tabs(): { pane: PaneNode; tab: Tab }[] {
    return this.panes().flatMap((pane) => pane.tabs.map((tab) => ({ pane, tab })));
  }

  findTab(tabId: string): { pane: PaneNode; tab: Tab; index: number } | undefined {
    for (const pane of this.panes()) {
      const index = pane.tabs.findIndex((t) => t.id === tabId);
      if (index >= 0) return { pane, tab: pane.tabs[index], index };
    }
    return undefined;
  }

  parentOf(node: LayoutNode): SplitNode | undefined {
    const walk = (n: LayoutNode): SplitNode | undefined => {
      if (n.kind !== 'split') return undefined;
      if (n.children.includes(node)) return n;
      for (const c of n.children) {
        const r = walk(c);
        if (r) return r;
      }
      return undefined;
    };
    return walk(this.root);
  }

  /** Adds a tab to a pane at index (default: after the active tab) and activates it. */
  addTab(paneId: string, tab: Tab, index?: number): void {
    const pane = this.pane(paneId);
    if (!pane) throw new Error(`no pane ${paneId}`);
    if (index === undefined) {
      const ai = pane.tabs.findIndex((t) => t.id === pane.active);
      index = ai >= 0 ? ai + 1 : pane.tabs.length;
    }
    index = Math.max(0, Math.min(index, pane.tabs.length));
    pane.tabs.splice(index, 0, tab);
    pane.active = tab.id;
  }

  /** Removes a tab. Returns the pane it was in (may have been removed). */
  removeTab(tabId: string): PaneNode | undefined {
    const f = this.findTab(tabId);
    if (!f) return undefined;
    const { pane, index } = f;
    pane.tabs.splice(index, 1);
    if (pane.active === tabId) {
      const next = pane.tabs[Math.min(index, pane.tabs.length - 1)];
      pane.active = next ? next.id : null;
    }
    if (pane.tabs.length === 0) this.removePane(pane);
    return pane;
  }

  /** Moves a tab to a pane at index. */
  moveTab(tabId: string, toPaneId: string, index?: number): void {
    const f = this.findTab(tabId);
    if (!f) return;
    const target = this.pane(toPaneId);
    if (!target) return;
    if (f.pane === target) {
      // reorder within the pane
      const tabs = target.tabs;
      tabs.splice(f.index, 1);
      let i = index ?? tabs.length;
      if (index !== undefined && index > f.index) i -= 1;
      i = Math.max(0, Math.min(i, tabs.length));
      tabs.splice(i, 0, f.tab);
      target.active = f.tab.id;
      return;
    }
    f.pane.tabs.splice(f.index, 1);
    if (f.pane.active === tabId) {
      const next = f.pane.tabs[Math.min(f.index, f.pane.tabs.length - 1)];
      f.pane.active = next ? next.id : null;
    }
    this.addTab(target.id, f.tab, index);
    if (f.pane.tabs.length === 0) this.removePane(f.pane);
  }

  /**
   * Splits pane `paneId`, putting `tab` (moved from wherever it is, or new)
   * into a new pane on `side`. Returns the new pane.
   */
  split(paneId: string, side: Side, tab: Tab): PaneNode {
    const pane = this.pane(paneId);
    if (!pane) throw new Error(`no pane ${paneId}`);
    const existing = this.findTab(tab.id);
    if (existing) {
      existing.pane.tabs.splice(existing.index, 1);
      if (existing.pane.active === tab.id) {
        const next = existing.pane.tabs[Math.min(existing.index, existing.pane.tabs.length - 1)];
        existing.pane.active = next ? next.id : null;
      }
    }
    const np = newPane([tab]);
    const dir: SplitNode['dir'] = side === 'left' || side === 'right' ? 'row' : 'column';
    const before = side === 'left' || side === 'top';
    const parent = this.parentOf(pane);
    if (parent && parent.dir === dir) {
      const i = parent.children.indexOf(pane);
      const share = parent.sizes[i] / 2;
      parent.sizes[i] = share;
      parent.children.splice(before ? i : i + 1, 0, np);
      parent.sizes.splice(before ? i : i + 1, 0, share);
    } else {
      const split: SplitNode = {
        kind: 'split',
        id: newId('s'),
        dir,
        children: before ? [np, pane] : [pane, np],
        sizes: [0.5, 0.5],
      };
      this.replace(pane, split);
    }
    if (existing && existing.pane.tabs.length === 0 && existing.pane !== pane) this.removePane(existing.pane);
    else if (existing && existing.pane === pane && pane.tabs.length === 0) this.removePane(pane);
    return np;
  }

  private replace(node: LayoutNode, by: LayoutNode): void {
    if (this.root === node) {
      this.root = by;
      return;
    }
    const parent = this.parentOf(node);
    if (!parent) return;
    parent.children[parent.children.indexOf(node)] = by;
  }

  /** Removes an (empty) pane, unless it is the only one. */
  removePane(pane: PaneNode): void {
    if (this.root === pane) return;
    const parent = this.parentOf(pane);
    if (!parent) return;
    const i = parent.children.indexOf(pane);
    const freed = parent.sizes[i];
    parent.children.splice(i, 1);
    parent.sizes.splice(i, 1);
    const n = parent.sizes.length;
    if (n > 0) {
      const j = Math.min(i, n - 1);
      parent.sizes[j] += freed;
    }
    this.normalize();
  }

  /** Collapses single-child splits and merges same-direction nested splits. */
  normalize(): void {
    const fix = (n: LayoutNode): LayoutNode => {
      if (n.kind === 'pane') return n;
      const children: LayoutNode[] = [];
      const sizes: number[] = [];
      n.children.forEach((c, i) => {
        const fc = fix(c);
        if (fc.kind === 'split' && fc.dir === n.dir) {
          fc.children.forEach((cc, j) => {
            children.push(cc);
            sizes.push(n.sizes[i] * fc.sizes[j]);
          });
        } else {
          children.push(fc);
          sizes.push(n.sizes[i]);
        }
      });
      if (children.length === 1) return children[0];
      const total = sizes.reduce((a, b) => a + b, 0) || 1;
      n.children = children;
      n.sizes = sizes.map((s) => s / total);
      return n;
    };
    this.root = fix(this.root);
  }
}
