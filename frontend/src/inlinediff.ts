// Inline (word / character) diff inside changed blocks.
//
// The Go side marks changed top-level blocks: a removed block (.mdv-diff-del,
// rendered from the base) followed by the new block (.mdv-diff-ins). Here a
// removed block and a new block of the same kind are paired, their text is
// compared, and the new block is decorated in place: added text wrapped in
// <ins class="mdv-diff-word-ins">, removed text inserted as
// <del class="mdv-diff-word-del">. The removed block is then dropped.
// Only text nodes are touched, so markup (bold, links, highlighting) stays.
import { diffArrays } from 'diff';

export type DiffDetail = 'word' | 'char' | 'block';

/** Pairs whose text is less similar than this stay as whole blocks. */
export const MIN_SIMILARITY = 0.4;

let segmenter: Intl.Segmenter | null | undefined;

/** Splits text into word-like tokens (also for Japanese) or characters. */
export function tokenize(text: string, detail: 'word' | 'char'): string[] {
  if (detail === 'char') return Array.from(text);
  if (segmenter === undefined) {
    try {
      segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch {
      segmenter = null;
    }
  }
  if (!segmenter) return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/**
 * Elements whose direct text children are only formatting whitespace: marks
 * placed there (e.g. <ins> directly in a <tr>) would break the table / list
 * layout, so that text is not compared.
 */
const structural = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'ul', 'ol', 'dl', 'details']);

/** Text nodes of a block, skipping UI parts and diagrams. */
function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walk = (n: Node) => {
    const skipText = n.nodeType === Node.ELEMENT_NODE && structural.has((n as Element).tagName.toLowerCase());
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.TEXT_NODE) {
        if ((c as Text).data && !skipText) out.push(c as Text);
      } else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === 'svg' || tag === 'script' || tag === 'style' || el.classList.contains('mdv-code-header')) continue;
        walk(el);
      }
    }
  };
  walk(root);
  return out;
}

export interface TextEdit {
  inserts: [number, number][]; // ranges in the new text
  deletes: { at: number; text: string }[]; // removed text, at an offset of the new text
  similarity: number; // 0..1 (share of unchanged text)
}

/** Compares two texts token by token. */
export function textEdit(oldText: string, newText: string, detail: 'word' | 'char'): TextEdit {
  const parts = diffArrays(tokenize(oldText, detail), tokenize(newText, detail));
  const edit: TextEdit = { inserts: [], deletes: [], similarity: 1 };
  let pos = 0;
  let same = 0;
  for (const p of parts) {
    const text = p.value.join('');
    if (p.added) {
      edit.inserts.push([pos, pos + text.length]);
      pos += text.length;
    } else if (p.removed) {
      edit.deletes.push({ at: pos, text });
    } else {
      same += text.length;
      pos += text.length;
    }
  }
  const total = oldText.length + newText.length;
  edit.similarity = total === 0 ? 1 : (2 * same) / total;
  return edit;
}

function delElement(text: string): HTMLElement {
  const d = document.createElement('del');
  d.className = 'mdv-diff-word-del';
  d.textContent = text;
  return d;
}

/** Decorates the text nodes of root with an edit computed against their text. */
function decorate(root: Element, nodes: Text[], edit: TextEdit): void {
  let off = 0;
  let di = 0; // next deletion
  let lastPiece: ChildNode | null = null;
  const inInsert = (p: number) => edit.inserts.some(([s, e]) => p >= s && p < e);
  for (const node of nodes) {
    const text = node.data;
    const end = off + text.length;
    // cut points inside this node
    const cuts = new Set<number>([off, end]);
    for (const [s, e] of edit.inserts) {
      if (s > off && s < end) cuts.add(s);
      if (e > off && e < end) cuts.add(e);
    }
    for (const d of edit.deletes) if (d.at > off && d.at < end) cuts.add(d.at);
    const points = [...cuts].sort((a, b) => a - b);
    const frag = document.createDocumentFragment();
    for (let i = 0; i + 1 < points.length; i++) {
      const s = points[i];
      const e = points[i + 1];
      while (di < edit.deletes.length && edit.deletes[di].at === s) {
        frag.append(delElement(edit.deletes[di].text));
        di++;
      }
      const piece = text.slice(s - off, e - off);
      let pieceNode: ChildNode;
      if (inInsert(s)) {
        const ins = document.createElement('ins');
        ins.className = 'mdv-diff-word-ins';
        ins.textContent = piece;
        pieceNode = ins;
      } else {
        pieceNode = document.createTextNode(piece);
      }
      frag.append(pieceNode);
      lastPiece = pieceNode;
    }
    node.replaceWith(frag);
    off = end;
  }
  // deletions after the last character
  for (const d of edit.deletes.slice(di)) {
    const el = delElement(d.text);
    if (lastPiece) {
      lastPiece.after(el);
      lastPiece = el;
    } else {
      root.append(el);
    }
  }
}

/** A key so that only blocks of the same kind are compared. */
function blockKind(block: Element): string {
  const el = block.firstElementChild;
  if (!el) return '';
  const cls = ['mdv-code', 'mdv-callout', 'mdv-frontmatter', 'mdv-mermaid'].find((c) => el.classList.contains(c)) ?? '';
  return `${el.tagName}.${cls}`;
}

/**
 * Applies inline diffs inside root (the rendered document). Returns the
 * number of blocks shown with inline marks.
 */
export function applyInlineDiffs(root: Element, detail: DiffDetail): number {
  if (detail === 'block') return 0;
  let decorated = 0;
  const children = Array.from(root.children);
  let i = 0;
  while (i < children.length) {
    if (!children[i].classList.contains('mdv-diff-del') && !children[i].classList.contains('mdv-diff-ins')) {
      i++;
      continue;
    }
    // a run of changed blocks: removed ones first, then the new ones
    const dels: Element[] = [];
    const inss: Element[] = [];
    for (; i < children.length; i++) {
      const c = children[i];
      if (c.classList.contains('mdv-diff-del')) dels.push(c);
      else if (c.classList.contains('mdv-diff-ins')) inss.push(c);
      else break;
    }
    const used = new Map<Element, Element>(); // removed block -> new block it was merged into
    for (const ins of inss) {
      const kind = blockKind(ins);
      if (!kind || kind.endsWith('mdv-mermaid')) continue;
      const newNodes = textNodes(ins);
      const newText = newNodes.map((t) => t.data).join('');
      let best: { del: Element; edit: TextEdit } | null = null;
      for (const del of dels) {
        if (used.has(del) || blockKind(del) !== kind) continue;
        const oldText = textNodes(del).map((t) => t.data).join('');
        const edit = textEdit(oldText, newText, detail);
        if (edit.similarity >= MIN_SIMILARITY && (!best || edit.similarity > best.edit.similarity)) best = { del, edit };
        if (best && best.edit.similarity === 1) break;
      }
      if (!best) continue;
      used.set(best.del, ins);
      decorate(ins.firstElementChild ?? ins, newNodes, best.edit);
      ins.classList.add('is-inline');
      decorated++;
    }
    // Merged removed blocks go away; the others keep their original order,
    // placed after the block that replaced their predecessor.
    let anchor: Element | null = null;
    for (const del of dels) {
      const merged = used.get(del);
      if (merged) {
        del.remove();
        anchor = merged;
      } else if (anchor) {
        anchor.after(del);
        anchor = del;
      }
    }
  }
  return decorated;
}
