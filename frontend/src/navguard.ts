// Keeps the webview on the app page: the page can call the Go bindings, so
// it must never be replaced by another (possibly remote) page.

/** True when a drag carries data the app handles itself, or OS files (Wails). */
function handledDrag(types: readonly string[]): boolean {
  return types.includes('Files') || types.some((t) => t.startsWith('application/x-mdview-'));
}

export function installNavigationGuard(): void {
  // Links not handled by a view (anywhere in the page): never navigate.
  for (const type of ['click', 'auxclick'] as const) {
    document.addEventListener(type, (e) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (a) e.preventDefault();
    });
  }
  // Dropping a link / text / URL onto the window would navigate to it.
  window.addEventListener('dragover', (e) => {
    if (e.defaultPrevented || handledDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  });
  window.addEventListener('drop', (e) => {
    if (e.defaultPrevented || handledDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
  });
}
