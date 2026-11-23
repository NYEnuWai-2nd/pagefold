import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { PageGridController } from './grid.ts';
import { detectLocale, dictionaries, type Locale } from './i18n.ts';
import {
  detectFileKind,
  disposeLoadedSource,
  EncryptedPdfError,
  exportPagesToPdf,
  loadImageSource,
  loadPdfSource,
  type LoadedSource,
} from './pdf.ts';
import { parsePageRanges, splitEveryN } from './split.ts';
import {
  addSource,
  canRedo,
  canUndo,
  clearSelection,
  createInitialState,
  deleteSelected,
  getReferencedSourceIds,
  moveSelectionBy,
  redo,
  removeSource,
  reorderSelection,
  rotateSelected,
  selectAll,
  selectOne,
  selectRange,
  toggleSelect,
  undo,
} from './state.ts';

const state = createInitialState();
const loadedSources = new Map<string, LoadedSource>();
let currentLocale: Locale = detectLocale();
let sourceIdCounter = 1;

function t() {
  return dictionaries[currentLocale];
}

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const btnAdd = getEl<HTMLButtonElement>('btn-add');
const btnEmptyAdd = getEl<HTMLButtonElement>('btn-empty-add');
const btnRotateLeft = getEl<HTMLButtonElement>('btn-rotate-left');
const btnRotateRight = getEl<HTMLButtonElement>('btn-rotate-right');
const btnDelete = getEl<HTMLButtonElement>('btn-delete');
const btnUndo = getEl<HTMLButtonElement>('btn-undo');
const btnRedo = getEl<HTMLButtonElement>('btn-redo');
const btnSplit = getEl<HTMLButtonElement>('btn-split');
const btnExtract = getEl<HTMLButtonElement>('btn-extract');
const btnExport = getEl<HTMLButtonElement>('btn-export');
const btnHelp = getEl<HTMLButtonElement>('btn-help');
const btnLang = getEl<HTMLButtonElement>('btn-lang');
const chkStripMetadata = getEl<HTMLInputElement>('chk-strip-metadata');
const stripMetadataLabel = getEl<HTMLLabelElement>('strip-metadata-label');

const sourceListEl = getEl<HTMLUListElement>('source-list');
const sourceEmptyEl = getEl<HTMLParagraphElement>('source-empty');
const emptyStateEl = getEl<HTMLDivElement>('empty-state');
const pageGridEl = getEl<HTMLDivElement>('page-grid');
const statusSelectionEl = getEl<HTMLSpanElement>('status-selection');
const statusTotalEl = getEl<HTMLSpanElement>('status-total');
const dropOverlayEl = getEl<HTMLDivElement>('drop-overlay');
const toastContainerEl = getEl<HTMLDivElement>('toast-container');

// Split modal elements
const splitModalEl = getEl<HTMLDivElement>('split-modal');
const splitFormEl = getEl<HTMLFormElement>('split-form');
const btnSplitClose = getEl<HTMLButtonElement>('btn-split-close');
const btnSplitCancel = getEl<HTMLButtonElement>('btn-split-cancel');
const splitEveryNGroup = getEl<HTMLDivElement>('split-every-n-group');
const splitRangesGroup = getEl<HTMLDivElement>('split-ranges-group');
const inputEveryN = getEl<HTMLInputElement>('input-every-n');
const inputRanges = getEl<HTMLInputElement>('input-ranges');
const splitRangesHint = getEl<HTMLParagraphElement>('split-ranges-hint');
const splitPreview = getEl<HTMLParagraphElement>('split-preview');
const splitError = getEl<HTMLParagraphElement>('split-error');

// Shortcuts modal elements
const shortcutsModalEl = getEl<HTMLDivElement>('shortcuts-modal');
const btnShortcutsClose = getEl<HTMLButtonElement>('btn-shortcuts-close');

const grid = new PageGridController(pageGridEl, loadedSources, {
  onSelectOne: (uid) => {
    selectOne(state, uid);
    renderSelectionUI();
  },
  onToggleSelect: (uid) => {
    toggleSelect(state, uid);
    renderSelectionUI();
  },
  onSelectRange: (uid) => {
    selectRange(state, uid);
    renderSelectionUI();
  },
  onClearSelection: () => {
    clearSelection(state);
    renderSelectionUI();
  },
  onReorder: (targetIndex) => {
    if (reorderSelection(state, targetIndex)) {
      renderUI();
    }
  },
  getTranslationPageLabel: (n) => t().pageLabel(n),
});

