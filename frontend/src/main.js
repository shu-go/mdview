import './style.css';
import './app.css';

import { LoadFile, ParseMarkdownWithDiff, WatchFile, SelectFile, GetInitialFile, OpenInNewInstance, OpenInBrowser, OpenInEditor, SetWindowTitle, ChooseEditor, LoadConfig, SaveConfig } from '../wailsjs/go/main/App';
import { EventsOn, OnFileDrop, Quit } from '../wailsjs/runtime/runtime';
import prismDarkTheme from 'prismjs/themes/prism-tomorrow.css?inline';
import prismLightTheme from 'prismjs/themes/prism.css?inline';

// Inject Prism theme via a <style> element so we can swap it at runtime
const prismStyleEl = document.createElement('style');
document.head.appendChild(prismStyleEl);

// App State
let state = {
    filePath: '',
    fileName: '',
    initialRaw: '',   // Content when file was first opened — never reset on file change
    baselineRaw: '',  // User-controlled baseline for "基準差分" mode
    currentRaw: '',
    currentHTML: '',
    diffMode: 'off', // 'off' | 'initial' | 'baseline'
};

// Persisted config (loaded at startup, updated on font/theme/editor change)
let currentConfig = { font: '', themeMode: 'system', editorPath: '' };

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
const toolbar = viewerContainer.querySelector('.toolbar');
const fileNameLabel = document.getElementById('file-name');
const btnUpdateBaseline = document.getElementById('btn-update-baseline');
const btnEditor = document.getElementById('btn-editor');
const btnFont = document.getElementById('btn-font');
const markdownBody = document.getElementById('markdown-body');
const linkPreview = document.getElementById('link-preview');
const contentArea = viewerContainer.querySelector('.content-area');
const segButtons = document.querySelectorAll('.segmented-control .seg-btn:not(.theme-btn)');
const themeBtns = document.querySelectorAll('.theme-btn');
const searchInput = searchPanel.querySelector('.search-input');
const searchCountEl = searchPanel.querySelector('.search-count');
const btnSearchPrev = searchPanel.querySelector('.search-prev');
const btnSearchNext = searchPanel.querySelector('.search-next');
const btnSearchClose = searchPanel.querySelector('.search-close-btn');

// Search state
let searchMatches = [];
let currentMatchIdx = -1;

// Wails native drag and drop handler
OnFileDrop((x, y, paths) => {
    if (paths && paths.length > 0) {
        const path = paths[0];
        const lowerPath = path.toLowerCase();
        if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown') || lowerPath.endsWith('.txt')) {
            openFile(path);
        } else {
            alert('Please drop a Markdown file (.md, .markdown, .txt).');
        }
    }
}, true);

// Click to select file dialog
dropArea.addEventListener('click', async () => {
    try {
        const path = await SelectFile();
        if (path) {
            await openFile(path);
        }
    } catch (err) {
        console.error('Failed to select file:', err);
    }
});

// --- Toolbar Event Listeners ---
segButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.diffMode = btn.dataset.mode;
        renderContent();
    });
});

btnUpdateBaseline.addEventListener('click', () => {
    state.baselineRaw = state.currentRaw;
    renderContent();
    showToast('Baseline updated to current content');
});

btnEditor.addEventListener('click', async () => {
    try {
        const editorPath = await ChooseEditor();
        if (editorPath) {
            currentConfig.editorPath = editorPath;
            updateEditorButtonTitle();
            await SaveConfig(currentConfig);
        }
    } catch (err) {
        console.error('Editor selection failed:', err);
    }
});

btnFont.addEventListener('click', () => {
    openFontModal();
});

// Theme buttons
themeBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const mode = btn.dataset.theme;
        applyTheme(mode);
        currentConfig.themeMode = mode;
        try {
            await SaveConfig(currentConfig);
        } catch (err) {
            console.error('Failed to save theme:', err);
        }
    });
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

