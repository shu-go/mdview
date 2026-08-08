import './style.css';
import './app.css';

import { LoadFile, ParseMarkdownWithDiff, WatchFile, UnwatchFile, SelectFiles, GetInitialFile, OpenInBrowser, OpenInEditor, SetWindowTitle, ChooseEditor, LoadConfig, SaveConfig, ExpandDroppedPaths } from '../wailsjs/go/main/App';
import { EventsOn, OnFileDrop, Quit, WindowUnminimise } from '../wailsjs/runtime/runtime';
import prismDarkTheme from 'prismjs/themes/prism-tomorrow.css?inline';
import prismLightTheme from 'prismjs/themes/prism.css?inline';
import Prism from 'prismjs';
// Core-independent languages
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-vim';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-kotlin';
// Languages that depend on the above
import 'prismjs/components/prism-cpp';            // depends on c
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-scala';          // depends on java
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';            // depends on jsx, typescript
import 'prismjs/components/prism-go-module';      // depends on go
import 'prismjs/components/prism-json5';          // depends on json
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';            // depends on markup-templating

// Inject Prism theme via a <style> element so we can swap it at runtime
const prismStyleEl = document.createElement('style');
document.head.appendChild(prismStyleEl);

// --- Multi-file state ---
// filesByPath: absolute path -> { path, name, dirPath, raw, html, initialRaw,
//   baselineRaw, frontMatter, frontMatterCollapsed, diffMode, lastDiffMode,
//   unseen, scrollTop }
let filesByPath = new Map();
let activePath = null; // currently displayed file, or null if none open

// File list panel state
let collapsedGroups = new Set(); // dirPath values that are collapsed
let listFocused = false;         // true while keyboard focus is in the file list panel
let focusedItemKey = null;       // `group:${dirPath}` or `file:${path}`

// TOC panel state
let tocItems = [];       // [{ level, text, el }], rebuilt after every render
let tocFocused = false;  // true while keyboard focus is in the TOC panel
let focusedTocIndex = -1;

// Persisted config (loaded at startup, updated on font/theme/editor/split change)
let currentConfig = { font: '', themeMode: 'system', editorPath: '', fileListRatio: 0 };

// DOM Elements (pre-rendered in index.html)
const searchPanel = document.querySelector('.search-panel');

// Font Picker Modal elements
const fontModal = document.getElementById('font-modal');
const fontInput = document.getElementById('font-input');
const fontPreview = document.getElementById('font-preview');
const fontApplyBtn = document.getElementById('font-apply-btn');
const fontCancelBtn = document.getElementById('font-cancel-btn');
const fontModalClose = document.getElementById('font-modal-close');

const dropArea = document.getElementById('drop-area');
const viewerContainer = document.getElementById('viewer-container');
const viewerBody = document.querySelector('.viewer-body');
const renderPane = document.querySelector('.render-pane');
const btnToggleFileList = document.getElementById('btn-toggle-file-list');
const fileListPanel = document.getElementById('file-list-panel');
const fileListItems = document.getElementById('file-list-items');
const btnToggleTOC = document.getElementById('btn-toggle-toc');
const tocPanel = document.getElementById('toc-panel');
const tocItemsEl = document.getElementById('toc-items');
const splitter = document.getElementById('splitter');
const btnUpdateBaseline = document.getElementById('btn-update-baseline');
const btnMenu = document.getElementById('btn-menu');
const appMenu = document.getElementById('app-menu');
const menuEditor = document.getElementById('menu-editor');
const menuFont = document.getElementById('menu-font');
const markdownBody = document.getElementById('markdown-body');
const linkPreview = document.getElementById('link-preview');
const linkContentPopup = document.getElementById('link-content-popup');
const edgeFlashTop = document.getElementById('edge-flash-top');
const edgeFlashBottom = document.getElementById('edge-flash-bottom');
const scrollMarks = document.getElementById('scroll-marks');
const contentArea = viewerContainer.querySelector('.content-area');
const toolbar = viewerContainer.querySelector('.toolbar');
const segButtons = document.querySelectorAll('.toolbar-center .seg-btn');
const searchInput = searchPanel.querySelector('.search-input');
const searchCountEl = searchPanel.querySelector('.search-count');
const btnSearchPrev = searchPanel.querySelector('.search-prev');
const btnSearchNext = searchPanel.querySelector('.search-next');
const btnSearchClose = searchPanel.querySelector('.search-close-btn');
const btnSearchRegex = searchPanel.querySelector('.search-regex-btn');

const zoomBar = document.getElementById('zoom-bar');
const zoomLabel = document.getElementById('zoom-label');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomReset = document.getElementById('btn-zoom-reset');

// Search state
let searchMatches = [];
let currentMatchIdx = -1;
let searchRegexMode = false; // false = plain string search (default), true = regex

// Ctrl+hover link content popup state
let ctrlDown = false;
let hoverAnchorEl = null;       // <a> currently under the mouse in markdownBody, or null
let lastHoverPos = { x: 0, y: 0 };
let linkPopupShowTimer = null;
let linkPopupHideTimer = null;
let linkPopupRequestId = 0;     // invalidates stale async preview fetches
const filePreviewCache = new Map(); // resolved path -> rendered HTML, for files not currently open

// Wails native drag and drop handler. Dropped directories are expanded
// (recursively) into the files they contain before extension filtering, so
// dropping a folder opens every Markdown file inside it at once.
OnFileDrop(async (x, y, paths) => {
    if (!paths || paths.length === 0) return;

    let expanded;
    try {
        expanded = await ExpandDroppedPaths(paths);
    } catch (err) {
        console.error('Failed to expand dropped paths:', err);
        expanded = paths;
    }

    const validPaths = expanded.filter(p => {
        const lower = p.toLowerCase();
        return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt');
    });

    if (validPaths.length > 0) {
        openFiles(validPaths);
    } else {
        alert('Please drop a Markdown file (.md, .markdown, .txt) or a folder containing one.');
    }
}, true);

// Click to select file dialog (only reachable from the empty drop-area state)
dropArea.addEventListener('click', async () => {
    try {
        const paths = await SelectFiles();
        if (paths && paths.length > 0) {
            await openFiles(paths);
        }
    } catch (err) {
        console.error('Failed to select file:', err);
    }
});

// --- Toolbar Event Listeners ---
segButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const entry = filesByPath.get(activePath);
        if (!entry) return;
        entry.diffMode = btn.dataset.mode;
        if (entry.diffMode !== 'off') entry.lastDiffMode = entry.diffMode;
        syncDiffButtonsForActive();
        renderContent();
        flashToolbar();
    });
});

btnUpdateBaseline.addEventListener('click', () => {
    const entry = filesByPath.get(activePath);
    if (!entry) return;
    entry.baselineRaw = entry.raw;
    renderContent();
    showToast('Baseline updated to current content');
});

btnToggleFileList.addEventListener('click', () => {
    toggleFileListViaButton();
});

btnToggleTOC.addEventListener('click', () => {
    toggleTOCViaButton();
});

// Menu toggle
function closeAppMenu() {
    appMenu.classList.add('hidden');
    scheduleHideToolbar();
}

btnMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btnMenu.getBoundingClientRect();
    if (appMenu.classList.contains('hidden')) {
        appMenu.style.top = (rect.bottom + 4) + 'px';
        appMenu.style.right = (window.innerWidth - rect.right) + 'px';
        appMenu.classList.remove('hidden');
        showToolbar();
    } else {
        closeAppMenu();
    }
});

appMenu.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', () => closeAppMenu());