function showToast(message: string, kind: 'success' | 'error'): void {
  const toast = document.createElement('div');
  toast.className = `toast is-${kind}`;

  const text = document.createElement('span');
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t().close);
  closeBtn.addEventListener('click', () => toast.remove());

  toast.append(text, closeBtn);
  toastContainerEl.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 5500);
}

function applyTranslations(): void {
  const tr = t();
  document.documentElement.lang = currentLocale;

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as keyof typeof tr;
    const val = tr[key];
    if (typeof val === 'string') {
      el.textContent = val;
    }
  }

  btnAdd.title = tr.addFilesTooltip;
  btnRotateLeft.title = `${tr.rotateLeft} (Shift+R)`;
  btnRotateLeft.setAttribute('aria-label', tr.rotateLeft);
  btnRotateRight.title = `${tr.rotateRight} (R)`;
  btnRotateRight.setAttribute('aria-label', tr.rotateRight);
  btnDelete.title = `${tr.deleteSelected} (Delete)`;
  btnDelete.setAttribute('aria-label', tr.deleteSelected);
  btnUndo.title = `${tr.undo} (Ctrl+Z)`;
  btnUndo.setAttribute('aria-label', tr.undo);
  btnRedo.title = `${tr.redo} (Ctrl+Shift+Z)`;
  btnRedo.setAttribute('aria-label', tr.redo);
  btnHelp.title = tr.shortcutsButtonTooltip;
  btnHelp.setAttribute('aria-label', tr.shortcutsTitle);
  btnLang.textContent = tr.langToggleLabel;
  stripMetadataLabel.title = tr.stripMetadataTooltip;
  inputRanges.placeholder = tr.splitRangesPlaceholder;

  renderUI();
}

function renderSidebar(): void {
  const tr = t();
  sourceListEl.replaceChildren();
  sourceEmptyEl.hidden = state.sources.length > 0;

  for (const src of state.sources) {
    const li = document.createElement('li');
    li.className = 'source-item';
    li.style.setProperty('--source-color', `var(--tag-${src.colorIndex % 8})`);

    const dot = document.createElement('span');
    dot.className = 'source-item-dot';

    const info = document.createElement('div');
    info.className = 'source-item-info';

    const name = document.createElement('div');
    name.className = 'source-item-name';
    name.textContent = src.name;
    name.title = src.name;

    const meta = document.createElement('div');
    meta.className = 'source-item-meta';
    meta.textContent = tr.pageCount(src.pageCount);

    info.append(name, meta);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'source-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = tr.removeSourceTooltip;
    removeBtn.setAttribute('aria-label', `${tr.removeSourceTooltip}: ${src.name}`);
    removeBtn.addEventListener('click', () => {
      if (removeSource(state, src.id)) {
        renderUI();
      }
    });

    li.append(dot, info, removeBtn);
    sourceListEl.appendChild(li);
  }
}

function pruneUnreferencedSources(): void {
  const referenced = getReferencedSourceIds(state);
  for (const [id, loaded] of loadedSources.entries()) {
    if (!referenced.has(id)) {
      disposeLoadedSource(loaded);
      loadedSources.delete(id);
      grid.clearThumbnailCacheForSource(id);
    }
  }
}

function updateToolbarAndStatus(): void {
  const tr = t();
  const hasPages = state.pages.length > 0;
  const hasSelection = state.selectedUids.size > 0;

  emptyStateEl.hidden = hasPages;
  pageGridEl.hidden = !hasPages;

  btnRotateLeft.disabled = !hasSelection;
  btnRotateRight.disabled = !hasSelection;
  btnDelete.disabled = !hasSelection;
  btnExtract.disabled = !hasSelection;
  btnExport.disabled = !hasPages;
  btnSplit.disabled = !hasPages;
  btnUndo.disabled = !canUndo(state);
  btnRedo.disabled = !canRedo(state);

  statusSelectionEl.textContent = hasSelection ? tr.selectedCount(state.selectedUids.size) : '';
  statusTotalEl.textContent = hasPages ? tr.totalPages(state.pages.length) : '';
}

function renderSelectionUI(): void {
  updateToolbarAndStatus();
  grid.updateSelection(state.selectedUids);
}

function renderUI(): void {
  pruneUnreferencedSources();
  updateToolbarAndStatus();
  renderSidebar();
  grid.render(state.pages, state.sources, state.selectedUids);
}

function extractFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

