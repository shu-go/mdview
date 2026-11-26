import { describe, expect, it } from 'vitest';
import { fileKind, setTextExtensions } from './filetypes';

describe('fileKind', () => {
  it('knows Markdown and the configured text extensions', () => {
    setTextExtensions('txt log');
    expect(fileKind('C:\\a\\b.MD')).toBe('markdown');
    expect(fileKind('/a/b.markdown')).toBe('markdown');
    expect(fileKind('/a/b.mdown')).toBe('');
    expect(fileKind('/a/b.Log')).toBe('text');
    expect(fileKind('/a/b.pdf')).toBe('');
    expect(fileKind('/a.d/README')).toBe('');
  });

  it('follows the settings', () => {
    setTextExtensions('');
    expect(fileKind('/a/b.txt')).toBe('');
    setTextExtensions('csv');
    expect(fileKind('/a/b.csv')).toBe('text');
  });
});
