import { describe, expect, it } from 'vitest';
import { Layout, newTab, type LayoutNode } from './layout';

function shape(n: LayoutNode): unknown {
  if (n.kind === 'pane') return n.tabs.map((t) => t.path);
  return { [n.dir]: n.children.map(shape) };
}

describe('Layout', () => {
  it('adds tabs after the active one', () => {
    const l = new Layout();
    const p = l.panes()[0];
    const a = newTab('a', 'off');
    const b = newTab('b', 'off');
    const c = newTab('c', 'off');
    l.addTab(p.id, a);
    l.addTab(p.id, b);
    p.active = a.id;
    l.addTab(p.id, c);
    expect(shape(l.root)).toEqual(['a', 'c', 'b']);
    expect(p.active).toBe(c.id);
  });

  it('activates the neighbour when the active tab is removed, keeps the lone root pane', () => {
    const l = new Layout();
    const p = l.panes()[0];
    const a = newTab('a', 'off');
    const b = newTab('b', 'off');
    l.addTab(p.id, a);
    l.addTab(p.id, b);
    l.removeTab(b.id);
    expect(p.active).toBe(a.id);
    l.removeTab(a.id);
    expect(l.root).toBe(p);
    expect(p.active).toBeNull();
  });

  it('splits and collapses back', () => {
    const l = new Layout();
    const p = l.panes()[0];
    const a = newTab('a', 'off');
    const b = newTab('b', 'off');
    l.addTab(p.id, a);
    l.addTab(p.id, b);
    const np = l.split(p.id, 'right', b);
    expect(shape(l.root)).toEqual({ row: [['a'], ['b']] });
    // split the new pane downward with a new tab
    const c = newTab('c', 'off');
    l.split(np.id, 'bottom', c);
    expect(shape(l.root)).toEqual({ row: [['a'], { column: [['b'], ['c']] }] });
    // same-direction split is merged into the parent
    const d = newTab('d', 'off');
    l.split(p.id, 'left', d);
    expect(shape(l.root)).toEqual({ row: [['d'], ['a'], { column: [['b'], ['c']] }] });
    const sizes = (l.root as { sizes: number[] }).sizes;
    expect(sizes.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
    // moving the last tab out of a pane removes it and normalises
    l.moveTab(c.id, p.id);
    expect(shape(l.root)).toEqual({ row: [['d'], ['a', 'c'], ['b']] });
    l.removeTab(d.id);
    l.removeTab(b.id);
    expect(shape(l.root)).toEqual(['a', 'c']);
  });

  it('reorders within a pane', () => {
    const l = new Layout();
    const p = l.panes()[0];
    const ts = ['a', 'b', 'c', 'd'].map((x) => newTab(x, 'off'));
    ts.forEach((t) => l.addTab(p.id, t, p.tabs.length));
    l.moveTab(ts[0].id, p.id, 3); // drop before 'd'
    expect(shape(l.root)).toEqual(['b', 'c', 'a', 'd']);
    l.moveTab(ts[3].id, p.id, 0);
    expect(shape(l.root)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('splitting a pane with its only tab keeps a valid tree', () => {
    const l = new Layout();
    const p = l.panes()[0];
    const a = newTab('a', 'off');
    l.addTab(p.id, a);
    l.split(p.id, 'right', a);
    expect(shape(l.root)).toEqual(['a']);
    expect(l.panes()).toHaveLength(1);
  });
});