// Menu items
document.querySelectorAll('.theme-switch [data-theme]').forEach(item => {
    item.addEventListener('click', async () => {
        const mode = item.dataset.theme;
        applyTheme(mode);
        currentConfig.themeMode = mode;
        closeAppMenu();
        if (activePath) await renderContent();
        try {
            await SaveConfig(currentConfig);
        } catch (err) {
            console.error('Failed to save theme:', err);
        }
    });
});

menuEditor.addEventListener('click', async () => {
    closeAppMenu();
    try {
        const editorPath = await ChooseEditor();
        if (editorPath) {
            currentConfig.editorPath = editorPath;
            await SaveConfig(currentConfig);
        }
    } catch (err) {
        console.error('Editor selection failed:', err);
    }
});

menuFont.addEventListener('click', () => {
    closeAppMenu();
    openFontModal();
});

// Search panel event listeners
searchInput.addEventListener('input', () => {
    runSearch(searchInput.value);
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) searchPrev(); else searchNext();
    }
    if (e.key === 'Escape') {
        closeSearch();
    }
});

btnSearchRegex.addEventListener('click', () => {
    searchRegexMode = !searchRegexMode;
    btnSearchRegex.classList.toggle('active', searchRegexMode);
    runSearch(searchInput.value);
});

btnSearchPrev.addEventListener('click', searchPrev);
btnSearchNext.addEventListener('click', searchNext);
btnSearchClose.addEventListener('click', closeSearch);

// Clicking into the render area returns keyboard focus there from the file list / TOC.
contentArea.addEventListener('mousedown', () => {
    if (listFocused) {
        listFocused = false;
        renderFileList();
    }
    if (tocFocused) {
        tocFocused = false;
        renderTOCPanel();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.key === '+') {
        e.preventDefault();
        changeZoom(10);
        return;
    }
    if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        changeZoom(-10);
        return;
    }
    if (e.ctrlKey && e.key === '=') {
        e.preventDefault();
        resetZoom();
        return;
    }
    if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        if (!activePath) return;
        if (!currentConfig.editorPath) {
            showToast('No editor configured — click the Editor button to select one');
            return;
        }
        try {
            await OpenInEditor(currentConfig.editorPath, activePath);
        } catch (err) {
            console.error('Failed to open in editor:', err);
        }
        return;
    }
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        openSearch();
        return;
    }
    if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        cycleDiffMode();
        return;
    }
    if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        await handleRenderAreaClose();
        return;
    }
    if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        try {
            const paths = await SelectFiles();
            if (paths && paths.length > 0) {
                await openFiles(paths);
            }
        } catch (err) {
            console.error('Failed to select files:', err);
        }
        return;
    }
    if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) searchPrev(); else searchNext();
        return;
    }

    const activeTag = document.activeElement?.tagName;
    const typingInInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

    // While the file list or TOC has keyboard focus, it owns all non-Ctrl shortcuts.
    if (listFocused && !typingInInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
        await handleFileListKeydown(e);
        return;
    }
    if (tocFocused && !typingInInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
        handleTocKeydown(e);
        return;
    }

    if (e.key === 'Escape') {
        if (!appMenu.classList.contains('hidden')) { closeAppMenu(); return; }
        if (!searchPanel.classList.contains('hidden')) { closeSearch(); return; }
        if (!fileListPanel.classList.contains('hidden')) { closeFileListPanel(); return; }
        if (!tocPanel.classList.contains('hidden')) { closeTOCPanel(); return; }
    }

    // Vim-like scroll and / search opener: skip when a text input is focused
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (typingInInput) return;

    switch (e.key) {
        case '/':
            e.preventDefault();
            openSearch();
            break;
        case 'j':
            e.preventDefault();
            contentArea.scrollBy({ top: lineHeight()*2, behavior: 'smooth' });
            break;
        case 'k':
            e.preventDefault();
            contentArea.scrollBy({ top: -lineHeight()*2, behavior: 'smooth' });
            break;
        case 'b':
            e.preventDefault();
            contentArea.scrollBy({ top: -contentArea.clientHeight, behavior: 'smooth' });
            break;
        case ' ':
            if (e.shiftKey) {
                e.preventDefault();
                contentArea.scrollBy({ top: -contentArea.clientHeight, behavior: 'smooth' });
            }
            break;
        case 'g':
            e.preventDefault();
            contentArea.scrollTo({ top: 0, behavior: 'instant' });
            flashEdge(edgeFlashTop);
            break;
        case 'G':
            e.preventDefault();
            contentArea.scrollTo({ top: contentArea.scrollHeight, behavior: 'instant' });
            flashEdge(edgeFlashBottom);
            break;
        case 'h':
            e.preventDefault();
            navigateBack();
            break;
        case 'l':
            e.preventDefault();
            navigateForward();
            break;
        case 'f':
            e.preventDefault();
            openFileListFocused();
            hideToolbar();
            break;
        case 't':
            e.preventDefault();
            openTOCFocused();
            hideToolbar();
            break;
        case 'q':
            e.preventDefault();
            await handleRenderAreaClose();
            break;
    }
});

// Zoom
let currentZoom = 100;
let zoomBarHideTimer = null;

function applyZoom() {
    markdownBody.style.zoom = currentZoom / 100;
    zoomLabel.textContent = currentZoom + '%';
}

function showZoomBar() {
    clearTimeout(zoomBarHideTimer);
    zoomBar.classList.add('visible');
}

function scheduleHideZoomBar(delay = 400) {
    clearTimeout(zoomBarHideTimer);
    zoomBarHideTimer = setTimeout(() => zoomBar.classList.remove('visible'), delay);
}

function changeZoom(delta) {
    currentZoom = Math.max(50, Math.min(200, currentZoom + delta));
    applyZoom();
    showZoomBar();
    scheduleHideZoomBar(1500);
}

function resetZoom() {
    currentZoom = 100;
    applyZoom();
    showZoomBar();
    scheduleHideZoomBar(1500);
}

btnZoomOut.addEventListener('click', () => changeZoom(-10));
btnZoomIn.addEventListener('click', () => changeZoom(10));
btnZoomReset.addEventListener('click', resetZoom);

// Ctrl+wheel zoom: prevent the native browser/webview zoom and route through
// changeZoom() instead, so the zoom bar stays in sync with the actual zoom level.
window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    changeZoom(e.deltaY < 0 ? 10 : -10);
}, { passive: false });

// Mouse "back"/"forward" side buttons (button 3/4) drive the same jump
// history as the h/l shortcuts, instead of any native browser navigation.
window.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
        e.preventDefault();
        navigateBack();
    } else if (e.button === 4) {
        e.preventDefault();
        navigateForward();
    }
});

// Briefly flash a top/bottom edge overlay to indicate a g/G jump hit the start or end.
function flashEdge(el) {
    el.classList.remove('flash');
    void el.offsetWidth; // force reflow so the animation restarts on rapid repeats
    el.classList.add('flash');
}

// --- Jump navigation (TOC selections and in-document links) ---
// Each file keeps its own back/forward stack (entry.navHistory / navIndex),
// mirroring browser session history: jumping truncates any forward entries
// past the current position, then appends the new one.

// Returns the scrollTop that would bring el to the top of contentArea.
function scrollTopForElement(el) {
    const contentTop = contentArea.getBoundingClientRect().top;
    return el.getBoundingClientRect().top - contentTop + contentArea.scrollTop;
}

