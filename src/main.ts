import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { AnnotationEditor, type AnnotationTool } from './annotationEditor.ts';
import { PageGridController } from './grid.ts';
import { detectLocale, dictionaries, type Locale } from './i18n.ts';
import { isPageSizeMode, type PageSizeMode } from './pageSize.ts';
import {
  detectFileKind,
  disposeLoadedSource,
  EncryptedPdfError,
  exportPagesToPdf,
  loadImageSource,
  loadPdfSource,
  renderPdfThumbnail,
  type LoadedSource,
} from './pdf.ts';
import { parsePageRanges, splitEveryN } from './split.ts';
import {
  addAnnotation,
  addSource,
  canRedo,
  canUndo,
  clearSelection,
  createInitialState,
  deleteAnnotation,
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
  selectSourcePages,
  toggleSelect,
  undo,
  updateAnnotation,
  type Rotation,
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
const btnAnnotate = getEl<HTMLButtonElement>('btn-annotate');
const btnUndo = getEl<HTMLButtonElement>('btn-undo');
const btnRedo = getEl<HTMLButtonElement>('btn-redo');
const btnSplit = getEl<HTMLButtonElement>('btn-split');
const btnExtract = getEl<HTMLButtonElement>('btn-extract');
const btnExport = getEl<HTMLButtonElement>('btn-export');
const btnHelp = getEl<HTMLButtonElement>('btn-help');
const btnLang = getEl<HTMLButtonElement>('btn-lang');
const chkStripMetadata = getEl<HTMLInputElement>('chk-strip-metadata');
const stripMetadataLabel = getEl<HTMLLabelElement>('strip-metadata-label');
const selectPageSize = getEl<HTMLSelectElement>('select-page-size');
const pageSizeLabel = getEl<HTMLLabelElement>('page-size-label');

const sourceListEl = getEl<HTMLUListElement>('source-list');
const sourceEmptyEl = getEl<HTMLParagraphElement>('source-empty');
const emptyStateEl = getEl<HTMLDivElement>('empty-state');
const deskEl = getEl<HTMLElement>('desk');
const pageGridEl = getEl<HTMLDivElement>('page-grid');
const statusSelectionEl = getEl<HTMLSpanElement>('status-selection');
const statusTotalEl = getEl<HTMLSpanElement>('status-total');
const thumbSizeSlider = getEl<HTMLInputElement>('thumb-size-slider');
const thumbSizeLabel = getEl<HTMLLabelElement>('thumb-size-label');
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

// Quick-look preview modal elements
const previewModalEl = getEl<HTMLDivElement>('preview-modal');
const previewTitleEl = getEl<HTMLSpanElement>('preview-title');
const previewSourceEl = getEl<HTMLSpanElement>('preview-source');
const previewCanvasEl = getEl<HTMLCanvasElement>('preview-canvas');
const previewAnnOverlayEl = getEl<HTMLDivElement>('preview-ann-overlay');
const btnPreviewPrev = getEl<HTMLButtonElement>('btn-preview-prev');
const btnPreviewNext = getEl<HTMLButtonElement>('btn-preview-next');
const btnPreviewRotateLeft = getEl<HTMLButtonElement>('btn-preview-rotate-left');
const btnPreviewRotateRight = getEl<HTMLButtonElement>('btn-preview-rotate-right');
const btnPreviewClose = getEl<HTMLButtonElement>('btn-preview-close');
const annColorGroupEl = getEl<HTMLDivElement>('ann-color-group');
const annTextSizeSelect = getEl<HTMLSelectElement>('ann-text-size');
const btnAnnDelete = getEl<HTMLButtonElement>('btn-ann-delete');
const annToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.ann-tool-btn')
);
const annSwatchButtons = Array.from(
  annColorGroupEl.querySelectorAll<HTMLButtonElement>('.ann-swatch')
);

let previewUid: string | null = null;
let previewRenderSeq = 0;

function syncAnnotationToolbarUI(): void {
  const tool = annEditor.getTool();
  for (const btn of annToolButtons) {
    btn.classList.toggle('is-active', btn.dataset.tool === tool);
  }
  const color = annEditor.getColor().toLowerCase();
  for (const btn of annSwatchButtons) {
    btn.classList.toggle('is-active', (btn.dataset.color ?? '').toLowerCase() === color);
  }
  annTextSizeSelect.value = String(annEditor.getTextSize());
  btnAnnDelete.disabled = !annEditor.getSelectedId();
}

