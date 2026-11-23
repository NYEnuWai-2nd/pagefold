# Changelog

All notable changes to Pagefold will be documented in this file.

## [0.1.0] - 2026-11-23

### Added
- Visual PDF & image (PNG/JPEG) page workbench built with Tauri v2, `pdf-lib`, and `pdf.js` (locally bundled worker).
- Drag-and-drop file loading (`onDragDropEvent`) with drop-position insertion and multi-file open dialog.
- Lazy thumbnail grid using `IntersectionObserver` (JPEG blob cache), resizable via status-bar slider or `Ctrl+Wheel`, with source file sidebar (click row to select all its pages) and color tags.
- Quick-look page preview modal (`Space` or double-click) with `←`/`→` stepping and `R`/`Shift+R` rotation.
- Single, toggle (`Ctrl/Cmd+Click`), range (`Shift+Click`), and select-all (`Ctrl/Cmd+A`) selection.
- Pointer-event drag-and-drop reordering (including multi-selection and edge auto-scroll) and keyboard reordering (`Alt+←/→`).
- Page rotation (±90°, `R` / `Shift+R`), deletion (`Delete` / `Backspace`), and Undo/Redo (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`).
- Export PDF, Extract Selected, and Split (every N pages or custom ranges) with batched `copyPages` per source and **Remove metadata** enabled by default.
- Bilingual English / Japanese UI with automatic detection and header toggle, plus light/dark mode.
- Keyboard shortcuts overlay (`?`) and toast notifications.