async function addFilesFromPaths(paths: string[]): Promise<void> {
  const tr = t();
  let addedFiles = 0;
  let addedPages = 0;

  for (const filePath of paths) {
    const fileName = extractFileName(filePath);
    const kind = detectFileKind(fileName);
    if (!kind) continue;

    try {
      const bytes = await readFile(filePath);
      const id = `src-${sourceIdCounter++}`;

      if (kind === 'pdf') {
        const loaded = await loadPdfSource(fileName, bytes);
        loadedSources.set(id, loaded);
        addSource(state, { id, name: fileName, kind: 'pdf', pageCount: loaded.pageCount });
        addedFiles += 1;
        addedPages += loaded.pageCount;
      } else {
        const mimeType = kind === 'image-png' ? 'image/png' : 'image/jpeg';
        const loaded = loadImageSource(fileName, mimeType, bytes);
        loadedSources.set(id, loaded);
        addSource(state, { id, name: fileName, kind: 'image', pageCount: 1 });
        addedFiles += 1;
        addedPages += 1;
      }
    } catch (err) {
      if (err instanceof EncryptedPdfError) {
        showToast(tr.toastEncryptedPdf(fileName), 'error');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(tr.toastLoadError(fileName, msg), 'error');
      }
    }
  }

  if (addedFiles > 0) {
    renderUI();
    showToast(tr.toastAddedFiles(addedFiles, addedPages), 'success');
  }
}

async function handleOpenDialog(): Promise<void> {
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: 'PDF & Images',
        extensions: ['pdf', 'png', 'jpg', 'jpeg'],
      },
    ],
  });

  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  await addFilesFromPaths(paths);
}

function defaultExportFileName(): string {
  if (state.sources.length === 1) {
    return `${stripExtension(state.sources[0].name)}-edited.pdf`;
  }
  return 'pagefold-merged.pdf';
}

async function handleExport(onlySelected: boolean): Promise<void> {
  const tr = t();
  const targetPages = onlySelected
    ? state.pages.filter((p) => state.selectedUids.has(p.uid))
    : state.pages;

  if (targetPages.length === 0) return;

  const savePath = await save({
    defaultPath: onlySelected ? 'pagefold-extracted.pdf' : defaultExportFileName(),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (!savePath) return;

  try {
    const bytes = await exportPagesToPdf(targetPages, loadedSources, {
      stripMetadata: chkStripMetadata.checked,
    });
    await writeFile(savePath, bytes);
    showToast(tr.toastSaved(targetPages.length, savePath), 'success');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(tr.toastExportError(msg), 'error');
  }
}

function getSplitMode(): 'everyN' | 'ranges' {
  const checked = splitFormEl.querySelector<HTMLInputElement>('input[name="splitMode"]:checked');
  return checked?.value === 'ranges' ? 'ranges' : 'everyN';
}

function computeSplitParts(): { ok: true; parts: number[][] } | { ok: false; message: string } {
  const tr = t();
  const total = state.pages.length;
  const mode = getSplitMode();

  if (mode === 'everyN') {
    const n = Number(inputEveryN.value);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, message: tr.errorInvalidEveryN };
    }
    return { ok: true, parts: splitEveryN(n, total) };
  }

  const parsed = parsePageRanges(inputRanges.value, total);
  if (!parsed.ok) {
    if (parsed.reason === 'empty') {
      return { ok: false, message: tr.errorEmptyRanges };
    }
    if (parsed.reason === 'out_of_range') {
      return { ok: false, message: tr.errorOutOfRange(parsed.token ?? '', total) };
    }
    return { ok: false, message: tr.errorInvalidToken(parsed.token ?? '') };
  }
  return { ok: true, parts: parsed.parts };
}

function updateSplitDialogUI(): void {
  const tr = t();
  const mode = getSplitMode();
  splitEveryNGroup.hidden = mode !== 'everyN';
  splitRangesGroup.hidden = mode !== 'ranges';
  splitRangesHint.textContent = tr.splitRangesHint(state.pages.length);

  const res = computeSplitParts();
  if (res.ok) {
    splitPreview.textContent = tr.splitPreviewParts(res.parts.length);
    splitPreview.hidden = false;
    splitError.hidden = true;
  } else {
    splitPreview.hidden = true;
    splitError.textContent = res.message;
    splitError.hidden = false;
  }
}

function openSplitModal(): void {
  if (state.pages.length === 0) return;
  splitModalEl.hidden = false;
  updateSplitDialogUI();
  if (getSplitMode() === 'everyN') {
    inputEveryN.focus();
  } else {
    inputRanges.focus();
  }
}

function closeSplitModal(): void {
  splitModalEl.hidden = true;
}

function openShortcutsModal(): void {
  shortcutsModalEl.hidden = false;
}

function closeShortcutsModal(): void {
  shortcutsModalEl.hidden = true;
}

function joinPath(dir: string, fileName: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith('\\') || dir.endsWith('/') ? `${dir}${fileName}` : `${dir}${sep}${fileName}`;
}

