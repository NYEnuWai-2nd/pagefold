export type Rotation = 0 | 90 | 180 | 270;
export type SourceKind = 'pdf' | 'image';

export type Annotation =
  | { id: string; kind: 'text'; x: number; y: number; text: string; size: number; color: string }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number; color: string; stroke: number }
  | { id: string; kind: 'highlight'; x: number; y: number; w: number; h: number; color: string };

export interface SourceFileInfo {
  id: string;
  name: string;
  kind: SourceKind;
  pageCount: number;
  colorIndex: number;
}

export interface PageItem {
  uid: string;
  sourceId: string;
  pageIndex: number; // 0-based index within the source
  rotation: Rotation; // delta rotation in degrees
  annotations?: Annotation[];
}

export interface HistorySnapshot {
  sources: SourceFileInfo[];
  pages: PageItem[];
}

export interface AppState {
  sources: SourceFileInfo[];
  pages: PageItem[];
  selectedUids: Set<string>;
  lastSelectedUid: string | null;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  nextColorIndex: number;
  nextUidCounter: number;
}

const MAX_HISTORY = 100;

export function createInitialState(): AppState {
  return {
    sources: [],
    pages: [],
    selectedUids: new Set(),
    lastSelectedUid: null,
    past: [],
    future: [],
    nextColorIndex: 0,
    nextUidCounter: 1,
  };
}

function clonePage(page: PageItem): PageItem {
  return {
    ...page,
    annotations: page.annotations ? page.annotations.map((a) => ({ ...a })) : undefined,
  };
}

function cloneSnapshot(state: AppState): HistorySnapshot {
  return {
    sources: state.sources.map((s) => ({ ...s })),
    pages: state.pages.map(clonePage),
  };
}

function pushHistory(state: AppState): void {
  state.past.push(cloneSnapshot(state));
  if (state.past.length > MAX_HISTORY) {
    state.past.shift();
  }
  state.future = [];
}

function normalizeRotation(deg: number): Rotation {
  const mod = ((deg % 360) + 360) % 360;
  if (mod === 90 || mod === 180 || mod === 270) return mod;
  return 0;
}

function pruneSelection(state: AppState): void {
  const valid = new Set(state.pages.map((p) => p.uid));
  for (const uid of state.selectedUids) {
    if (!valid.has(uid)) {
      state.selectedUids.delete(uid);
    }
  }
  if (state.lastSelectedUid && !valid.has(state.lastSelectedUid)) {
    state.lastSelectedUid = null;
  }
}

export function addSource(
  state: AppState,
  input: { id: string; name: string; kind: SourceKind; pageCount: number; insertAt?: number }
): { source: SourceFileInfo; addedPages: PageItem[] } {
  pushHistory(state);

  const source: SourceFileInfo = {
    id: input.id,
    name: input.name,
    kind: input.kind,
    pageCount: input.pageCount,
    colorIndex: state.nextColorIndex,
  };
  state.nextColorIndex += 1;
  state.sources.push(source);

  const addedPages: PageItem[] = [];
  for (let i = 0; i < input.pageCount; i++) {
    const page: PageItem = {
      uid: `p-${state.nextUidCounter++}`,
      sourceId: source.id,
      pageIndex: i,
      rotation: 0,
    };
    addedPages.push(page);
  }

  const insertAt =
    input.insertAt === undefined
      ? state.pages.length
      : Math.max(0, Math.min(state.pages.length, input.insertAt));
  state.pages.splice(insertAt, 0, ...addedPages);

  return { source, addedPages };
}

export function removeSource(state: AppState, sourceId: string): boolean {
  const exists = state.sources.some((s) => s.id === sourceId);
  if (!exists) return false;

  pushHistory(state);
  state.sources = state.sources.filter((s) => s.id !== sourceId);
  state.pages = state.pages.filter((p) => p.sourceId !== sourceId);
  pruneSelection(state);
  return true;
}

export function selectOne(state: AppState, uid: string): void {
  if (!state.pages.some((p) => p.uid === uid)) return;
  state.selectedUids = new Set([uid]);
  state.lastSelectedUid = uid;
}

export function toggleSelect(state: AppState, uid: string): void {
  if (!state.pages.some((p) => p.uid === uid)) return;
  if (state.selectedUids.has(uid)) {
    state.selectedUids.delete(uid);
  } else {
    state.selectedUids.add(uid);
  }
  state.lastSelectedUid = uid;
}

export function selectRange(state: AppState, uid: string): void {
  const targetIdx = state.pages.findIndex((p) => p.uid === uid);
  if (targetIdx === -1) return;

  const anchorIdx = state.lastSelectedUid
    ? state.pages.findIndex((p) => p.uid === state.lastSelectedUid)
    : -1;

  if (anchorIdx === -1) {
    selectOne(state, uid);
    return;
  }

  const start = Math.min(anchorIdx, targetIdx);
  const end = Math.max(anchorIdx, targetIdx);
  const next = new Set(state.selectedUids);
  for (let i = start; i <= end; i++) {
    next.add(state.pages[i].uid);
  }
  state.selectedUids = next;
  state.lastSelectedUid = uid;
}

export function selectAll(state: AppState): void {
  state.selectedUids = new Set(state.pages.map((p) => p.uid));
  if (state.pages.length > 0) {
    state.lastSelectedUid = state.pages[state.pages.length - 1].uid;
  }
}

export function selectSourcePages(state: AppState, sourceId: string): void {
  const matching = state.pages.filter((p) => p.sourceId === sourceId);
  state.selectedUids = new Set(matching.map((p) => p.uid));
  state.lastSelectedUid = matching.length > 0 ? matching[matching.length - 1].uid : null;
}

