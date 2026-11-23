# Changelog

All notable changes to Pagefold will be documented in this file.

## [0.3.0] - 2026-11-23

### Added
- **More paper sizes** in the status-bar **Page size** selector: `A3`, `A5`, `B4 (JIS)`, `B5 (JIS)`, and `Legal`, alongside `Match first PDF page`, `A4`, `Letter`, and `Original size`, with per-page orientation matching and generalized `isFixedPaper` handling.
- **Image compression on export** via the new **Compress** / **圧縮** status-bar selector (`Off`, `Light`, `Standard`, `Strong`), persisted in `localStorage` and translated EN/JA. Re-encodes embedded `DCTDecode` JPEG streams ≥100 KB (preserving `/SMask` and vector text while skipping CMYK, `/Decode`, `/ImageMask`, and non-JPEG/small streams).
- **Export size summary toast** showing original source size sum vs. output PDF size and percentage delta (e.g. `Saved 12 pages · 14.2 MB → 3.1 MB (−78%)`).

## [0.2.0] - 2026-11-23

### Added
- **Page size normalization** selector in the status bar (`Match first PDF page`, `A4`, `Letter`, `Original size`), persisted in `localStorage` and translated EN/JA. `A4` / `Letter` modes uniformly scale and center all PDF and image pages via `embedPages` while preserving vector content and page rotation.
- **Annotations** (Text, Rectangle, Highlight) inside the quick-look preview modal with tool palette (`V` / `T` / `B` / `H`), color swatches, text size (`10`–`32 pt`), move/resize handles, `Delete`, and main toolbar Edit button (`E`).
- Undoable annotation state operations (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`) and rotation-aware normalized coordinate mapping (`toPageCoords` / `toViewCoords`).
- Lightweight thumbnail annotation overlays and pencil badge on annotated page cards.
- Export support for rectangles, 35%-opacity highlights, and **real, selectable text annotations** (including Japanese) using an OS-installed system font (Yu Gothic / Hiragino / Noto CJK) with glyph subsetting (`@pdf-lib/fontkit`) and automatic high-DPI PNG fallback when no suitable font or glyph is available.

### Fixed
- Annotation editor and thumbnail overlays: preserved double-click-to-edit on text annotations, rotated text overlays to match exported PDF rotation, guarded IME composition in text/global key handlers, clamped moved rect/highlight origins to prevent edge shrinking, kept thumbnail annotation overlays synced via `ResizeObserver`, invalidated in-flight preview renders on modal close, and skipped no-op annotation undo history entries.

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
