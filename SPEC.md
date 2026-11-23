# Pagefold — build spec (v0.1)

**One line:** A tiny, offline desktop app to merge, reorder, rotate, delete, extract and split PDF pages visually — the iLovePDF workflow without uploading your tax returns, leases or ID scans anywhere.

Why (for README): people routinely upload private documents to web PDF tools just to merge or reorder pages. Existing OSS desktop options are either form-based (PDFsam), GTK-looking on Windows/macOS (PDF Arranger), or a local web server/Docker (Stirling-PDF). Pagefold is a ~10 MB double-click app (Tauri v2), 100% offline, no account, no telemetry.

## Stack (already scaffolded in this folder)
- Tauri v2 + Vite + vanilla TypeScript (`npm create tauri-app` vanilla-ts template is in place; `npm install` and a first `cargo build` were already run).
- npm deps allowed: `pdf-lib` (page ops, metadata), `pdfjs-dist` (thumbnails; bundle the worker locally via Vite `?url` import — NO CDN, must work offline), `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`. Add the matching Rust crates `tauri-plugin-dialog`, `tauri-plugin-fs` and capabilities in `src-tauri/capabilities/default.json` (dialog open/save, fs read/write for user-chosen paths).
- Keep all PDF work in the frontend (pdf-lib). Rust side = plugins only.
- productName `Pagefold`, identifier `io.github.pagefold.app`, window title `Pagefold`, default window 1200×800, min 800×560.

## v0.1 features (all required)
1. **Add files**: "Add PDFs / images" button (dialog, multi-select, filters pdf/png/jpg/jpeg) AND drag-and-drop files onto the window (use Tauri's `onDragDropEvent` from `@tauri-apps/api/webview` which gives paths; read bytes with plugin-fs). Images (PNG/JPEG) become single pages (fit to A4 portrait or landscape by aspect ratio, centered, margin 0).
2. **Page grid**: every page of every loaded file shown as a thumbnail card (rendered with pdf.js at ~180px wide, lazily via IntersectionObserver so 300-page files stay responsive). Card shows page number in the output order and a small color tag/label for its source file. Source files listed in a sidebar with page counts and a remove (×) button.
3. **Select**: click = select one, Ctrl/Cmd+click = toggle, Shift+click = range, Ctrl/Cmd+A = all, Esc = clear.
4. **Reorder**: drag cards to reorder (supports moving a multi-selection). Also keyboard: Alt+←/→ moves selection. Use pointer events, not HTML5 DnD (it conflicts with Tauri file drop). Show an insertion marker.
5. **Rotate** selected ±90° (buttons + R / Shift+R). Thumbnail rotates via CSS transform; export applies `page.setRotation(degrees(existing + delta))`.
6. **Delete** selected (Delete/Backspace) with **Undo/Redo** (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) — keep a simple history stack of the page-list state.
7. **Export**:
   - "Export PDF…" → save dialog → writes all pages in current order.
   - "Extract selected…" → only selected pages.
   - "Split…" → small dialog: "every N pages" or ranges like `1-3, 5, 8-10` → choose a folder (dialog `directory: true`) → writes `<basename>-part1.pdf`, ...
   - Use `PDFDocument.create()` + `copyPages` from cached source `PDFDocument`s (load each source once with `ignoreEncryption: false`; if encrypted, show a clear error toast "Password-protected PDFs aren't supported yet").
8. **Privacy by default**: an export option checkbox "Remove metadata" (default ON): new docs from `PDFDocument.create()` don't carry the source Info dict or XMP; additionally call `setProducer('')`, `setCreator('')` and create with `{ updateMetadata: false }`. When OFF, copy title/author/subject/keywords from the first source PDF. Show a tiny line in the footer: "Offline. Your files never leave this computer."
9. **Status/empty state**: big friendly empty state with drop target illustration (pure CSS/SVG), keyboard shortcut cheatsheet (`?` toggles overlay), toasts for success ("Saved 12 pages to …") and errors.
10. **i18n**: English + Japanese UI strings, auto from `navigator.language`, with a toggle in the header. Keep strings in `src/i18n.ts`.

## Design
Use the art-direction skill at https://github.com/RNA4219/anything-frontend-art-direction — read https://raw.githubusercontent.com/RNA4219/anything-frontend-art-direction/main/SKILL.md and references/visual-direction.md (fetch via web or curl) and follow its process briefly. Direction to start from (refine with the skill): **calm paper workbench** — warm off-white "desk" background, pages as real paper cards with subtle shadow, one confident accent color (e.g. deep vermilion or ink blue) for selection and primary actions, compact toolbar, system UI font stack + good Japanese fallback (`"Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif`), no external font loading. Must support dark mode via `prefers-color-scheme` (dark "night desk"). Accessible: visible focus rings, buttons have labels/tooltips, contrast AA. No UI framework — hand-written CSS with custom properties.

## Code layout
`src/main.ts` (wiring), `src/state.ts` (page list model + undo/redo, pure & testable), `src/pdf.ts` (load/render/export with pdf-lib + pdf.js), `src/grid.ts` (rendering, selection, drag reorder), `src/split.ts` (range parser — pure), `src/i18n.ts`, `src/styles.css`. Delete template leftovers (greet command, Tauri/Vite logos).

## Tests
Add `vitest` as devDependency. Unit tests for `split.ts` range parsing (valid, overlapping, out of range, whitespace, invalid tokens) and `state.ts` (reorder multi-selection, rotate, delete, undo/redo). Also a node script test that builds a 3-page PDF with pdf-lib, applies a state (reorder+rotate+delete) through the export function, and asserts the resulting page count/rotations. `npm test` must pass.

## Done criteria
- `npm test` passes; `npm run build` (vite/tsc) passes; `npm run tauri build -- --no-bundle` (or `cargo build --release` after frontend build) succeeds and produces `src-tauri/target/release/pagefold.exe` (rename crate/binary to `pagefold`).
- README.md (English, star-worthy: pitch, screenshot placeholder `docs/screenshot.png`, features, keyboard shortcuts, privacy statement, build from source, roadmap: password PDFs, true redaction, image export, page insert blank, macOS/Linux release builds via CI), README.ja.md, LICENSE (MIT, "Pagefold contributors"), `.github/workflows/release.yml` using `tauri-apps/tauri-action` for windows/macos/ubuntu on tag push, CHANGELOG.md.
- `git init` and commit in logical steps.

## Roadmap (README only, do not build): password unlock/encrypt, true redaction (flatten), insert blank page, export pages as PNG, compress, OCR.