btnSearchPrev.addEventListener('click', searchPrev);
btnSearchNext.addEventListener('click', searchNext);
btnSearchClose.addEventListener('click', closeSearch);

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        if (!state.filePath) return;
        if (!currentConfig.editorPath) {
            showToast('No editor configured — click the Editor button to select one');
            return;
        }
        try {
            await OpenInEditor(currentConfig.editorPath, state.filePath);
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
        showToolbar();
        clearTimeout(toolbarHideTimer);
        toolbarHideTimer = setTimeout(() => toolbar.classList.remove('visible'), 1500);
        return;
    }
    if (e.ctrlKey && e.key === 'w' || e.key === 'q') {
        e.preventDefault();
        Quit();
        return;
    }
    if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) searchPrev(); else searchNext();
        return;
    }
    if (e.key === 'Escape' && !searchPanel.classList.contains('hidden')) {
        closeSearch();
        return;
    }

    // Vim-like scroll and / search opener: skip when a text input is focused
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    switch (e.key) {
        case '/':
            e.preventDefault();
            openSearch();
            break;
        case 'j':
            e.preventDefault();
            contentArea.scrollBy({ top: lineHeight(), behavior: 'instant' });
            break;
        case 'k':
            e.preventDefault();
            contentArea.scrollBy({ top: -lineHeight(), behavior: 'instant' });
            break;
        case 'b':
            e.preventDefault();
            contentArea.scrollBy({ top: -contentArea.clientHeight, behavior: 'instant' });
            break;
        case ' ':
            if (e.shiftKey) {
                e.preventDefault();
                contentArea.scrollBy({ top: -contentArea.clientHeight, behavior: 'instant' });
            }
            break;
        case 'g':
            e.preventDefault();
            contentArea.scrollTo({ top: 0, behavior: 'instant' });
            break;
        case 'G':
            e.preventDefault();
            contentArea.scrollTo({ top: contentArea.scrollHeight, behavior: 'instant' });
            break;
    }
});

// Toolbar overlay: show when mouse enters top 48px of viewer, hide otherwise
let toolbarHideTimer = null;

function showToolbar() {
    clearTimeout(toolbarHideTimer);
    toolbar.classList.add('visible');
}

function scheduleHideToolbar() {
    clearTimeout(toolbarHideTimer);
    toolbarHideTimer = setTimeout(() => toolbar.classList.remove('visible'), 400);
}

viewerContainer.addEventListener('mousemove', (e) => {
    const top = viewerContainer.getBoundingClientRect().top;
    if (e.clientY - top < 48) showToolbar();
    else if (!toolbar.matches(':hover')) scheduleHideToolbar();
});
viewerContainer.addEventListener('mouseleave', scheduleHideToolbar);
toolbar.addEventListener('mouseenter', showToolbar);
toolbar.addEventListener('mouseleave', scheduleHideToolbar);

// Show link destination in status bar on hover (like browser status bar)
markdownBody.addEventListener('mouseover', (e) => {
    const anchor = e.target.closest('a');
    if (!anchor) {
        linkPreview.classList.remove('visible');
        return;
    }
    const href = anchor.getAttribute('href');
    if (!href) {
        linkPreview.classList.remove('visible');
        return;
    }

    let display;
    if (href.startsWith('#')) {
        display = href;
    } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        display = href;
    } else {
        const resolved = resolveFilePath(state.filePath, href);
        const lower = resolved.toLowerCase();
        if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
            display = resolved;
        } else {
            display = 'file:///' + resolved.replace(/\\/g, '/');
        }
    }

    linkPreview.textContent = display;
    linkPreview.classList.add('visible');
});

markdownBody.addEventListener('mouseleave', () => {
    linkPreview.classList.remove('visible');
});

