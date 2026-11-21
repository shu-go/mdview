// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { groupLabel } from './sidebar';

describe('groupLabel', () => {
  it('shows paths relative to the opened folder', () => {
    expect(groupLabel('C:\\a\\docs', 'C:\\a\\docs')).toBe('docs');
    expect(groupLabel('C:\\a\\docs\\sub\\x', 'C:\\a\\docs')).toBe('docs/sub/x');
    expect(groupLabel('/home/u/docs/sub', '/home/u/docs')).toBe('docs/sub');
    expect(groupLabel('C:\\a\\docs2', 'C:\\a\\docs')).toBe('C:\\a\\docs2');
    expect(groupLabel('C:\\other', '')).toBe('C:\\other');
  });
});
