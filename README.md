# Pagefold

**A tiny, offline desktop app to merge, reorder, rotate, delete, extract, and split PDF pages visually** — the iLovePDF workflow without uploading your tax returns, leases, or ID scans anywhere.

> [!NOTE]
> **100% Offline & Private.** Pagefold never connects to the internet, has no account system, and includes zero telemetry. Your documents never leave your computer.

![Pagefold screenshot](docs/screenshot.png)

## Why Pagefold?

People routinely upload sensitive documents—tax returns, employment contracts, medical forms, passport scans—to random web PDF tools just to merge two files or rotate a sideways page. Existing open-source desktop options are often form-based (PDFsam), GTK-styled on Windows/macOS (PDF Arranger), or require a local web server/Docker (Stirling-PDF).

Pagefold is a ~10 MB double-click desktop app built with **Tauri v2**, **pdf-lib**, and **pdf.js** (with its worker bundled locally).

## Features (v0.1)

- **Add PDFs & Images**: Drag and drop PDF, PNG, or JPEG files onto the desk (inserts at the drop position) or use the file picker. Images are automatically placed onto A4 portrait or landscape pages based on their aspect ratio.
- **Visual Page Grid**: Crisp paper-sheet thumbnails rendered lazily with `IntersectionObserver` so even 300-page documents stay responsive. Resize thumbnails with the status-bar slider or `Ctrl+Wheel`. Source files are color-tagged in the sidebar (click a source to select all its pages).
- **Quick-Look Preview**: Double-click any page or press `Space` to inspect it at full size, step with `←` / `→`, and rotate with `R` / `Shift+R`.
- **Multi-Select & Reorder**: Click, `Ctrl/Cmd+Click`, `Shift+Click`, or `Ctrl/Cmd+A` to select pages, then drag-and-drop with pointer events (or `Alt+←` / `Alt+→`) to reorder.
- **Rotate & Delete with Undo/Redo**: Rotate selected pages ±90° (`R` / `Shift+R`), delete (`Delete` / `Backspace`), and undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`).
- **Export, Extract & Split**:
  - **Export PDF…** — save all pages in their current order.
  - **Extract Selected…** — save only the selected pages.
  - **Split…** — split every *N* pages or by custom ranges (e.g., `1-3, 5, 8-10`) into a chosen folder.
- **Privacy by Default**: **Remove metadata** is enabled by default on export, stripping producer, creator, title, author, and XMP metadata.
- **Bilingual UI**: Automatic English / Japanese (`EN` / `日本語`) detection with a one-click header toggle, plus automatic light/dark mode ("calm paper workbench" / "night desk").

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Click` | Select page |
| `Ctrl` / `Cmd` + `Click` | Toggle page in selection |
| `Shift` + `Click` | Select range |
| `Ctrl` / `Cmd` + `A` | Select all pages |
| `Esc` | Clear selection / close dialog |
| `Alt` + `←` / `→` | Move selected pages left / right |
| `R` / `Shift` + `R` | Rotate selected ±90° |
| `Delete` / `Backspace` | Delete selected pages |
| `Ctrl` + `Z` / `Ctrl` + `Shift` + `Z` | Undo / Redo |
| `Space` / `Double-click` | Quick-look preview |
| `Ctrl` + `Wheel` | Resize thumbnails |
| `?` | Toggle keyboard shortcuts overlay |

## Privacy Statement

- All PDF parsing, thumbnail rendering, and PDF assembly run locally inside the app.
- No network requests are made at runtime; the `pdf.js` worker is bundled directly into the application.
- **Remove metadata** is checked by default so exported PDFs do not leak source document metadata.

## Build from Source

### Prerequisites

- Node.js 20+ (tested with Node 24)
- Rust toolchain (`rustup` / `cargo`)
- Tauri v2 OS prerequisites (WebView2 on Windows, Xcode Command Line Tools on macOS, `webkit2gtk` on Linux)

### Commands

```bash
npm install
npm test
npm run build
npm run tauri build
```

For a standalone binary without installers:

```bash
npm run tauri build -- --no-bundle
```

## Roadmap

- Password-protected PDF unlock / encryption
- True redaction (flatten)
- Insert blank page
- Export pages as PNG
- Compress / optimize PDF size
- Local OCR
- macOS and Linux release builds via GitHub Actions CI

## License

MIT © [Pagefold contributors](LICENSE)
