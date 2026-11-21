// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { KeyState, keyName } from './keys';

function ev(key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...mods });
}

describe('keys', () => {
  it('names keys', () => {
    expect(keyName(ev('j'))).toBe('j');
    expect(keyName(ev('G', { shiftKey: true }))).toBe('G');
    expect(keyName(ev(' ', { shiftKey: true }))).toBe('S- ');
    expect(keyName(ev('Tab', { ctrlKey: true, shiftKey: true }))).toBe('C-S-Tab');
    expect(keyName(ev('o', { ctrlKey: true }))).toBe('C-o');
  });

  it('accumulates counts', () => {
    const s = new KeyState();
    expect(s.handle(ev('1'))?.cmd).toBe('count');
    expect(s.handle(ev('5'))?.count).toBe(15);
    expect(s.handle(ev('j'))).toEqual({ cmd: 'line-down', count: 15 });
    expect(s.handle(ev('j'))).toEqual({ cmd: 'line-down', count: null });
    // a leading 0 is not a count
    expect(s.handle(ev('0'))).toBeNull();
    expect(s.handle(ev('x'))).toBeNull();
    expect(s.handle(ev('5'))?.cmd).toBe('count');
    expect(s.handle(ev('0'))?.count).toBe(50);
    expect(s.handle(ev('p'))).toEqual({ cmd: 'percent', count: 50 });
  });
});
