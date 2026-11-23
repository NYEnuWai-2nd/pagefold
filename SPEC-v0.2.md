# Pagefold v0.2 spec — page size normalization + annotations

Do Part A fully (with tests, commit), then Part B. Keep everything offline; no new runtime deps unless stated.

## Part A — Page size when combining (≈15 min)

Problem: when images (or PDFs of different sizes) are combined with an A4 PDF, users want every page to come out the same size.

Add an export option in the status bar next to "Remove metadata": **Page size** `<select>`:
- `auto` (default, label "Match first PDF page" / "最初のPDFに合わせる"): image pages use the size of the first PDF page in the current order (orientation flipped to match the image's aspect: landscape image → landscape page). If there is no PDF page, fall back to A4. PDF pages are copied unchanged (current behavior).
- `a4` / `letter` ("A4" / "Letter"): **every** page (PDF and image) is output at that size, orientation chosen per page from its effective aspect (after its existing /Rotate). PDF pages are placed with `outDoc.embedPages()` (embed per source in one call where possible) and `page.drawPage(embedded, {x,y,width,height})`, scaled uniformly to fit and centered (vector content preserved). Rotation of the original page must be honored: draw with the correct transform, or simpler — compute the effective size, create the target page, and apply the user rotation via `setRotation` on the new page as today.
- `original` ("Original size" / "元のサイズ"): image page = image pixel size at 96 dpi (px × 0.75 pt); PDF pages unchanged.
Also an **Image margin** option is NOT needed; images fit inside the page with a 0 margin, centered, aspect preserved (current behavior).
Persist the choice in localStorage (try/catch). i18n EN/JA. Pure helper `resolvePageSize(mode, firstPdfSize, itemSize) → [w,h]` in a testable module with unit tests (A4 portrait PDF + landscape image → A4 landscape; letter mode; original mode; no-PDF fallback). Extend export test: A4 PDF + a 1000×500 PNG with `auto` → both pages A4 (second landscape).

## Part B — Annotations: text, rectangle, highlight (≈40 min)

### Model (state.ts, undoable)
`PageItem.annotations?: Annotation[]` where
```ts
type Annotation =
  | { id: string; kind: 'text'; x: number; y: number; text: string; size: number; color: string } // size in pt
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number; color: string; stroke: number }
  | { id: string; kind: 'highlight'; x: number; y: number; w: number; h: number; color: string }; // drawn at 35% opacity
```
Coordinates are **normalized 0..1 in the page's unrotated (original) coordinate space, origin top-left**. Every add/move/resize/edit/delete goes through state functions that push history, so Ctrl+Z works. Pure helpers to map between view coords and unrotated normalized coords for rotation 0/90/180/270 (`toPageCoords`, `toViewCoords`) with unit tests (round-trip for all 4 rotations).

### Editing UI (inside the existing quick-look preview modal)
- Add a small tool palette at the top of the preview: **Select** (V), **Text** (T), **Rectangle** (B), **Highlight** (H), color swatches (black, red, blue, yellow-for-highlight default, green), text size (10/14/18/24/32), and Delete (Del) for the selected annotation. Add an "Edit" button (pencil icon, tooltip "Annotate (E)") to the main toolbar and keyboard `E` that opens the preview for the first selected page in edit mode.
- Overlay: an absolutely positioned layer exactly covering the rendered page image (it must respect the page's current rotation; render annotations in view coords computed from normalized coords).
- Text tool: click → creates a contenteditable/textarea at that point; Enter commits (Shift+Enter = newline), Esc cancels, blur commits; empty text = discard. Double-click an existing text in Select mode to edit it.
- Rectangle / Highlight: drag to create (min 4px). Select mode: click selects (show handles), drag moves, drag the bottom-right handle resizes; Delete removes.
- While typing in a text box, global shortcuts (R, Delete, Space, arrows, V/T/B/H/E) must NOT fire.
- Thumbnails show a lightweight overlay of the annotations (absolute-positioned divs over the thumbnail, same mapping) so users see which pages are marked up; a small pencil badge on cards with annotations.

### Export (pdf.ts)
- Draw annotations onto the output page in **unrotated page space** (PDF user space, origin bottom-left: `pdfY = pageHeight - y*pageHeight - height`). Because they are in unrotated space, `setRotation` keeps them aligned with the content automatically. When Part A's a4/letter mode scales a page into a new page, apply the same scale/offset transform to annotation coordinates.
- rect: `drawRectangle({ borderColor, borderWidth: stroke, color: undefined })`. highlight: `drawRectangle({ color, opacity: 0.35 })`.
- text: Japanese must work, so **render text to a PNG with an offscreen canvas** using the UI font stack (`"Segoe UI","Hiragino Sans","Yu Gothic UI","Noto Sans JP",sans-serif`) at 4× scale (multi-line supported, transparent background), embed with `embedPng`, and draw at the computed position/size (`size` pt line height ≈ 1.25). Note in README that text annotations are flattened as images (not selectable) in v0.2.
- Annotations must survive reorder/rotate/extract/split since they live on the PageItem.

### Tests & docs
- Unit tests for coordinate mapping, state add/update/delete + undo, resolvePageSize, and an export test that a page with a rect+highlight annotation exports with the expected page count and does not throw (text rendering needs canvas — skip text in node tests or guard it).
- Update README/README.ja (features, shortcuts V/T/B/H/E, Page size option, limitation: text flattened), CHANGELOG 0.2.0, bump version to 0.2.0 in package.json, Cargo.toml, tauri.conf.json.
