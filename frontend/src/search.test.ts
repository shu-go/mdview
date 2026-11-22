// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildPattern, escapeRegExp, highlight, selectionQuery, unhighlight } from './search';

describe('search', () => {
  it('turns a selection into a one-line query', () => {
    expect(selectionQuery('  foo bar  ')).toBe('foo bar');
    expect(selectionQuery('\n\n  first \r\nsecond')).toBe('first');
    expect(selectionQuery(' \n ')).toBe('');
  });

  it('escapes regex metacharacters', () => {
    const s = 'a.b*(c)[d]{e}^$|+?\\';
    expect(new RegExp(escapeRegExp(s)).test(s)).toBe(true);
  });

  it('escapes plain queries and honours case', () => {
    expect(buildPattern('a.b', { regex: false, caseSensitive: false }).test('A.B')).toBe(true);
    expect(buildPattern('a.b', { regex: false, caseSensitive: false }).test('axb')).toBe(false);
    expect(buildPattern('a.b', { regex: true, caseSensitive: true }).test('axb')).toBe(true);
    expect(buildPattern('a', { regex: false, caseSensitive: true }).test('A')).toBe(false);
    expect(() => buildPattern('(', { regex: true, caseSensitive: false })).toThrow();
  });

  it('highlights matches and restores the DOM', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>foo bar <b>foo</b></p><div class="mdv-code-header">foo</div><p>x*</p>';
    const before = root.innerHTML;
    const hits = highlight(root, buildPattern('foo', { regex: false, caseSensitive: false }));
    expect(hits).toHaveLength(2);
    expect(root.querySelectorAll('mark.mdv-search-hit')).toHaveLength(2);
    unhighlight(root);
    expect(root.innerHTML).toBe(before);
    // zero-length regex matches do not loop forever
    expect(highlight(root, buildPattern('x*', { regex: true, caseSensitive: false }))).toHaveLength(1);
  });
});
