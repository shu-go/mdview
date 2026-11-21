// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyInlineDiffs, textEdit, tokenize } from './inlinediff';

function doc(html: string): HTMLElement {
  const root = document.createElement('article');
  root.innerHTML = html;
  return root;
}

const run = (del: string, ins: string) => `<p>before</p><div class="mdv-diff-del">${del}</div><div class="mdv-diff-ins">${ins}</div><p>after</p>`;

describe('tokenize', () => {
  it('splits Japanese and English into words', () => {
    const t = tokenize('mdview は軽量な Markdown ビューアーです。', 'word');
    expect(t.join('')).toBe('mdview は軽量な Markdown ビューアーです。');
    expect(t).toContain('Markdown');
    expect(t.length).toBeGreaterThan(5);
    expect(t.length).toBeLessThan(Array.from('mdview は軽量な Markdown ビューアーです。').length);
  });
  it('splits characters by code point', () => {
    expect(tokenize('a😀b', 'char')).toEqual(['a', '😀', 'b']);
  });
});

describe('textEdit', () => {
  it('reports inserts and deletes in new-text offsets', () => {
    const e = textEdit('the quick fox', 'the slow fox', 'word');
    expect(e.deletes).toEqual([{ at: 4, text: 'quick' }]);
    expect(e.inserts).toEqual([[4, 8]]);
    expect(e.similarity).toBeGreaterThan(0.5);
  });
});

describe('applyInlineDiffs', () => {
  it('marks only the changed words and drops the removed block', () => {
    const root = doc(run('<p>the quick brown fox</p>', '<p>the slow brown fox</p>'));
    expect(applyInlineDiffs(root, 'word')).toBe(1);
    expect(root.querySelector('.mdv-diff-del')).toBeNull();
    const ins = root.querySelector('.mdv-diff-ins.is-inline')!;
    expect(ins.querySelector('del.mdv-diff-word-del')!.textContent).toBe('quick');
    expect(ins.querySelector('ins.mdv-diff-word-ins')!.textContent).toBe('slow');
    expect(ins.textContent).toBe('the quickslow brown fox');
    // deletion is placed before the insertion
    expect(ins.querySelector('p')!.innerHTML).toBe(
      'the <del class="mdv-diff-word-del">quick</del><ins class="mdv-diff-word-ins">slow</ins> brown fox',
    );
  });

  it('keeps markup and works across text nodes', () => {
    const root = doc(run('<p>see <strong>bold text</strong> here</p>', '<p>see <strong>bold words</strong> here now</p>'));
    applyInlineDiffs(root, 'word');
    const p = root.querySelector('.mdv-diff-ins p')!;
    expect(p.querySelector('strong')!.innerHTML).toBe('bold <del class="mdv-diff-word-del">text</del><ins class="mdv-diff-word-ins">words</ins>');
    expect(p.lastElementChild!.outerHTML).toBe('<ins class="mdv-diff-word-ins"> now</ins>');
  });

  it('places text removed at the end after the last character', () => {
    const root = doc(run('<p>keep this and that</p>', '<p>keep this</p>'));
    applyInlineDiffs(root, 'word');
    expect(root.querySelector('.mdv-diff-ins p')!.innerHTML).toBe('keep this<del class="mdv-diff-word-del"> and that</del>');
  });

  it('character mode marks single characters', () => {
    const root = doc(run('<p>colour</p>', '<p>color</p>'));
    applyInlineDiffs(root, 'char');
    expect(root.querySelector('.mdv-diff-ins p')!.innerHTML).toBe('colo<del class="mdv-diff-word-del">u</del>r');
  });

  it('leaves dissimilar or different-kind blocks as whole blocks', () => {
    let root = doc(run('<p>completely different sentence</p>', '<p>nothing in common here at all</p>'));
    expect(applyInlineDiffs(root, 'word')).toBe(0);
    expect(root.querySelector('.mdv-diff-del')).not.toBeNull();
    root = doc(run('<h2>Title</h2>', '<p>Title</p>'));
    expect(applyInlineDiffs(root, 'word')).toBe(0);
  });

  it('pairs each new block with the most similar removed block', () => {
    const root = doc(
      '<div class="mdv-diff-del"><p>alpha beta gamma</p></div><div class="mdv-diff-del"><p>one two three four</p></div>' +
        '<div class="mdv-diff-ins"><p>one two three five</p></div>',
    );
    expect(applyInlineDiffs(root, 'word')).toBe(1);
    expect(root.querySelector('.mdv-diff-del')!.textContent).toBe('alpha beta gamma');
    expect(root.querySelector('del.mdv-diff-word-del')!.textContent).toBe('four');
  });

  it('keeps unmatched removed blocks in their original order', () => {
    const root = doc(
      '<div class="mdv-diff-del"><p>one two three four</p></div>' +
        '<div class="mdv-diff-del"><p>this paragraph is replaced entirely</p></div>' +
        '<div class="mdv-diff-ins"><p>one two three five</p></div>' +
        '<div class="mdv-diff-ins"><p>Totally unrelated replacement</p></div>',
    );
    applyInlineDiffs(root, 'word');
    const order = Array.from(root.children).map((c) => `${c.className}:${c.textContent}`);
    expect(order).toEqual([
      'mdv-diff-ins is-inline:one two three fourfive',
      'mdv-diff-del:this paragraph is replaced entirely',
      'mdv-diff-ins:Totally unrelated replacement',
    ]);
  });

  it('never puts marks directly into table or list structure', () => {
    const row = (k: string, v: string) => `<tr>\n<td><code>${k}</code></td>\n<td>${v}</td>\n</tr>\n`;
    const table = (rows: string) => `<table>\n<thead>\n<tr>\n<th>Key</th>\n<th>Action</th>\n</tr>\n</thead>\n<tbody>\n${rows}</tbody>\n</table>`;
    const before = row('q', 'Quit') + row('v', 'Open in the editor');
    const after = before + row('v', 'Open in the editor') + row('v', 'Open in the editor');
    const root = doc(run(table(before), table(after)));
    expect(applyInlineDiffs(root, 'word')).toBe(1);
    for (const m of Array.from(root.querySelectorAll('ins.mdv-diff-word-ins, del.mdv-diff-word-del'))) {
      expect(['TD', 'TH', 'CODE']).toContain(m.parentElement!.tagName);
    }
    // every row still has exactly two cells
    for (const tr of Array.from(root.querySelectorAll('tr'))) {
      expect(Array.from(tr.children).map((c) => c.tagName)).toEqual(tr.parentElement!.tagName === 'THEAD' ? ['TH', 'TH'] : ['TD', 'TD']);
    }
    const lists = doc(run('<ul>\n<li>A</li>\n<li>B</li>\n</ul>', '<ul>\n<li>A</li>\n<li>B</li>\n<li>C</li>\n</ul>'));
    applyInlineDiffs(lists, 'word');
    const ul = lists.querySelector('.mdv-diff-ins ul')!;
    expect(Array.from(ul.children).map((c) => c.tagName)).toEqual(['LI', 'LI', 'LI']);
  });

  it('does nothing in block mode', () => {
    const root = doc(run('<p>a b c</p>', '<p>a x c</p>'));
    expect(applyInlineDiffs(root, 'block')).toBe(0);
    expect(root.querySelectorAll('.mdv-diff-del, .mdv-diff-ins')).toHaveLength(2);
  });
});