async function handleSplitSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const tr = t();
  const res = computeSplitParts();
  if (!res.ok) {
    updateSplitDialogUI();
    return;
  }

  const folder = await open({
    directory: true,
    multiple: false,
  });

  if (!folder || Array.isArray(folder)) return;

  const baseName =
    state.sources.length > 0 ? stripExtension(state.sources[0].name) : 'pagefold';

  try {
    for (let i = 0; i < res.parts.length; i++) {
      const partPages = res.parts[i].map((idx) => state.pages[idx]);
      const bytes = await exportPagesToPdf(partPages, loadedSources, {
        stripMetadata: chkStripMetadata.checked,
      });
      const outPath = joinPath(folder, `${baseName}-part${i + 1}.pdf`);
      await writeFile(outPath, bytes);
    }
    closeSplitModal();
    showToast(tr.toastSplitSaved(res.parts.length, folder), 'success');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(tr.toastExportError(msg), 'error');
  }
}

// Wire toolbar & modal controls
btnAdd.addEventListener('click', () => void handleOpenDialog());
btnEmptyAdd.addEventListener('click', () => void handleOpenDialog());
btnRotateLeft.addEventListener('click', () => {
  if (rotateSelected(state, -90)) renderUI();
});
btnRotateRight.addEventListener('click', () => {
  if (rotateSelected(state, 90)) renderUI();
});
btnDelete.addEventListener('click', () => {
  if (deleteSelected(state)) renderUI();
});
btnUndo.addEventListener('click', () => {
  if (undo(state)) renderUI();
});
btnRedo.addEventListener('click', () => {
  if (redo(state)) renderUI();
});
btnExport.addEventListener('click', () => void handleExport(false));
btnExtract.addEventListener('click', () => void handleExport(true));
btnSplit.addEventListener('click', openSplitModal);
btnSplitClose.addEventListener('click', closeSplitModal);
btnSplitCancel.addEventListener('click', closeSplitModal);
splitFormEl.addEventListener('submit', (e) => void handleSplitSubmit(e));
splitFormEl.addEventListener('input', updateSplitDialogUI);
splitFormEl.addEventListener('change', updateSplitDialogUI);

btnHelp.addEventListener('click', () => {
  if (shortcutsModalEl.hidden) openShortcutsModal();
  else closeShortcutsModal();
});
btnShortcutsClose.addEventListener('click', closeShortcutsModal);

btnLang.addEventListener('click', () => {
  currentLocale = currentLocale === 'en' ? 'ja' : 'en';
  applyTranslations();
});

splitModalEl.addEventListener('click', (e) => {
  if (e.target === splitModalEl) closeSplitModal();
});
shortcutsModalEl.addEventListener('click', (e) => {
  if (e.target === shortcutsModalEl) closeShortcutsModal();
});

// Keyboard shortcuts
window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null;
  const isInput =
    target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

  if (e.key === 'Escape') {
    if (!splitModalEl.hidden) {
      closeSplitModal();
      return;
    }
    if (!shortcutsModalEl.hidden) {
      closeShortcutsModal();
      return;
    }
    clearSelection(state);
    renderSelectionUI();
    return;
  }

  if (isInput) return;

  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault();
    if (shortcutsModalEl.hidden) openShortcutsModal();
    else closeShortcutsModal();
    return;
  }

  if (!splitModalEl.hidden || !shortcutsModalEl.hidden) return;

  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selectAll(state);
    renderSelectionUI();
    return;
  }

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      if (redo(state)) renderUI();
    } else {
      if (undo(state)) renderUI();
    }
    return;
  }

  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    if (redo(state)) renderUI();
    return;
  }

  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    if (moveSelectionBy(state, -1)) renderUI();
    return;
  }

  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    if (moveSelectionBy(state, 1)) renderUI();
    return;
  }

  if (!mod && !e.altKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    if (rotateSelected(state, e.shiftKey ? -90 : 90)) renderUI();
    return;
  }

  if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    if (deleteSelected(state)) renderUI();
  }
});

// Tauri native file drag-and-drop
void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type === 'enter' || event.payload.type === 'over') {
    dropOverlayEl.hidden = false;
  } else if (event.payload.type === 'leave') {
    dropOverlayEl.hidden = true;
  } else if (event.payload.type === 'drop') {
    dropOverlayEl.hidden = true;
    void addFilesFromPaths(event.payload.paths);
  }
});

applyTranslations();

// Files passed on the command line ("Open with Pagefold")
void invoke<string[]>('startup_files')
  .then((paths) => {
    if (paths.length > 0) void addFilesFromPaths(paths);
  })
  .catch(() => {});