// Intercept link clicks in the rendered markdown
markdownBody.addEventListener('click', async (e) => {
    const anchor = e.target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return; // let in-page anchors work normally

    e.preventDefault();

    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        await OpenInBrowser(href);
        return;
    }

    // Local file link — resolve relative to current file
    const resolved = resolveFilePath(state.filePath, href);
    const lower = resolved.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
        await OpenInNewInstance(resolved);
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
async function openFile(path) {
    try {
        const result = await LoadFile(path);

        state.filePath = path;
        state.fileName = path.split(/[/\\]/).pop();
        state.initialRaw = result.raw;   // Set once on open, never reset by file changes
        state.baselineRaw = result.raw;
        state.currentRaw = result.raw;
        state.currentHTML = result.html;
        state.diffMode = 'off';

        fileNameLabel.textContent = state.fileName;
        SetWindowTitle(`${state.fileName} - mdview`);

        segButtons.forEach(b => {
            if (b.dataset.mode === 'off') b.classList.add('active');
            else b.classList.remove('active');
        });

        dropArea.classList.add('hidden');
        viewerContainer.classList.remove('hidden');

        await WatchFile(path);
        renderContent();
    } catch (err) {
        console.error('Failed to open file:', err);
        alert('Failed to load file: ' + err);
    }
}

function closeFile() {
    state = {
        filePath: '',
        fileName: '',
        initialRaw: '',
        baselineRaw: '',
        currentRaw: '',
        currentHTML: '',
        diffMode: 'off',
    };

    SetWindowTitle('mdview');
    viewerContainer.classList.add('hidden');
    dropArea.classList.remove('hidden');
    closeSearch();
}

// File change detected by watcher — update currentRaw/currentHTML only,
// keeping initialRaw and baselineRaw intact so diff modes still work.
EventsOn('file-changed', async (_filePath) => {
    if (!state.filePath) return;
    try {
        const result = await LoadFile(state.filePath);
        state.currentRaw = result.raw;
        state.currentHTML = result.html;
        renderContent();
        showToast('File change detected — reloaded');
    } catch (err) {
        console.error('Failed to reload file:', err);
    }
});

// --- Rendering Logic ---
async function renderContent() {
    if (state.diffMode === 'off') {
        markdownBody.innerHTML = state.currentHTML;
        stripEventHandlers(markdownBody);
        postProcessHTML();
        rerunSearchIfOpen();
        return;
    }

    const baseRaw = state.diffMode === 'initial' ? state.initialRaw : state.baselineRaw;
    try {
        // Go renders both base and current to HTML, then diffs at the HTML line level.
        // This avoids Markdown structure being broken by injecting tags into source.
        const diffHTML = await ParseMarkdownWithDiff(baseRaw, state.currentRaw);
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
            if (!mermaidInitialized) {
                mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
                mermaidInitialized = true;
            }
            await mermaid.run({ nodes: mermaidContainers });
        } catch (err) {
            console.error('Mermaid render error:', err);
        }
    }

    // 2. Syntax highlighting with Prism (lazy-loaded)
    if (markdownBody.querySelector('pre code[class*="language-"]')) {
        const { default: Prism } = await import('prismjs');
        Prism.highlightAllUnder(markdownBody);
    }
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

function updateEditorButtonTitle() {
    const path = currentConfig.editorPath;
    btnEditor.title = path
        ? `Editor: ${path} (Ctrl+E to open current file)`
        : 'Select editor executable';
}

function cycleDiffMode() {
    if (!state.filePath) return;
    const modes = ['off', 'initial', 'baseline'];
    const next = modes[(modes.indexOf(state.diffMode) + 1) % modes.length];
    state.diffMode = next;
    segButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === next));
    renderContent();
}

function applyPrismTheme(effective) {
    prismStyleEl.textContent = effective === 'light' ? prismLightTheme : prismDarkTheme;
}

function applyTheme(mode) {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-system');
    const validMode = (mode === 'light' || mode === 'dark' || mode === 'system') ? mode : 'system';
    root.classList.add(`theme-${validMode}`);
    themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === validMode));

    const isLight = validMode === 'light' ||
        (validMode === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    applyPrismTheme(isLight ? 'light' : 'dark');
}

// Keep Prism in sync when OS preference changes while "System" mode is active
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (currentConfig.themeMode === 'system') {
        applyPrismTheme(e.matches ? 'light' : 'dark');
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
        return;
    }

    const regex = new RegExp(escapeRegex(query), 'gi');

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

// --- Startup: load config and open CLI file if provided ---
(async () => {
    const [config, initialFile] = await Promise.all([LoadConfig(), GetInitialFile()]);
    currentConfig = {
        font: config.font || '',
        themeMode: config.themeMode || 'system',
        editorPath: config.editorPath || '',
    };
    if (currentConfig.font) {
        applyFont(currentConfig.font);
    }
    applyTheme(currentConfig.themeMode);
    updateEditorButtonTitle();
    if (initialFile) {
        await openFile(initialFile);
    }
})();

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
