// File kinds by extension, mirroring the Go side (internal/workspace Kinds):
// Markdown is .md / .markdown, plain text the extensions in the settings.

export type FileKind = 'markdown' | 'text' | '';

const markdownExts = new Set(['.md', '.markdown']);
let textExts = new Set<string>(['.txt']);

/** Sets the text extensions from the settings value ("txt log", normalised by Go). */
export function setTextExtensions(s: string): void {
  textExts = new Set(
    s
      .split(/[\s,;]+/)
      .filter((e) => e)
      .map((e) => `.${e.replace(/^[*.]+/, '').toLowerCase()}`),
  );
}

/** The kind of a path ('' when mdview does not show such files). */
export function fileKind(path: string): FileKind {
  const m = /\.[^.\\/]+$/.exec(path);
  if (!m) return '';
  const ext = m[0].toLowerCase();
  if (markdownExts.has(ext)) return 'markdown';
  return textExts.has(ext) ? 'text' : '';
}