function navigateTo(targetScrollTop, behavior = 'smooth') {
    const entry = filesByPath.get(activePath);
    if (entry) {
        if (entry.navIndex === -1) {
            entry.navHistory = [contentArea.scrollTop];
            entry.navIndex = 0;
        }
        // Refresh the current checkpoint with wherever the user actually
        // scrolled to since the last jump, so "back" returns to that spot
        // rather than the position of the last jump's destination.
        entry.navHistory[entry.navIndex] = contentArea.scrollTop;
        entry.navHistory = entry.navHistory.slice(0, entry.navIndex + 1);
        entry.navHistory.push(targetScrollTop);
        entry.navIndex = entry.navHistory.length - 1;
    }
    contentArea.scrollTo({ top: targetScrollTop, behavior });
}

function navigateBack() {
    const entry = filesByPath.get(activePath);
    if (!entry || entry.navIndex <= 0) return;
    entry.navIndex--;
    contentArea.scrollTo({ top: entry.navHistory[entry.navIndex], behavior: 'instant' });
}

function navigateForward() {
    const entry = filesByPath.get(activePath);
    if (!entry || entry.navIndex === -1 || entry.navIndex >= entry.navHistory.length - 1) return;
    entry.navIndex++;
    contentArea.scrollTo({ top: entry.navHistory[entry.navIndex], behavior: 'instant' });
}

renderPane.addEventListener('mousemove', (e) => {
    const rect = renderPane.getBoundingClientRect();
    if (e.clientY > rect.bottom - 40 && e.clientX > rect.right - 130) showZoomBar();
    else if (!zoomBar.matches(':hover')) scheduleHideZoomBar();
});
renderPane.addEventListener('mouseleave', () => {
    scheduleHideZoomBar();
});
zoomBar.addEventListener('mouseenter', showZoomBar);
zoomBar.addEventListener('mouseleave', scheduleHideZoomBar);

// Toolbar visibility: hidden by default, revealed while the cursor is near the
// top edge or briefly after a diff-mode change (mirrors the zoom bar). The t/f
// shortcuts force it hidden instead, since they open a panel of their own.
let toolbarHideTimer = null;

function showToolbar() {
    clearTimeout(toolbarHideTimer);
    toolbar.classList.add('visible');
}

function scheduleHideToolbar(delay = 400) {
    clearTimeout(toolbarHideTimer);
    if (!appMenu.classList.contains('hidden')) return; // stay visible while the menu is open
    toolbarHideTimer = setTimeout(() => toolbar.classList.remove('visible'), delay);
}

// Immediately hides the toolbar, overriding hover/menu state. Used when the
// t/f shortcuts open a panel, since the toolbar shouldn't linger in that case.
function hideToolbar() {
    clearTimeout(toolbarHideTimer);
    toolbar.classList.remove('visible');
}

// Briefly reveal the toolbar in response to a diff-mode change.
function flashToolbar() {
    showToolbar();
    scheduleHideToolbar(1500);
}

viewerContainer.addEventListener('mousemove', (e) => {
    if (e.clientY < 40) showToolbar();
    else if (!toolbar.matches(':hover')) scheduleHideToolbar();
});
viewerContainer.addEventListener('mouseleave', () => {
    scheduleHideToolbar();
});
toolbar.addEventListener('mouseenter', showToolbar);
toolbar.addEventListener('mouseleave', scheduleHideToolbar);

// Show link destination in status bar on hover (like browser status bar)
markdownBody.addEventListener('mouseover', (e) => {
    const anchor = e.target.closest('a');
    hoverAnchorEl = anchor;
    lastHoverPos = { x: e.clientX, y: e.clientY };

    if (!anchor) {
        linkPreview.classList.remove('visible');
        scheduleHideLinkPopup();
        return;
    }
    const href = anchor.getAttribute('href');
    if (!href) {
        linkPreview.classList.remove('visible');
        scheduleHideLinkPopup();
        return;
    }

    let display;
    if (href.startsWith('#')) {
        try {
            display = '#' + decodeURIComponent(href.slice(1));
        } catch {
            display = href;
        }
    } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        display = href;
    } else {
        const resolved = resolveFilePath(activePath, href);
        const lower = resolved.toLowerCase();
        if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
            display = resolved;
        } else {
            display = 'file:///' + resolved.replace(/\\/g, '/');
        }
    }

    linkPreview.textContent = display;
    linkPreview.classList.add('visible');

    if (ctrlDown) scheduleShowLinkPopup(anchor, e.clientX, e.clientY);
});

markdownBody.addEventListener('mouseleave', () => {
    linkPreview.classList.remove('visible');
    hoverAnchorEl = null;
    scheduleHideLinkPopup();
});

// --- Ctrl+hover link content popup ---
// Holding Ctrl while hovering a link (in-document heading anchor or local
// Markdown file link) shows a floating preview of the target content,
// similar to "peek definition" in code editors.

window.addEventListener('keydown', (e) => {
    if (e.key !== 'Control' || ctrlDown) return;
    ctrlDown = true;
    if (hoverAnchorEl) scheduleShowLinkPopup(hoverAnchorEl, lastHoverPos.x, lastHoverPos.y);
});

window.addEventListener('keyup', (e) => {
    if (e.key !== 'Control') return;
    ctrlDown = false;
    hideLinkContentPopup();
});

window.addEventListener('blur', () => {
    ctrlDown = false;
    hideLinkContentPopup();
});

contentArea.addEventListener('scroll', () => hideLinkContentPopup());

linkContentPopup.addEventListener('mouseenter', () => clearTimeout(linkPopupHideTimer));
linkContentPopup.addEventListener('mouseleave', () => scheduleHideLinkPopup());

function scheduleShowLinkPopup(anchor, x, y) {
    clearTimeout(linkPopupShowTimer);
    clearTimeout(linkPopupHideTimer);
    linkPopupShowTimer = setTimeout(() => showLinkContentPopup(anchor, x, y), 150);
}

function scheduleHideLinkPopup() {
    clearTimeout(linkPopupShowTimer);
    clearTimeout(linkPopupHideTimer);
    linkPopupHideTimer = setTimeout(hideLinkContentPopup, 120);
}

function hideLinkContentPopup() {
    clearTimeout(linkPopupShowTimer);
    clearTimeout(linkPopupHideTimer);
    linkPopupRequestId++;
    linkContentPopup.classList.remove('visible');
}

async function showLinkContentPopup(anchor, x, y) {
    if (!ctrlDown) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) return;

    const requestId = ++linkPopupRequestId;
    let preview;
    try {
        preview = await buildLinkPreview(href);
    } catch (err) {
        preview = { title: null, html: `<p class="link-popup-error">Preview unavailable: ${escapeHTML(String(err))}</p>` };
    }
    if (requestId !== linkPopupRequestId || !ctrlDown || !preview) return;

    const titleHTML = preview.title ? `<div class="link-popup-title">${escapeHTML(preview.title)}</div>` : '';
    linkContentPopup.innerHTML = `${titleHTML}<div class="markdown-body link-popup-body">${preview.html}</div>`;
    linkContentPopup.classList.add('visible');
    positionLinkContentPopup(x, y);
}

// Resolves an anchor's href to preview HTML: the target heading's section for
// in-document "#fragment" links, or a Markdown file's content (optionally
// narrowed to a "#fragment" heading within it) for local file links.
async function buildLinkPreview(href) {
    if (href.startsWith('#')) {
        return { title: null, html: extractSectionHTML(markdownBody, decodeFragment(href.slice(1))) };
    }

    const hashIdx = href.indexOf('#');
    const pathPart = hashIdx === -1 ? href : href.slice(0, hashIdx);
    const fragment = hashIdx === -1 ? '' : decodeFragment(href.slice(hashIdx + 1));

    const resolved = resolveFilePath(activePath, pathPart);
    const lower = resolved.toLowerCase();
    if (!(lower.endsWith('.md') || lower.endsWith('.markdown'))) return null; // no preview for non-Markdown files

    const html = await getFilePreviewHTML(resolved);
    const title = resolved.split(/[\\/]/).pop();
    if (!fragment) return { title, html };

    const container = document.createElement('div');
    container.innerHTML = html;
    return { title, html: extractSectionHTML(container, fragment) };
}

