// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { installNavigationGuard } from './navguard';

installNavigationGuard();

function dragEvent(type: string, types: string[]): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types, dropEffect: 'copy' } });
  return e;
}

describe('navigation guard', () => {
  it('cancels link clicks that nothing else handled', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com/';
    document.body.append(a);
    for (const type of ['click', 'auxclick']) {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true });
      a.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it('blocks dropping URLs / text but leaves files and app drags alone', () => {
    for (const [types, blocked] of [
      [['text/uri-list', 'text/plain'], true],
      [['text/plain'], true],
      [['Files'], false],
      [['application/x-mdview-tab', 'text/plain'], false],
    ] as [string[], boolean][]) {
      for (const type of ['dragover', 'drop']) {
        const e = dragEvent(type, types);
        document.body.dispatchEvent(e);
        expect(e.defaultPrevented, `${type} ${types}`).toBe(blocked);
      }
    }
  });
});