const annEditor = new AnnotationEditor(previewAnnOverlayEl, {
  onAdd: (uid, ann) => {
    if (addAnnotation(state, uid, ann)) {
      renderUI();
      syncAnnotationToolbarUI();
      void renderPreviewContent();
    }
  },
  onUpdate: (uid, annId, updater) => {
    if (updateAnnotation(state, uid, annId, updater)) {
      renderUI();
      syncAnnotationToolbarUI();
      void renderPreviewContent();
    }
  },
  onDelete: (uid, annId) => {
    if (deleteAnnotation(state, uid, annId)) {
      renderUI();
      syncAnnotationToolbarUI();
      void renderPreviewContent();
    }
  },
  onToolChange: () => {
    syncAnnotationToolbarUI();
  },
  onSelectionChange: () => {
    syncAnnotationToolbarUI();
  },
});

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
  onOpenPreview: (uid) => {
    openPreviewModal(uid);
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
  btnAnnotate.title = tr.annotateTooltip;
  btnAnnotate.setAttribute('aria-label', tr.annotateTooltip);
  btnAnnDelete.title = tr.deleteAnnotationTooltip;
  btnAnnDelete.setAttribute('aria-label', tr.deleteAnnotationTooltip);
  annTextSizeSelect.setAttribute('aria-label', tr.textSizeLabel);
  btnUndo.title = `${tr.undo} (Ctrl+Z)`;
  btnUndo.setAttribute('aria-label', tr.undo);
  btnRedo.title = `${tr.redo} (Ctrl+Shift+Z)`;
  btnRedo.setAttribute('aria-label', tr.redo);
  btnHelp.title = tr.shortcutsButtonTooltip;
  btnHelp.setAttribute('aria-label', tr.shortcutsTitle);
  btnLang.textContent = tr.langToggleLabel;
  stripMetadataLabel.title = tr.stripMetadataTooltip;
  pageSizeLabel.title = tr.pageSizeTooltip;
  selectPageSize.setAttribute('aria-label', tr.pageSizeLabel);
  thumbSizeLabel.title = tr.thumbSizeLabel;
  thumbSizeSlider.setAttribute('aria-label', tr.thumbSizeLabel);
  btnPreviewRotateLeft.title = `${tr.rotateLeft} (Shift+R)`;
  btnPreviewRotateRight.title = `${tr.rotateRight} (R)`;
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
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (removeSource(state, src.id)) {
        renderUI();
      }
    });

    li.addEventListener('click', () => {
      selectSourcePages(state, src.id);
      renderSelectionUI();
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
  btnAnnotate.disabled = !hasSelection;
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

async function addFilesFromPaths(paths: string[], insertAt?: number): Promise<void> {
  const tr = t();
  let addedFiles = 0;
  let addedPages = 0;
  let cursor = insertAt;

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
        addSource(state, {
          id,
          name: fileName,
          kind: 'pdf',
          pageCount: loaded.pageCount,
          insertAt: cursor,
        });
        if (cursor !== undefined) cursor += loaded.pageCount;
        addedFiles += 1;
        addedPages += loaded.pageCount;
      } else {
        const mimeType = kind === 'image-png' ? 'image/png' : 'image/jpeg';
        const loaded = loadImageSource(fileName, mimeType, bytes);
        loadedSources.set(id, loaded);
        addSource(state, {
          id,
          name: fileName,
          kind: 'image',
          pageCount: 1,
          insertAt: cursor,
        });
        if (cursor !== undefined) cursor += 1;
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
      pageSize: getPageSizeMode(),
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

const THUMB_SIZE_KEY = 'pagefold.thumbSize';
const PAGE_SIZE_KEY = 'pagefold.pageSize';
const THUMB_SIZE_MIN = 110;
const THUMB_SIZE_MAX = 320;
const THUMB_SIZE_DEFAULT = 196;

function getPageSizeMode(): PageSizeMode {
  return isPageSizeMode(selectPageSize.value) ? selectPageSize.value : 'auto';
}

function initPageSize(): void {
  let saved: PageSizeMode = 'auto';
  try {
    const raw = window.localStorage.getItem(PAGE_SIZE_KEY);
    if (raw && isPageSizeMode(raw)) {
      saved = raw;
    }
  } catch {
    // Ignore storage errors
  }
  selectPageSize.value = saved;
}

function setThumbSize(px: number): void {
  const clamped = Math.max(THUMB_SIZE_MIN, Math.min(THUMB_SIZE_MAX, Math.round(px)));
  pageGridEl.style.setProperty('--thumb-size', `${clamped}px`);
  thumbSizeSlider.value = String(clamped);
  try {
    window.localStorage.setItem(THUMB_SIZE_KEY, String(clamped));
  } catch {
    // Ignore storage errors
  }
}

function initThumbSize(): void {
  let saved = THUMB_SIZE_DEFAULT;
  try {
    const raw = window.localStorage.getItem(THUMB_SIZE_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) saved = parsed;
    }
  } catch {
    // Ignore storage errors
  }
  setThumbSize(saved);
}

async function renderImageToPreviewCanvas(
  objectUrl: string,
  canvas: HTMLCanvasElement,
  rotation: Rotation
): Promise<{ viewWidthPt: number }> {
  const img = new Image();
  img.src = objectUrl;
  await img.decode();

  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  const rotated90 = rotation === 90 || rotation === 270;
  const targetW = rotated90 ? natH : natW;
  const targetH = rotated90 ? natW : natH;
  const scale = Math.min(1, 1000 / Math.max(targetW, targetH));

  canvas.width = Math.max(1, Math.round(targetW * scale));
  canvas.height = Math.max(1, Math.round(targetH * scale));
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, (-natW * scale) / 2, (-natH * scale) / 2, natW * scale, natH * scale);
    ctx.restore();
  }

  return { viewWidthPt: targetW * 0.75 };
}