function decodeFragment(raw) {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

// Extracts the HTML for the heading matching `fragment` plus everything up to
// (but excluding) the next heading of equal or higher level — i.e. its section.
function extractSectionHTML(root, fragment) {
    const target = root.querySelector(`#${CSS.escape(fragment)}`);
    if (!target) return `<p class="link-popup-error">Section not found: #${escapeHTML(fragment)}</p>`;
    if (!/^H[1-6]$/.test(target.tagName)) return target.outerHTML;

    const level = Number(target.tagName[1]);
    const parts = [target.outerHTML];
    let sib = target.nextElementSibling;
    while (sib && !(/^H[1-6]$/.test(sib.tagName) && Number(sib.tagName[1]) <= level)) {
        parts.push(sib.outerHTML);
        sib = sib.nextElementSibling;
    }
    return parts.join('');
}

// Returns rendered HTML for a Markdown file: the live copy if it's already
// open (so previews reflect unsaved diff state), otherwise a cached fetch.
async function getFilePreviewHTML(resolvedPath) {
    const openEntry = filesByPath.get(resolvedPath);
    if (openEntry) return openEntry.html;
    if (filePreviewCache.has(resolvedPath)) return filePreviewCache.get(resolvedPath);
    const result = await LoadFile(resolvedPath);
    filePreviewCache.set(resolvedPath, result.html);
    return result.html;
}

// Positions the popup near (x, y) while keeping it fully within the viewport.
function positionLinkContentPopup(x, y) {
    const margin = 14;
    linkContentPopup.style.left = '-9999px';
    linkContentPopup.style.top = '-9999px';
    const rect = linkContentPopup.getBoundingClientRect();

    let left = x + margin;
    let top = y + margin;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, x - rect.width - margin);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, y - rect.height - margin);

    linkContentPopup.style.left = `${left}px`;
    linkContentPopup.style.top = `${top}px`;
}

// Intercept link clicks in the rendered markdown
markdownBody.addEventListener('click', async (e) => {
    hideLinkContentPopup();
    const anchor = e.target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    e.preventDefault();

    if (href.startsWith('#')) {
        // goldmark percent-encodes non-ASCII link destinations (e.g. Japanese
        // headings), so the raw href won't match the heading's literal id.
        let fragment = href.slice(1);
        try {
            fragment = decodeURIComponent(fragment);
        } catch {
            // Malformed escape sequence — fall back to the raw fragment.
        }
        const target = markdownBody.querySelector(`#${CSS.escape(fragment)}`);
        if (target) navigateTo(scrollTopForElement(target), 'instant');
        return;
    }

    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        await OpenInBrowser(href);
        return;
    }

    // Local file link — resolve relative to current file
    const resolved = resolveFilePath(activePath, href);
    const lower = resolved.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
        await openFile(resolved);
    } else {
        await OpenInBrowser('file:///' + resolved.replace(/\\/g, '/'));
    }
});

function resolveFilePath(basePath, relativePath) {
    if (!basePath) return relativePath;
    const baseDir = basePath.replace(/[/\\][^/\\]*$/, '');
    const combined = (baseDir + '/' + relativePath).replace(/\\/g, '/');
    const parts = combined.split('/');
    const resolved = [];
    for (const part of parts) {
        if (part === '..') resolved.pop();
        else if (part !== '.') resolved.push(part);
    }
    return resolved.join('\\');
}

// --- File Handling Functions ---

// Opens (or switches to, if already open) the file at path, adding it to the
// file list if it's new. Each file's diff-mode state and scroll position are
// kept independent and restored when switching back to it. Re-selecting the
// file that's already displayed is a no-op, so its scroll position is left alone.
async function openFile(path) {
    if (path === activePath) return;

    try {
        if (activePath && filesByPath.has(activePath)) {
            filesByPath.get(activePath).scrollTop = contentArea.scrollTop;
        }

        const entry = await ensureFileLoaded(path);
        entry.unseen = false;

        activePath = path;
        SetWindowTitle(`${entry.name} - mdview`);

        dropArea.classList.add('hidden');
        viewerContainer.classList.remove('hidden');

        syncDiffButtonsForActive();
        await renderContent();
        contentArea.scrollTo({ top: entry.scrollTop || 0, behavior: 'instant' });
        renderFileList();
    } catch (err) {
        console.error('Failed to open file:', err);
        alert('Failed to load file: ' + err);
    }
}

// Loads a file into filesByPath (and starts watching it) if it isn't already
// open, without changing which file is displayed. Returns its entry.
async function ensureFileLoaded(path) {
    let entry = filesByPath.get(path);
    if (!entry) {
        const result = await LoadFile(path);
        entry = {
            path,
            name: path.split(/[\\/]/).pop(),
            dirPath: path.replace(/[\\/][^\\/]*$/, '') || path,
            raw: result.raw,
            html: result.html,
            initialRaw: result.raw,   // Set once on first open, never reset by file changes
            baselineRaw: result.raw,  // User-controlled baseline for "基準差分" mode
            frontMatter: result.frontMatter || '',
            frontMatterCollapsed: false,
            diffMode: 'baseline',
            lastDiffMode: 'baseline',
            unseen: false,
            scrollTop: 0,
            navHistory: [],
            navIndex: -1,
        };
        filesByPath.set(path, entry);
        await WatchFile(path);
    }
    return entry;
}

// Opens multiple files at once (e.g. a multi-file drag & drop): every path is
// added to the file list, but only the first one is displayed.
async function openFiles(paths) {
    if (paths.length === 0) return;
    for (const path of paths.slice(1)) {
        try {
            await ensureFileLoaded(path);
        } catch (err) {
            console.error('Failed to load file:', path, err);
        }
    }
    await openFile(paths[0]);
}

// Closes a single file (stopping its watcher). If it was the active file,
// switches to the next file in list order (or the previous one, if it was
// last). Quits the app if this was the last open file.
async function closeFile(path) {
    const entry = filesByPath.get(path);
    if (!entry) return;

    const orderedFiles = getOrderedFilePaths();
    const fileIdx = orderedFiles.indexOf(path);

    const wasFocused = listFocused && focusedItemKey === `file:${path}`;
    const flatIdxBefore = wasFocused ? getFlattenedItems().findIndex(it => it.key === focusedItemKey) : -1;

    filesByPath.delete(path);
    try {
        await UnwatchFile(path);
    } catch (err) {
        console.error('Failed to unwatch file:', err);
    }

    const remainingFiles = getOrderedFilePaths();
    if (remainingFiles.length === 0) {
        Quit();
        return;
    }

    if (wasFocused) {
        const items = getFlattenedItems();
        const newIdx = Math.min(flatIdxBefore, items.length - 1);
        focusedItemKey = items[newIdx]?.key ?? null;
    }

    if (path === activePath) {
        const nextPath = remainingFiles[Math.min(fileIdx, remainingFiles.length - 1)];
        await openFile(nextPath);
    } else {
        renderFileList();
    }

    if (wasFocused) scrollFocusedIntoView();
}

// render-area q / Ctrl+W: close the current file, or quit if it's the last one.
async function handleRenderAreaClose() {
    if (!activePath) {
        Quit();
        return;
    }
    await closeFile(activePath);
}