export function clearSelection(state: AppState): void {
  state.selectedUids.clear();
  state.lastSelectedUid = null;
}

export function rotateSelected(state: AppState, delta: 90 | -90): boolean {
  if (state.selectedUids.size === 0) return false;
  pushHistory(state);
  for (const page of state.pages) {
    if (state.selectedUids.has(page.uid)) {
      page.rotation = normalizeRotation(page.rotation + delta);
    }
  }
  return true;
}

export function deleteSelected(state: AppState): boolean {
  if (state.selectedUids.size === 0) return false;
  pushHistory(state);
  state.pages = state.pages.filter((p) => !state.selectedUids.has(p.uid));
  state.selectedUids.clear();
  state.lastSelectedUid = null;
  return true;
}

/**
 * Reorder all currently selected pages (preserving their relative order)
 * to insert at `targetIndex` (0..pages.length) in the pre-move list.
 */
export function reorderSelection(state: AppState, targetIndex: number): boolean {
  if (state.selectedUids.size === 0) return false;
  const clampedTarget = Math.max(0, Math.min(state.pages.length, targetIndex));

  let selectedBefore = 0;
  for (let i = 0; i < clampedTarget; i++) {
    if (state.selectedUids.has(state.pages[i].uid)) {
      selectedBefore += 1;
    }
  }

  const remaining: PageItem[] = [];
  const moving: PageItem[] = [];
  for (const page of state.pages) {
    if (state.selectedUids.has(page.uid)) {
      moving.push(page);
    } else {
      remaining.push(page);
    }
  }

  const insertAt = Math.max(0, Math.min(remaining.length, clampedTarget - selectedBefore));
  const nextPages = [
    ...remaining.slice(0, insertAt),
    ...moving,
    ...remaining.slice(insertAt),
  ];

  const changed = nextPages.some((p, idx) => p.uid !== state.pages[idx].uid);
  if (!changed) return false;

  pushHistory(state);
  state.pages = nextPages;
  return true;
}

/**
 * Move selected pages 1 slot left (-1) or right (+1) in the grid.
 */
export function moveSelectionBy(state: AppState, direction: -1 | 1): boolean {
  if (state.selectedUids.size === 0 || state.pages.length < 2) return false;

  const nextPages = [...state.pages];
  let changed = false;

  if (direction === -1) {
    for (let i = 1; i < nextPages.length; i++) {
      if (state.selectedUids.has(nextPages[i].uid) && !state.selectedUids.has(nextPages[i - 1].uid)) {
        const tmp = nextPages[i - 1];
        nextPages[i - 1] = nextPages[i];
        nextPages[i] = tmp;
        changed = true;
      }
    }
  } else {
    for (let i = nextPages.length - 2; i >= 0; i--) {
      if (state.selectedUids.has(nextPages[i].uid) && !state.selectedUids.has(nextPages[i + 1].uid)) {
        const tmp = nextPages[i + 1];
        nextPages[i + 1] = nextPages[i];
        nextPages[i] = tmp;
        changed = true;
      }
    }
  }

  if (!changed) return false;
  pushHistory(state);
  state.pages = nextPages;
  return true;
}

export function canUndo(state: AppState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: AppState): boolean {
  return state.future.length > 0;
}

export function undo(state: AppState): boolean {
  const prev = state.past.pop();
  if (!prev) return false;

  state.future.push(cloneSnapshot(state));
  state.sources = prev.sources.map((s) => ({ ...s }));
  state.pages = prev.pages.map(clonePage);
  pruneSelection(state);
  return true;
}

export function redo(state: AppState): boolean {
  const next = state.future.pop();
  if (!next) return false;

  state.past.push(cloneSnapshot(state));
  state.sources = next.sources.map((s) => ({ ...s }));
  state.pages = next.pages.map(clonePage);
  pruneSelection(state);
  return true;
}

export function addAnnotation(state: AppState, uid: string, annotation: Annotation): boolean {
  const page = state.pages.find((p) => p.uid === uid);
  if (!page) return false;
  pushHistory(state);
  if (!page.annotations) {
    page.annotations = [];
  }
  page.annotations.push({ ...annotation });
  return true;
}

function shallowEqualAnnotation(a: Annotation, b: Annotation): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a) as Array<keyof Annotation>;
  const keysB = Object.keys(b) as Array<keyof Annotation>;
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

export function updateAnnotation(
  state: AppState,
  uid: string,
  annotationId: string,
  updater: (ann: Annotation) => Annotation
): boolean {
  const page = state.pages.find((p) => p.uid === uid);
  if (!page || !page.annotations) return false;
  const idx = page.annotations.findIndex((a) => a.id === annotationId);
  if (idx === -1) return false;
  const current = page.annotations[idx];
  const updated = updater({ ...current });
  if (shallowEqualAnnotation(current, updated)) return false;
  pushHistory(state);
  page.annotations[idx] = updated;
  return true;
}

export function deleteAnnotation(state: AppState, uid: string, annotationId: string): boolean {
  const page = state.pages.find((p) => p.uid === uid);
  if (!page || !page.annotations) return false;
  const exists = page.annotations.some((a) => a.id === annotationId);
  if (!exists) return false;
  pushHistory(state);
  page.annotations = page.annotations.filter((a) => a.id !== annotationId);
  if (page.annotations.length === 0) {
    delete page.annotations;
  }
  return true;
}

export function getReferencedSourceIds(state: AppState): Set<string> {
  const ids = new Set<string>();
  for (const s of state.sources) ids.add(s.id);
  for (const snap of state.past) {
    for (const s of snap.sources) ids.add(s.id);
  }
  for (const snap of state.future) {
    for (const s of snap.sources) ids.add(s.id);
  }
  return ids;
}