async function renderPreviewContent(): Promise<void> {
  if (!previewUid) return;
  const idx = state.pages.findIndex((p) => p.uid === previewUid);
  if (idx === -1) {
    closePreviewModal();
    return;
  }

  const page = state.pages[idx];
  const srcInfo = state.sources.find((s) => s.id === page.sourceId);
  const loaded = loadedSources.get(page.sourceId);
  const tr = t();

  previewTitleEl.textContent = tr.previewOf(idx + 1, state.pages.length);
  previewSourceEl.textContent = srcInfo?.name ?? '';
  btnPreviewPrev.disabled = idx === 0;
  btnPreviewNext.disabled = idx === state.pages.length - 1;

  if (!loaded) return;

  const seq = ++previewRenderSeq;

  if (loaded.kind === 'image') {
    if (!loaded.objectUrl) return;
    try {
      const { viewWidthPt } = await renderImageToPreviewCanvas(
        loaded.objectUrl,
        previewCanvasEl,
        page.rotation
      );
      if (seq !== previewRenderSeq) return;
      annEditor.setPage(page, page.rotation, viewWidthPt);
    } catch {
      // Ignore decode error
    }
    return;
  }

  try {
    await renderPdfThumbnail(loaded, page.pageIndex, previewCanvasEl, 1000, page.rotation);
    if (seq !== previewRenderSeq) return;
    const srcPage = loaded.pdfDoc.getPage(page.pageIndex);
    const existingAngle = srcPage.getRotation().angle;
    const totalRot = (((existingAngle + page.rotation) % 360) + 360) % 360 as Rotation;
    const { width, height } = srcPage.getSize();
    const viewWidthPt = totalRot === 90 || totalRot === 270 ? height : width;
    annEditor.setPage(page, totalRot, viewWidthPt);
  } catch {
    // Ignore render error if closed or superseded
  }
}

function openPreviewModal(uid: string, initialTool?: AnnotationTool): void {
  if (!state.pages.some((p) => p.uid === uid)) return;
  previewUid = uid;
  if (initialTool) {
    annEditor.setTool(initialTool);
  }
  syncAnnotationToolbarUI();
  previewModalEl.hidden = false;
  void renderPreviewContent();
}

function closePreviewModal(): void {
  annEditor.setPage(null, 0, 595.28);
  previewModalEl.hidden = true;
  previewUid = null;
}

function stepPreview(delta: -1 | 1): void {
  if (!previewUid) return;
  const idx = state.pages.findIndex((p) => p.uid === previewUid);
  if (idx === -1) return;
  const nextIdx = idx + delta;
  if (nextIdx < 0 || nextIdx >= state.pages.length) return;
  previewUid = state.pages[nextIdx].uid;
  void renderPreviewContent();
}

function rotatePreviewPage(delta: 90 | -90): void {
  if (!previewUid) return;
  selectOne(state, previewUid);
  if (rotateSelected(state, delta)) {
    renderUI();
    void renderPreviewContent();
  }
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
        pageSize: getPageSizeMode(),
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
btnAnnotate.addEventListener('click', () => {
  const firstSelected = state.pages.find((p) => state.selectedUids.has(p.uid));
  if (firstSelected) {
    openPreviewModal(firstSelected.uid, 'select');
  }
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

previewModalEl.addEventListener('click', (e) => {
  if (e.target === previewModalEl) closePreviewModal();
});
btnPreviewClose.addEventListener('click', closePreviewModal);
btnPreviewPrev.addEventListener('click', () => stepPreview(-1));
btnPreviewNext.addEventListener('click', () => stepPreview(1));
btnPreviewRotateLeft.addEventListener('click', () => rotatePreviewPage(-90));
btnPreviewRotateRight.addEventListener('click', () => rotatePreviewPage(90));

for (const btn of annToolButtons) {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool as AnnotationTool | undefined;
    if (tool) {
      annEditor.setTool(tool);
      syncAnnotationToolbarUI();
    }
  });
}

for (const btn of annSwatchButtons) {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    if (color) {
      annEditor.setColor(color);
      syncAnnotationToolbarUI();
    }
  });
}