// File change detected by watcher — refresh the file's content. If it's the
// currently displayed file, re-render immediately; otherwise just flag it as
// unseen (●) in the file list.
EventsOn('file-changed', async (changedPath) => {
    const entry = filesByPath.get(changedPath);
    if (!entry) return;
    try {
        const result = await LoadFile(changedPath);
        entry.raw = result.raw;
        entry.html = result.html;
        entry.frontMatter = result.frontMatter || '';

        if (changedPath === activePath) {
            await renderContent();
            showToast('File change detected — reloaded');
        } else {
            entry.unseen = true;
            renderFileList();
        }
    } catch (err) {
        console.error('Failed to reload file:', err);
    }
});

// --- Rendering Logic ---
async function renderContent() {
    const entry = filesByPath.get(activePath);
    if (!entry) return;

    renderFrontMatterPanel(entry);

    if (entry.diffMode === 'off') {
        markdownBody.innerHTML = entry.html;
        stripEventHandlers(markdownBody);
        postProcessHTML();
        rerunSearchIfOpen();
        return;
    }

    const baseRaw = entry.diffMode === 'initial' ? entry.initialRaw : entry.baselineRaw;
    try {
        // Go renders both base and current to HTML, then diffs at the HTML line level.
        // This avoids Markdown structure being broken by injecting tags into source.
        const diffHTML = await ParseMarkdownWithDiff(entry.path, baseRaw, entry.raw);
        markdownBody.innerHTML = diffHTML;
        stripEventHandlers(markdownBody);
        postProcessHTML();
        rerunSearchIfOpen();
    } catch (err) {
        console.error('Failed to render diff:', err);
        markdownBody.innerHTML = `<div class="error-msg">Failed to render diff: ${err}</div>`;
    }
}

// Remove all inline event handler attributes (on*) to prevent XSS via html.WithUnsafe().
// <script> injected via innerHTML does not execute, but onerror/onload etc. do.
function stripEventHandlers(root) {
    for (const el of root.querySelectorAll('*')) {
        for (const { name } of [...el.attributes]) {
            if (name.startsWith('on')) el.removeAttribute(name);
        }
    }
}

let mermaidInitialized = false;
let mermaidThemeIsLight = null;

async function postProcessHTML() {
    // 1. Process Mermaid blocks before prism highlights them
    const codeBlocks = document.querySelectorAll('pre code.language-mermaid');
    const mermaidContainers = [];

    codeBlocks.forEach((block, idx) => {
        const pre = block.parentNode;
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.id = `mermaid-${idx}`;
        div.textContent = block.textContent;

        pre.parentNode.replaceChild(div, pre);
        mermaidContainers.push(div);
    });

    if (mermaidContainers.length > 0) {
        try {
            const { default: mermaid } = await import('mermaid');
            const wantLight = isEffectiveThemeLight();
            if (!mermaidInitialized || mermaidThemeIsLight !== wantLight) {
                mermaid.initialize({ startOnLoad: false, theme: wantLight ? 'default' : 'dark', securityLevel: 'loose' });
                mermaidInitialized = true;
                mermaidThemeIsLight = wantLight;
            }
            await mermaid.run({ nodes: mermaidContainers });
        } catch (err) {
            console.error('Mermaid render error:', err);
        }
    }

    // 2. Add copy buttons to all remaining pre>code blocks (mermaid pre elements are already removed)
    addCopyButtons();

    // 3. Syntax highlighting with Prism
    Prism.highlightAllUnder(markdownBody);

    // 4. Rebuild the TOC from the headings now in the DOM
    buildTOC();

    // 5. Mark diff insertions/deletions and search matches on the scrollbar track
    renderScrollMarks();
}

// Places a colored tick on the scrollbar track for every ins/del element
// (diff mode) and every search match currently in the DOM. Positions are
// expressed as a percentage of the content's total scroll height, so they
// stay correct across zoom changes without needing to be recomputed.
function renderScrollMarks() {
    const totalHeight = contentArea.scrollHeight;
    const items = [
        ...[...markdownBody.querySelectorAll('ins, del')].map(el => ({
            el, cls: el.tagName === 'INS' ? 'ins' : 'del',
        })),
        ...searchMatches.map((el, i) => ({
            el, cls: i === currentMatchIdx ? 'search-current' : 'search',
        })),
    ];

    if (items.length === 0 || totalHeight === 0) {
        scrollMarks.innerHTML = '';
        return;
    }
    const contentTop = contentArea.getBoundingClientRect().top;
    scrollMarks.innerHTML = items.map(({ el, cls }) => {
        const offset = el.getBoundingClientRect().top - contentTop + contentArea.scrollTop;
        const relTop = Math.max(0, Math.min(100, (offset / totalHeight) * 100));
        return `<div class="scroll-mark ${cls}" style="top: ${relTop}%"></div>`;
    }).join('');
}

function addCopyButtons() {
    markdownBody.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.copy-btn')) return;
        const code = pre.querySelector('code');
        if (!code) return;

        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.title = 'Copy code';
        btn.textContent = 'Copy';

        btn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(code.innerText);
                btn.textContent = '✓ Copied';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = 'Copy';
                    btn.classList.remove('copied');
                }, 2000);
            } catch {
                btn.textContent = 'Failed';
                setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
            }
        });

        pre.appendChild(btn);
    });
}

function lineHeight() {
    const lh = parseFloat(getComputedStyle(markdownBody).lineHeight);
    if (!isNaN(lh) && lh > 0) return lh;
    // font shorthand resets line-height to "normal"; fall back to font-size * 1.5
    return (parseFloat(getComputedStyle(markdownBody).fontSize) || 16) * 1.5;
}

function applyFont(font) {
    markdownBody.style.font = font || '';
}

function openFontModal() {
    fontInput.value = currentConfig.font || '';
    updateFontPreview(fontInput.value);
    fontModal.classList.remove('hidden');
    fontInput.focus();
    fontInput.select();
}

function closeFontModal() {
    fontModal.classList.add('hidden');
}

function updateFontPreview(font) {
    fontPreview.style.font = font || '';
}

async function applyFontFromModal() {
    const font = fontInput.value.trim();
    closeFontModal();
    applyFont(font);
    currentConfig.font = font;
    try {
        await SaveConfig(currentConfig);
    } catch (err) {
        console.error('Failed to save font config:', err);
    }
}

fontInput.addEventListener('input', () => {
    updateFontPreview(fontInput.value);
});

fontInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFontFromModal();
    if (e.key === 'Escape') closeFontModal();
});

fontModalClose.addEventListener('click', closeFontModal);
fontCancelBtn.addEventListener('click', closeFontModal);
fontApplyBtn.addEventListener('click', applyFontFromModal);

fontModal.addEventListener('click', (e) => {
    if (e.target === fontModal) closeFontModal();
});

function syncDiffButtonsForActive() {
    const entry = filesByPath.get(activePath);
    const mode = entry ? entry.diffMode : 'off';
    segButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

function cycleDiffMode() {
    const entry = filesByPath.get(activePath);
    if (!entry) return;
    const next = entry.diffMode === 'off' ? entry.lastDiffMode : 'off';
    if (next !== 'off') entry.lastDiffMode = next;
    entry.diffMode = next;
    syncDiffButtonsForActive();
    renderContent();
    flashToolbar();
}

function applyPrismTheme(effective) {
    prismStyleEl.textContent = effective === 'light' ? prismLightTheme : prismDarkTheme;
}

// Returns true if the effective (resolved) color scheme is light, accounting
// for "system" mode following the OS preference. Shared by Prism and Mermaid
// so both stay in sync with the active theme.
function isEffectiveThemeLight() {
    const root = document.documentElement;
    if (root.classList.contains('theme-light')) return true;
    if (root.classList.contains('theme-dark')) return false;
    return window.matchMedia('(prefers-color-scheme: light)').matches;
}

function applyTheme(mode) {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-system');
    const validMode = (mode === 'light' || mode === 'dark' || mode === 'system') ? mode : 'system';
    root.classList.add(`theme-${validMode}`);
    document.querySelectorAll('.theme-switch [data-theme]').forEach(item => {
        item.classList.toggle('active', item.dataset.theme === validMode);
    });

    applyPrismTheme(isEffectiveThemeLight() ? 'light' : 'dark');
}

// Keep Prism/Mermaid in sync when OS preference changes while "System" mode is active
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (currentConfig.themeMode === 'system') {
        applyPrismTheme(e.matches ? 'light' : 'dark');
        if (activePath) renderContent();
    }
});

