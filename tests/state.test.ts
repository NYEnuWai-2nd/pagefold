import { describe, expect, it } from 'vitest';
import {
  addSource,
  canRedo,
  canUndo,
  clearSelection,
  createInitialState,
  deleteSelected,
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
} from '../src/state.ts';

describe('state management', () => {
  it('adds sources and tracks selection modes', () => {
    const state = createInitialState();
    addSource(state, { id: 's1', name: 'a.pdf', kind: 'pdf', pageCount: 4 });
    expect(state.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2, 3]);

    selectOne(state, state.pages[1].uid);
    expect([...state.selectedUids]).toEqual([state.pages[1].uid]);

    selectRange(state, state.pages[3].uid);
    expect([...state.selectedUids]).toEqual([
      state.pages[1].uid,
      state.pages[2].uid,
      state.pages[3].uid,
    ]);

    toggleSelect(state, state.pages[2].uid);
    expect(state.selectedUids.has(state.pages[2].uid)).toBe(false);

    selectAll(state);
    expect(state.selectedUids.size).toBe(4);

    clearSelection(state);
    expect(state.selectedUids.size).toBe(0);
  });

  it('reorders multi-selection preserving relative order', () => {
    const state = createInitialState();
    addSource(state, { id: 's1', name: 'a.pdf', kind: 'pdf', pageCount: 5 });
    const uids = state.pages.map((p) => p.uid);

    // Select pages 1 and 3 (0-based)
    selectOne(state, uids[1]);
    toggleSelect(state, uids[3]);

    // Move to the end (index 5)
    expect(reorderSelection(state, 5)).toBe(true);
    expect(state.pages.map((p) => p.pageIndex)).toEqual([0, 2, 4, 1, 3]);

    // Move to the beginning (index 0)
    expect(reorderSelection(state, 0)).toBe(true);
    expect(state.pages.map((p) => p.pageIndex)).toEqual([1, 3, 0, 2, 4]);
  });

  it('moves selection with Alt+ArrowLeft / ArrowRight', () => {
    const state = createInitialState();
    addSource(state, { id: 's1', name: 'a.pdf', kind: 'pdf', pageCount: 4 });

    selectOne(state, state.pages[1].uid);
    toggleSelect(state, state.pages[2].uid);

    expect(moveSelectionBy(state, -1)).toBe(true);
    expect(state.pages.map((p) => p.pageIndex)).toEqual([1, 2, 0, 3]);
    expect(moveSelectionBy(state, -1)).toBe(false);

    expect(moveSelectionBy(state, 1)).toBe(true);
    expect(state.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2, 3]);
  });

  it('rotates, deletes, and supports undo/redo', () => {
    const state = createInitialState();
    addSource(state, { id: 's1', name: 'a.pdf', kind: 'pdf', pageCount: 3 });

    selectOne(state, state.pages[0].uid);
    rotateSelected(state, 90);
    expect(state.pages[0].rotation).toBe(90);

    rotateSelected(state, -90);
    expect(state.pages[0].rotation).toBe(0);

    rotateSelected(state, -90);
    expect(state.pages[0].rotation).toBe(270);

    selectOne(state, state.pages[1].uid);
    deleteSelected(state);
    expect(state.pages.map((p) => p.pageIndex)).toEqual([0, 2]);
    expect(canUndo(state)).toBe(true);

    expect(undo(state)).toBe(true);
    expect(state.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(canRedo(state)).toBe(true);

    expect(redo(state)).toBe(true);
    expect(state.pages.map((p) => p.pageIndex)).toEqual([0, 2]);
  });

  it('removes source and restores on undo', () => {
    const state = createInitialState();
    addSource(state, { id: 's1', name: 'a.pdf', kind: 'pdf', pageCount: 2 });
    addSource(state, { id: 's2', name: 'b.pdf', kind: 'pdf', pageCount: 2 });

    expect(removeSource(state, 's1')).toBe(true);
    expect(state.sources.map((s) => s.id)).toEqual(['s2']);
    expect(state.pages.map((p) => p.sourceId)).toEqual(['s2', 's2']);

    expect(undo(state)).toBe(true);
    expect(state.sources.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(state.pages.length).toBe(4);
  });
});