annTextSizeSelect.addEventListener('change', () => {
  const size = Number(annTextSizeSelect.value);
  if (Number.isFinite(size) && size > 0) {
    annEditor.setTextSize(size);
  }
});

btnAnnDelete.addEventListener('click', () => {
  annEditor.deleteSelected();
  syncAnnotationToolbarUI();
});

thumbSizeSlider.addEventListener('input', () => {
  setThumbSize(Number(thumbSizeSlider.value));
});

selectPageSize.addEventListener('change', () => {
  try {
    window.localStorage.setItem(PAGE_SIZE_KEY, getPageSizeMode());
  } catch {
    // Ignore storage errors
  }
});

deskEl.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const current = Number(thumbSizeSlider.value) || THUMB_SIZE_DEFAULT;
    const step = e.deltaY < 0 ? 16 : -16;
    setThumbSize(current + step);
  },
  { passive: false }
);

// Keyboard shortcuts
window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null;
  const isInput =
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.tagName === 'SELECT' ||
    target?.isContentEditable ||
    annEditor.isEditingText();

  if (e.key === 'Escape') {
    if (annEditor.isEditingText()) return;
    if (!previewModalEl.hidden) {
      closePreviewModal();
      return;
    }
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

  const mod = e.ctrlKey || e.metaKey;

  if (!previewModalEl.hidden) {
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey ? redo(state) : undo(state)) {
        renderUI();
        void renderPreviewContent();
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (redo(state)) {
        renderUI();
        void renderPreviewContent();
      }
      return;
    }
    if (!mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'v') {
        e.preventDefault();
        annEditor.setTool('select');
        return;
      }
      if (k === 't') {
        e.preventDefault();
        annEditor.setTool('text');
        return;
      }
      if (k === 'b') {
        e.preventDefault();
        annEditor.setTool('rect');
        return;
      }
      if (k === 'h') {
        e.preventDefault();
        annEditor.setTool('highlight');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (annEditor.deleteSelected()) {
          e.preventDefault();
          syncAnnotationToolbarUI();
        }
        return;
      }
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepPreview(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepPreview(1);
    } else if (!mod && !e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      rotatePreviewPage(e.shiftKey ? -90 : 90);
    } else if (e.key === ' ') {
      e.preventDefault();
      closePreviewModal();
    }
    return;
  }

  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault();
    if (shortcutsModalEl.hidden) openShortcutsModal();
    else closeShortcutsModal();
    return;
  }

  if (!splitModalEl.hidden || !shortcutsModalEl.hidden) return;

  if (e.key === ' ' && state.pages.length > 0) {
    e.preventDefault();
    const targetUid =
      state.lastSelectedUid ??
      state.selectedUids.values().next().value ??
      (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.page-card')?.dataset.uid;
    if (targetUid) {
      openPreviewModal(targetUid);
    }
    return;
  }

  if (!mod && !e.altKey && e.key.toLowerCase() === 'e' && state.pages.length > 0) {
    const firstSelected = state.pages.find((p) => state.selectedUids.has(p.uid));
    if (firstSelected) {
      e.preventDefault();
      openPreviewModal(firstSelected.uid, 'select');
    }
    return;
  }

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
  const dpr = window.devicePixelRatio || 1;
  if (event.payload.type === 'enter' || event.payload.type === 'over') {
    if (state.pages.length > 0 && 'position' in event.payload && event.payload.position) {
      dropOverlayEl.hidden = true;
      grid.showExternalDropMarker(
        event.payload.position.x / dpr,
        event.payload.position.y / dpr
      );
    } else {
      grid.hideExternalDropMarker();
      dropOverlayEl.hidden = false;
    }
  } else if (event.payload.type === 'leave') {
    dropOverlayEl.hidden = true;
    grid.hideExternalDropMarker();
  } else if (event.payload.type === 'drop') {
    dropOverlayEl.hidden = true;
    grid.hideExternalDropMarker();
    const pos = event.payload.position;
    const insertAt =
      state.pages.length > 0 && pos
        ? grid.findDropSlot(pos.x / dpr, pos.y / dpr)
        : undefined;
    void addFilesFromPaths(event.payload.paths, insertAt);
  }
});

initThumbSize();
initPageSize();
applyTranslations();

// Files passed on the command line ("Open with Pagefold")
void invoke<string[]>('startup_files')
  .then((paths) => {
    if (paths.length > 0) void addFilesFromPaths(paths);
  })
  .catch(() => {});