// --- Search ---
function openSearch() {
    searchPanel.classList.remove('hidden');
    searchInput.focus();
    searchInput.select();
}

function closeSearch() {
    searchPanel.classList.add('hidden');
    clearHighlights();
    searchMatches = [];
    currentMatchIdx = -1;
    searchCountEl.textContent = '';
    searchCountEl.classList.remove('no-match');
    searchInput.value = '';
    searchInput.classList.remove('no-match');
    renderScrollMarks();
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runSearch(query) {
    clearHighlights();
    searchMatches = [];
    currentMatchIdx = -1;

    if (!query) {
        searchCountEl.textContent = '';
        searchCountEl.classList.remove('no-match');
        searchInput.classList.remove('no-match');
        renderScrollMarks();
        return;
    }

    let regex;
    try {
        regex = new RegExp(searchRegexMode ? query : escapeRegex(query), 'gi');
    } catch {
        searchCountEl.classList.add('no-match');
        searchCountEl.textContent = 'Invalid regex';
        searchInput.classList.add('no-match');
        renderScrollMarks();
        return;
    }

    // Collect all text nodes first to avoid mutation issues during traversal
    const walker = document.createTreeWalker(markdownBody, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    for (const textNode of textNodes) {
        const text = textNode.nodeValue;
        regex.lastIndex = 0;
        if (!regex.test(text)) continue;
        regex.lastIndex = 0;

        const frag = document.createDocumentFragment();
        let last = 0;
        let m;
        while ((m = regex.exec(text)) !== null) {
            // Zero-length regex matches (e.g. "a*" against text with no "a")
            // would otherwise loop forever at the same lastIndex — skip them.
            if (m[0].length === 0) {
                regex.lastIndex++;
                if (regex.lastIndex > text.length) break;
                continue;
            }
            if (last < m.index) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const mark = document.createElement('mark');
            mark.className = 'search-match';
            mark.textContent = m[0];
            frag.appendChild(mark);
            searchMatches.push(mark);
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        textNode.parentNode.replaceChild(frag, textNode);
    }

    if (searchMatches.length > 0) {
        currentMatchIdx = 0;
        searchCountEl.classList.remove('no-match');
        searchInput.classList.remove('no-match');
        updateCurrentMatch();
    } else {
        searchCountEl.classList.add('no-match');
        searchCountEl.textContent = 'No matches';
        searchInput.classList.add('no-match');
        renderScrollMarks();
    }
}

function clearHighlights() {
    for (const mark of markdownBody.querySelectorAll('mark.search-match')) {
        const parent = mark.parentNode;
        mark.replaceWith(document.createTextNode(mark.textContent));
        parent?.normalize();
    }
}

function updateCurrentMatch() {
    searchMatches.forEach((m, i) => m.classList.toggle('current', i === currentMatchIdx));
    if (searchMatches.length > 0) {
        searchMatches[currentMatchIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
        searchCountEl.textContent = `${currentMatchIdx + 1} / ${searchMatches.length}`;
    }
    renderScrollMarks();
}

function searchNext() {
    if (searchMatches.length === 0) return;
    currentMatchIdx = (currentMatchIdx + 1) % searchMatches.length;
    updateCurrentMatch();
}

function searchPrev() {
    if (searchMatches.length === 0) return;
    currentMatchIdx = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    updateCurrentMatch();
}

function rerunSearchIfOpen() {
    if (searchPanel.classList.contains('hidden')) return;
    if (searchInput.value) runSearch(searchInput.value);
}

// --- File List Panel ---

// Splits an absolute directory path into an abbreviated prefix ("C/p/t/m/")
// and the full last (leaf) folder name, per the AGENTS.md grouping spec.
function abbreviateGroupLabel(dirPath) {
    const parts = dirPath.split(/[\\/]/).filter(p => p !== '');
    if (parts.length === 0) return { prefix: '', last: dirPath };
    const last = parts[parts.length - 1];
    const prefixParts = parts.slice(0, -1).map(p => p.charAt(0));
    return { prefix: prefixParts.length ? prefixParts.join('/') + '/' : '', last };
}

// Returns open files grouped by folder, groups sorted by absolute dir path
// ascending, files within a group sorted by name ascending.
function getGroupedFiles() {
    const groups = new Map();
    for (const f of filesByPath.values()) {
        if (!groups.has(f.dirPath)) groups.set(f.dirPath, []);
        groups.get(f.dirPath).push(f);
    }
    const dirPaths = [...groups.keys()].sort();
    return dirPaths.map(dirPath => ({
        dirPath,
        label: abbreviateGroupLabel(dirPath),
        files: groups.get(dirPath).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

// Flat list of every open file path, in file-list display order (ignoring
// collapse state) — used to pick the next/previous file when one is closed.
function getOrderedFilePaths() {
    const paths = [];
    for (const g of getGroupedFiles()) for (const f of g.files) paths.push(f.path);
    return paths;
}

// Flat list of keyboard-navigable items (group headers + visible file rows,
// respecting collapse state) — used for j/k/arrow navigation.
function getFlattenedItems() {
    const items = [];
    for (const g of getGroupedFiles()) {
        items.push({ type: 'group', key: `group:${g.dirPath}` });
        if (!collapsedGroups.has(g.dirPath)) {
            for (const f of g.files) items.push({ type: 'file', key: `file:${f.path}` });
        }
    }
    return items;
}

function renderFileList() {
    fileListItems.innerHTML = getGroupedFiles().map(renderGroupHTML).join('');
    fileListPanel.classList.toggle('area-focused', listFocused);
}

function renderGroupHTML(group) {
    const collapsed = collapsedGroups.has(group.dirPath);
    const hasUnseen = group.files.some(f => f.unseen);
    const groupKey = `group:${group.dirPath}`;
    const filesHTML = collapsed ? '' : group.files.map(renderFileRowHTML).join('');
    return `<div class="file-group">
      <div class="file-group-header${focusedItemKey === groupKey ? ' focused' : ''}" data-group="${escapeHTML(group.dirPath)}" title="${escapeHTML(group.dirPath)}">
        <span class="fg-collapse-mark">${collapsed ? '▶' : '▼'}</span>
        <span class="fg-label"><span class="fg-label-prefix">${escapeHTML(group.label.prefix)}</span><span class="fg-label-last">${escapeHTML(group.label.last)}</span></span>
        <span class="fg-dot${hasUnseen ? ' visible' : ''}">●</span>
      </div>
      <div class="file-group-files">${filesHTML}</div>
    </div>`;
}

function renderFileRowHTML(f) {
    const fileKey = `file:${f.path}`;
    const active = f.path === activePath;
    return `<div class="file-row${active ? ' active' : ''}${focusedItemKey === fileKey ? ' focused' : ''}" data-file="${escapeHTML(f.path)}" title="${escapeHTML(f.name)}">
      <span class="fr-name">${escapeHTML(f.name)}</span>
      <span class="fr-dot${f.unseen ? ' visible' : ''}">●</span>
    </div>`;
}

// Mouse interaction (event delegation): clicking a file opens it, clicking a
// group header toggles its collapse state. Either counts as focusing the list.
fileListItems.addEventListener('click', async (e) => {
    const groupHeader = e.target.closest('.file-group-header');
    const fileRow = e.target.closest('.file-row');
    if (groupHeader) {
        listFocused = true;
        const dirPath = groupHeader.dataset.group;
        focusedItemKey = `group:${dirPath}`;
        if (collapsedGroups.has(dirPath)) collapsedGroups.delete(dirPath);
        else collapsedGroups.add(dirPath);
        renderFileList();
    } else if (fileRow) {
        listFocused = true;
        const path = fileRow.dataset.file;
        focusedItemKey = `file:${path}`;
        await openFile(path);
        renderFileList();
    }
});

function scrollFocusedIntoView() {
    if (!focusedItemKey) return;
    const isGroup = focusedItemKey.startsWith('group:');
    const value = focusedItemKey.slice(isGroup ? 6 : 5);
    const nodes = fileListItems.querySelectorAll(isGroup ? '.file-group-header' : '.file-row');
    for (const el of nodes) {
        if ((isGroup ? el.dataset.group : el.dataset.file) === value) {
            el.scrollIntoView({ block: 'nearest' });
            break;
        }
    }
}

function moveFocus(delta) {
    const items = getFlattenedItems();
    if (items.length === 0) return;
    let idx = items.findIndex(it => it.key === focusedItemKey);
    idx = idx === -1 ? 0 : Math.max(0, Math.min(items.length - 1, idx + delta));
    focusedItemKey = items[idx].key;
    renderFileList();
    scrollFocusedIntoView();
}

async function activateFocusedItem() {
    if (!focusedItemKey) return;
    if (focusedItemKey.startsWith('group:')) {
        const dirPath = focusedItemKey.slice(6);
        if (collapsedGroups.has(dirPath)) collapsedGroups.delete(dirPath);
        else collapsedGroups.add(dirPath);
    } else {
        const path = focusedItemKey.slice(5);
        await openFile(path);
    }
}

// Enter/Space/f: perform the focused item's action. For a file, this also
// moves focus to the render area; for a group (collapse toggle), focus stays
// in the file list.
async function activateFocusedItemAndBlur() {
    const wasGroup = focusedItemKey?.startsWith('group:');
    await activateFocusedItem();
    if (wasGroup) {
        renderFileList();
        scrollFocusedIntoView();
    } else {
        blurFileListToRender();
    }
}

async function handleListQuit() {
    if (!focusedItemKey || !focusedItemKey.startsWith('file:')) return;
    const path = focusedItemKey.slice(5);
    await closeFile(path);
}

function blurFileListToRender() {
    listFocused = false;
    renderFileList();
    contentArea.focus?.({ preventScroll: true });
}

function closeFileListPanel() {
    fileListPanel.classList.add('hidden');
    splitter.classList.add('hidden');
    listFocused = false;
    contentArea.focus?.({ preventScroll: true });
}

function openFileListFocused() {
    if (!tocPanel.classList.contains('hidden')) closeTOCPanel();
    fileListPanel.classList.remove('hidden');
    splitter.classList.remove('hidden');
    listFocused = true;
    focusedItemKey = activePath ? `file:${activePath}` : (getFlattenedItems()[0]?.key ?? null);
    renderFileList();
    fileListPanel.focus?.();
    scrollFocusedIntoView();
}

function toggleFileListViaButton() {
    const isHidden = fileListPanel.classList.contains('hidden');
    if (isHidden) {
        if (!tocPanel.classList.contains('hidden')) closeTOCPanel();
        fileListPanel.classList.remove('hidden');
        splitter.classList.remove('hidden');
        renderFileList();
        hideToolbar();
    } else {
        fileListPanel.classList.add('hidden');
        splitter.classList.add('hidden');
        if (listFocused) {
            listFocused = false;
            contentArea.focus?.({ preventScroll: true });
        }
    }
}

// --- TOC Panel ---

// Rebuilds tocItems from the headings currently rendered in markdownBody.
// Called after every render (postProcessHTML) so switching files, reloading,
// or toggling diff mode keeps the TOC in sync with what's on screen.
function buildTOC() {
    const headings = markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    tocItems = [...headings].map(el => ({
        level: Number(el.tagName.slice(1)),
        text: el.textContent,
        el,
    }));
    if (focusedTocIndex >= tocItems.length) focusedTocIndex = tocItems.length - 1;
    if (!tocPanel.classList.contains('hidden')) renderTOCPanel();
}

function renderTOCPanel() {
    tocItemsEl.innerHTML = tocItems.map((item, i) =>
        `<div class="toc-item${i === focusedTocIndex ? ' focused' : ''}" style="--toc-level: ${item.level}" data-index="${i}">${escapeHTML(item.text)}</div>`
    ).join('');
    tocPanel.classList.toggle('area-focused', tocFocused);
}

// Finds the heading whose position is at or just above the current scroll
// position, so opening the TOC starts focused on what's currently on screen.
function nearestTocIndexToScroll() {
    if (tocItems.length === 0) return -1;
    const contentTop = contentArea.getBoundingClientRect().top;
    let idx = 0;
    for (let i = 0; i < tocItems.length; i++) {
        if (tocItems[i].el.getBoundingClientRect().top - contentTop <= 1) idx = i;
        else break;
    }
    return idx;
}

function scrollFocusedTocIntoView() {
    const el = tocItemsEl.querySelector(`.toc-item[data-index="${focusedTocIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
}

// While the TOC panel is visible but keyboard focus stays in the render area,
// keep the TOC selection tracking whatever heading is currently on screen.
function syncFocusedTocToScroll() {
    if (tocPanel.classList.contains('hidden') || tocFocused) return;
    const idx = nearestTocIndexToScroll();
    if (idx < 0 || idx === focusedTocIndex) return;
    focusedTocIndex = idx;
    renderTOCPanel();
    scrollFocusedTocIntoView();
}

let tocScrollSyncScheduled = false;
contentArea.addEventListener('scroll', () => {
    if (tocScrollSyncScheduled) return;
    tocScrollSyncScheduled = true;
    requestAnimationFrame(() => {
        tocScrollSyncScheduled = false;
        syncFocusedTocToScroll();
    });
});

function moveTocFocus(delta) {
    if (tocItems.length === 0) return;
    focusedTocIndex = Math.max(0, Math.min(tocItems.length - 1, focusedTocIndex + delta));
    renderTOCPanel();
    scrollFocusedTocIntoView();
}

// Scrolls the render area to the focused heading. Keeps the TOC panel open;
// callers decide whether to also move focus back to the render area.
function jumpToFocusedTocItem() {
    const item = tocItems[focusedTocIndex];
    if (!item) return;
    navigateTo(scrollTopForElement(item.el), 'instant');
}

function blurTocToRender() {
    tocFocused = false;
    renderTOCPanel();
    contentArea.focus?.({ preventScroll: true });
}

function closeTOCPanel() {
    tocPanel.classList.add('hidden');
    splitter.classList.add('hidden');
    tocFocused = false;
    contentArea.focus?.({ preventScroll: true });
}

function openTOCFocused() {
    if (!fileListPanel.classList.contains('hidden')) closeFileListPanel();
    tocPanel.classList.remove('hidden');
    splitter.classList.remove('hidden');
    tocFocused = true;
    focusedTocIndex = nearestTocIndexToScroll();
    renderTOCPanel();
    tocPanel.focus?.();
    scrollFocusedTocIntoView();
}

function toggleTOCViaButton() {
    const isHidden = tocPanel.classList.contains('hidden');
    if (isHidden) {
        if (!fileListPanel.classList.contains('hidden')) closeFileListPanel();
        tocPanel.classList.remove('hidden');
        splitter.classList.remove('hidden');
        renderTOCPanel();
        hideToolbar();
    } else {
        tocPanel.classList.add('hidden');
        splitter.classList.add('hidden');
        if (tocFocused) {
            tocFocused = false;
            contentArea.focus?.({ preventScroll: true });
        }
    }
}

tocItemsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.toc-item');
    if (!row) return;
    tocFocused = true;
    focusedTocIndex = Number(row.dataset.index);
    jumpToFocusedTocItem();
    blurTocToRender();
});

function handleTocKeydown(e) {
    switch (e.key) {
        case 'ArrowDown':
        case 'j':
            e.preventDefault();
            moveTocFocus(1);
            break;
        case 'ArrowUp':
        case 'k':
            e.preventDefault();
            moveTocFocus(-1);
            break;
        case 'Enter':
        case ' ':
        case 't':
            e.preventDefault();
            jumpToFocusedTocItem();
            blurTocToRender();
            break;
        case 'f':
            e.preventDefault();
            openFileListFocused();
            hideToolbar();
            break;
        case 'Escape':
            e.preventDefault();
            closeTOCPanel();
            break;
    }
}

async function handleFileListKeydown(e) {
    switch (e.key) {
        case 'f':
            e.preventDefault();
            await activateFocusedItemAndBlur();
            break;
        case 'Escape':
            e.preventDefault();
            closeFileListPanel();
            break;
        case 'ArrowDown':
        case 'j':
            e.preventDefault();
            moveFocus(1);
            break;
        case 'ArrowUp':
        case 'k':
            e.preventDefault();
            moveFocus(-1);
            break;
        case 'Enter':
        case ' ':
            e.preventDefault();
            await activateFocusedItemAndBlur();
            break;
        case 'q':
            e.preventDefault();
            await handleListQuit();
            break;
        case 't':
            e.preventDefault();
            openTOCFocused();
            hideToolbar();
            break;
    }
}

// --- Splitter (resize file list / render pane) ---
let isDraggingSplitter = false;
let pendingFileListRatio = null;

splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDraggingSplitter = true;
    splitter.classList.add('dragging');
});

// The file list panel and TOC panel share one width setting since only one of
// them is ever visible at a time (see AGENTS.md — they occupy the same slot).
function applySidePanelWidth(ratio) {
    const width = (ratio * 100) + '%';
    fileListPanel.style.width = width;
    tocPanel.style.width = width;
}

window.addEventListener('mousemove', (e) => {
    if (!isDraggingSplitter) return;
    const bodyRect = viewerBody.getBoundingClientRect();
    let ratio = (e.clientX - bodyRect.left) / bodyRect.width;
    ratio = Math.max(0.15, Math.min(0.6, ratio));
    applySidePanelWidth(ratio);
    pendingFileListRatio = ratio;
});

window.addEventListener('mouseup', async () => {
    if (!isDraggingSplitter) return;
    isDraggingSplitter = false;
    splitter.classList.remove('dragging');
    if (pendingFileListRatio != null) {
        currentConfig.fileListRatio = pendingFileListRatio;
        try {
            await SaveConfig(currentConfig);
        } catch (err) {
            console.error('Failed to save file list ratio:', err);
        }
        pendingFileListRatio = null;
    }
});

// --- Startup: load config and open CLI file if provided ---
(async () => {
    const [config, initialFile] = await Promise.all([LoadConfig(), GetInitialFile()]);
    currentConfig = {
        font: config.font || '',
        themeMode: config.themeMode || 'system',
        editorPath: config.editorPath || '',
        fileListRatio: config.fileListRatio || 0,
    };
    if (currentConfig.font) {
        applyFont(currentConfig.font);
    }
    applyTheme(currentConfig.themeMode);

    const initialRatio = currentConfig.fileListRatio > 0 ? currentConfig.fileListRatio : 0.3;
    applySidePanelWidth(Math.max(0.15, Math.min(0.6, initialRatio)));

    if (initialFile) {
        await openFile(initialFile);
        // On Windows the app is launched minimised (see main.go) to hide the
        // drop-area flash; restore the window now that content is rendered.
        WindowUnminimise();
    } else {
        dropArea.classList.remove('hidden');
    }
})();

// --- Front Matter ---

function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseYAMLScalar(str) {
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'")))
        return str.slice(1, -1);
    if (str.startsWith('[') && str.endsWith(']')) {
        const inner = str.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(',').map(s => {
            const t = s.trim();
            return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
                ? t.slice(1, -1) : t;
        });
    }
    if (str === 'true' || str === 'yes') return true;
    if (str === 'false' || str === 'no') return false;
    if (str === 'null' || str === '~' || str === '') return null;
    const num = Number(str);
    if (!isNaN(num) && str !== '') return num;
    return str;
}

function parseFrontMatterYAML(yamlStr) {
    const entries = [];
    const lines = yamlStr.split('\n');
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('#')) { i++; continue; }
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0) { i++; continue; }
        const key = trimmed.slice(0, colonIdx).trim();
        const rest = trimmed.slice(colonIdx + 1).trim();
        if (rest === '') {
            i++;
            const items = [], subLines = [];
            while (i < lines.length && /^\s/.test(lines[i])) {
                const s = lines[i].trim();
                if (s.startsWith('- ')) items.push(s.slice(2).trim());
                else subLines.push(s);
                i++;
            }
            if (items.length > 0) entries.push({ key, value: items });
            else if (subLines.length > 0) entries.push({ key, value: subLines.join('\n') });
            else entries.push({ key, value: null });
            continue;
        }
        entries.push({ key, value: parseYAMLScalar(rest) });
        i++;
    }
    return entries;
}

function renderFrontMatterValue(val) {
    if (val === null || val === undefined) return '<span class="fm-null">—</span>';
    if (typeof val === 'boolean') return `<span class="fm-bool">${val}</span>`;
    if (typeof val === 'number') return `<span class="fm-number">${val}</span>`;
    if (Array.isArray(val)) {
        if (val.length === 0) return '<span class="fm-null">[]</span>';
        return val.map(v => `<span class="fm-tag">${escapeHTML(String(v))}</span>`).join('');
    }
    return escapeHTML(String(val));
}

function renderFrontMatterPanel(entry) {
    const panel = document.getElementById('front-matter-panel');
    if (!entry.frontMatter) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }
    const entries = parseFrontMatterYAML(entry.frontMatter);
    if (entries.length === 0) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }
    const collapsed = entry.frontMatterCollapsed;
    const rows = entries.map(({ key, value }) =>
        `<tr><td class="fm-key">${escapeHTML(key)}</td><td class="fm-value">${renderFrontMatterValue(value)}</td></tr>`
    ).join('');
    panel.innerHTML = `<div class="fm-header"><span class="fm-title">Front Matter</span><span class="fm-toggle">${collapsed ? '▶' : '▼'}</span></div><div class="fm-body${collapsed ? ' hidden' : ''}"><table class="fm-table"><tbody>${rows}</tbody></table></div>`;
    panel.classList.remove('hidden');
    panel.querySelector('.fm-header').addEventListener('click', () => {
        entry.frontMatterCollapsed = !entry.frontMatterCollapsed;
        renderFrontMatterPanel(entry);
    });
}

// --- Toast notification ---
function showToast(message) {
    const oldToast = document.querySelector('.toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
