import { formatBytes } from './compress.ts';

export type Locale = 'en' | 'ja';

export interface Translations {
  appName: string;
  tagline: string;
  addFiles: string;
  addFilesTooltip: string;
  rotateLeft: string;
  rotateRight: string;
  deleteSelected: string;
  undo: string;
  redo: string;
  selectAll: string;
  clearSelection: string;
  exportPdf: string;
  extractSelected: string;
  splitPdf: string;
  stripMetadata: string;
  stripMetadataTooltip: string;
  pageSizeLabel: string;
  pageSizeTooltip: string;
  pageSizeAuto: string;
  pageSizeA3: string;
  pageSizeA4: string;
  pageSizeA5: string;
  pageSizeB4: string;
  pageSizeB5: string;
  pageSizeLetter: string;
  pageSizeLegal: string;
  pageSizeOriginal: string;
  compressLabel: string;
  compressTooltip: string;
  compressOff: string;
  compressLight: string;
  compressStandard: string;
  compressStrong: string;
  privacyFooter: string;
  sourcesHeading: string;
  noSources: string;
  pageCount: (n: number) => string;
  selectedCount: (n: number) => string;
  totalPages: (n: number) => string;
  removeSourceTooltip: string;
  emptyTitle: string;
  emptySubtitle: string;
  emptyAction: string;
  emptyFormats: string;
  dropOverlayTitle: string;
  dropOverlaySubtitle: string;
  shortcutsTitle: string;
  shortcutsButtonTooltip: string;
  langToggleLabel: string;
  close: string;
  cancel: string;
  confirm: string;
  splitDialogTitle: string;
  splitModeEveryN: string;
  splitModeRanges: string;
  splitEveryNLabel: string;
  splitRangesLabel: string;
  splitRangesPlaceholder: string;
  splitRangesHint: (total: number) => string;
  splitConfirm: string;
  splitPreviewParts: (n: number) => string;
  toastSaved: (count: number, path: string) => string;
  toastSavedWithSize: (count: number, before: number, after: number) => string;
  toastSplitSaved: (parts: number, dir: string) => string;
  toastEncryptedPdf: (name: string) => string;
  toastLoadError: (name: string, msg: string) => string;
  toastExportError: (msg: string) => string;
  toastAddedFiles: (files: number, pages: number) => string;
  errorInvalidEveryN: string;
  errorEmptyRanges: string;
  errorInvalidToken: (token: string) => string;
  errorOutOfRange: (token: string, total: number) => string;
  shortcutSelect: string;
  shortcutMultiSelect: string;
  shortcutRangeSelect: string;
  shortcutSelectAll: string;
  shortcutClearSelection: string;
  shortcutReorder: string;
  shortcutRotate: string;
  shortcutDelete: string;
  shortcutUndoRedo: string;
  shortcutPreview: string;
  shortcutAnnotate: string;
  shortcutAnnTools: string;
  shortcutZoom: string;
  shortcutHelp: string;
  annotateTooltip: string;
  toolSelect: string;
  toolText: string;
  toolRect: string;
  toolHighlight: string;
  deleteAnnotationTooltip: string;
  textSizeLabel: string;
  thumbSizeLabel: string;
  previewOf: (current: number, total: number) => string;
  pageLabel: (n: number) => string;
}

const en: Translations = {
  appName: 'Pagefold',
  tagline: 'Offline PDF Workbench',
  addFiles: 'Add PDFs / Images',
  addFilesTooltip: 'Add PDF, PNG, or JPEG files',
  rotateLeft: 'Rotate Left',
  rotateRight: 'Rotate Right',
  deleteSelected: 'Delete',
  undo: 'Undo',
  redo: 'Redo',
  selectAll: 'Select All',
  clearSelection: 'Deselect',
  exportPdf: 'Export PDF…',
  extractSelected: 'Extract Selected…',
  splitPdf: 'Split…',
  stripMetadata: 'Remove metadata',
  stripMetadataTooltip: 'Strip title, author, producer, and XMP metadata on export',
  pageSizeLabel: 'Page size',
  pageSizeTooltip: 'Target page size when exporting',
  pageSizeAuto: 'Match first PDF page',
  pageSizeA3: 'A3',
  pageSizeA4: 'A4',
  pageSizeA5: 'A5',
  pageSizeB4: 'B4 (JIS)',
  pageSizeB5: 'B5 (JIS)',
  pageSizeLetter: 'Letter',
  pageSizeLegal: 'Legal',
  pageSizeOriginal: 'Original size',
  compressLabel: 'Compress',
  compressTooltip: 'Compress embedded JPEG images on export (keeps vector text)',
  compressOff: 'Off',
  compressLight: 'Light',
  compressStandard: 'Standard',
  compressStrong: 'Strong',
  privacyFooter: 'Offline. Your files never leave this computer.',
  sourcesHeading: 'Source Files',
  noSources: 'No files loaded yet.',
  pageCount: (n) => (n === 1 ? '1 page' : `${n} pages`),
  selectedCount: (n) => `${n} selected`,
  totalPages: (n) => (n === 1 ? '1 page total' : `${n} pages total`),
  removeSourceTooltip: 'Remove file and its pages',
  emptyTitle: 'Drop PDFs or images onto the desk',
  emptySubtitle: 'Merge, reorder, rotate, delete, extract, and split pages — 100% locally.',
  emptyAction: 'Choose PDFs or Images…',
  emptyFormats: 'Supports PDF, PNG, JPEG',
  dropOverlayTitle: 'Drop files to add pages',
  dropOverlaySubtitle: 'PDF, PNG, and JPEG files are supported',
  shortcutsTitle: 'Keyboard Shortcuts',
  shortcutsButtonTooltip: 'Keyboard shortcuts (?)',
  langToggleLabel: '日本語',
  close: 'Close',
  cancel: 'Cancel',
  confirm: 'Confirm',
  splitDialogTitle: 'Split PDF',
  splitModeEveryN: 'Every N pages',
  splitModeRanges: 'Custom page ranges',
  splitEveryNLabel: 'Pages per file',
  splitRangesLabel: 'Page ranges (comma-separated)',
  splitRangesPlaceholder: 'e.g. 1-3, 5, 8-10',
  splitRangesHint: (total) => `Total pages: ${total}. Example: 1-3, 4-${Math.max(4, total)}`,
  splitConfirm: 'Choose Folder & Split…',
  splitPreviewParts: (n) => (n === 1 ? 'Will create 1 file' : `Will create ${n} files`),
  toastSaved: (count, path) => `Saved ${count} ${count === 1 ? 'page' : 'pages'} to ${path}`,
  toastSavedWithSize: (count, before, after) => {
    const pct = before > 0 ? Math.round(((after - before) / before) * 100) : 0;
    const delta = pct < 0 ? `\u2212${Math.abs(pct)}%` : pct > 0 ? `+${pct}%` : '0%';
    return `Saved ${count} ${count === 1 ? 'page' : 'pages'} · ${formatBytes(before)} → ${formatBytes(after)} (${delta})`;
  },
  toastSplitSaved: (parts, dir) => `Saved ${parts} split PDFs to ${dir}`,
  toastEncryptedPdf: (name) => `${name}: Password-protected PDFs aren't supported yet`,
  toastLoadError: (name, msg) => `Could not load ${name}: ${msg}`,
  toastExportError: (msg) => `Export failed: ${msg}`,
  toastAddedFiles: (files, pages) =>
    `Added ${pages} ${pages === 1 ? 'page' : 'pages'} from ${files} ${files === 1 ? 'file' : 'files'}`,
  errorInvalidEveryN: 'Enter a whole number of 1 or greater.',
  errorEmptyRanges: 'Enter at least one page or range.',
  errorInvalidToken: (token) => `Invalid page range: "${token}"`,
  errorOutOfRange: (token, total) => `"${token}" is outside 1–${total}.`,
  shortcutSelect: 'Select page',
  shortcutMultiSelect: 'Toggle page in selection',
  shortcutRangeSelect: 'Select range',
  shortcutSelectAll: 'Select all pages',
  shortcutClearSelection: 'Clear selection / close dialog',
  shortcutReorder: 'Move selected pages left / right',
  shortcutRotate: 'Rotate selected ±90°',
  shortcutDelete: 'Delete selected pages',
  shortcutUndoRedo: 'Undo / Redo',
  shortcutPreview: 'Quick-look preview',
  shortcutAnnotate: 'Annotate selected page',
  shortcutAnnTools: 'Select / Text / Rectangle / Highlight',
  shortcutZoom: 'Resize thumbnails',
  shortcutHelp: 'Toggle this shortcuts guide',
  annotateTooltip: 'Annotate (E)',
  toolSelect: 'Select (V)',
  toolText: 'Text (T)',
  toolRect: 'Rectangle (B)',
  toolHighlight: 'Highlight (H)',
  deleteAnnotationTooltip: 'Delete annotation (Del)',
  textSizeLabel: 'Text size',
  thumbSizeLabel: 'Thumbnail size (Ctrl+Wheel)',
  previewOf: (current, total) => `Page ${current} of ${total}`,
  pageLabel: (n) => `p.${n}`,
};

const ja: Translations = {
  appName: 'Pagefold',
  tagline: 'オフライン PDF 整理ツール',
  addFiles: 'PDF / 画像を追加',
  addFilesTooltip: 'PDF、PNG、JPEG ファイルを追加',
  rotateLeft: '左に回転',
  rotateRight: '右に回転',
  deleteSelected: '削除',
  undo: '元に戻す',
  redo: 'やり直す',
  selectAll: 'すべて選択',
  clearSelection: '選択解除',
  exportPdf: 'PDF を書き出し…',
  extractSelected: '選択ページを抽出…',
  splitPdf: '分割…',
  stripMetadata: 'メタデータを削除',
  stripMetadataTooltip: '書き出し時に作成者・タイトル・XMP メタデータを削除します',
  pageSizeLabel: 'ページサイズ',
  pageSizeTooltip: '書き出し時のページサイズ',
  pageSizeAuto: '最初のPDFに合わせる',
  pageSizeA3: 'A3',
  pageSizeA4: 'A4',
  pageSizeA5: 'A5',
  pageSizeB4: 'B4 (JIS)',
  pageSizeB5: 'B5 (JIS)',
  pageSizeLetter: 'Letter',
  pageSizeLegal: 'Legal',
  pageSizeOriginal: '元のサイズ',
  compressLabel: '圧縮',
  compressTooltip: '書き出し時に埋め込み JPEG 画像を圧縮（文字はベクターのまま維持）',
  compressOff: 'オフ',
  compressLight: '弱',
  compressStandard: '標準',
  compressStrong: '強',
  privacyFooter: '完全オフライン。ファイルがこのPCの外に出ることはありません。',
  sourcesHeading: '読み込み済みファイル',
  noSources: 'ファイルがまだありません。',
  pageCount: (n) => `${n} ページ`,
  selectedCount: (n) => `${n} 件選択中`,
  totalPages: (n) => `合計 ${n} ページ`,
  removeSourceTooltip: 'このファイルとページを取り除く',
  emptyTitle: 'PDF や画像をここにドロップ',
  emptySubtitle: '結合・並べ替え・回転・削除・抽出・分割をすべてローカルで完結。',
  emptyAction: 'PDF / 画像を選択…',
  emptyFormats: '対応形式: PDF, PNG, JPEG',
  dropOverlayTitle: 'ドロップしてページを追加',
  dropOverlaySubtitle: 'PDF・PNG・JPEG ファイルに対応しています',
  shortcutsTitle: 'キーボードショートカット',
  shortcutsButtonTooltip: 'ショートカット一覧 (?)',
  langToggleLabel: 'English',
  close: '閉じる',
  cancel: 'キャンセル',
  confirm: '確定',
  splitDialogTitle: 'PDF を分割',
  splitModeEveryN: 'N ページごとに分割',
  splitModeRanges: 'ページ範囲を指定',
  splitEveryNLabel: '1ファイルあたりのページ数',
  splitRangesLabel: 'ページ範囲（カンマ区切り）',
  splitRangesPlaceholder: '例: 1-3, 5, 8-10',
  splitRangesHint: (total) => `全 ${total} ページ。例: 1-3, 4-${Math.max(4, total)}`,
  splitConfirm: 'フォルダを選んで分割…',
  splitPreviewParts: (n) => `${n} 個のファイルを作成します`,
  toastSaved: (count, path) => `${count} ページを ${path} に保存しました`,
  toastSavedWithSize: (count, before, after) => {
    const pct = before > 0 ? Math.round(((after - before) / before) * 100) : 0;
    const delta = pct < 0 ? `\u2212${Math.abs(pct)}%` : pct > 0 ? `+${pct}%` : '0%';
    return `${count}ページを保存 · ${formatBytes(before)} → ${formatBytes(after)}（${delta}）`;
  },
  toastSplitSaved: (parts, dir) => `${parts} 個の分割 PDF を ${dir} に保存しました`,
  toastEncryptedPdf: (name) => `${name}: パスワード保護された PDF にはまだ対応していません`,
  toastLoadError: (name, msg) => `${name} を読み込めませんでした: ${msg}`,
  toastExportError: (msg) => `書き出しに失敗しました: ${msg}`,
  toastAddedFiles: (files, pages) => `${files} ファイルから ${pages} ページを追加しました`,
  errorInvalidEveryN: '1 以上の整数を入力してください。',
  errorEmptyRanges: 'ページ番号または範囲を1つ以上入力してください。',
  errorInvalidToken: (token) => `無効な範囲指定です: "${token}"`,
  errorOutOfRange: (token, total) => `"${token}" は 1〜${total} の範囲外です。`,
  shortcutSelect: 'ページを選択',
  shortcutMultiSelect: '選択を追加 / 解除',
  shortcutRangeSelect: '範囲選択',
  shortcutSelectAll: 'すべて選択',
  shortcutClearSelection: '選択解除 / ダイアログを閉じる',
  shortcutReorder: '選択ページを左右に移動',
  shortcutRotate: '選択ページを ±90° 回転',
  shortcutDelete: '選択ページを削除',
  shortcutUndoRedo: '元に戻す / やり直す',
  shortcutPreview: 'クイックプレビュー',
  shortcutAnnotate: '選択ページに注釈を追加',
  shortcutAnnTools: '選択 / テキスト / 四角形 / ハイライト',
  shortcutZoom: 'サムネイルサイズ変更',
  shortcutHelp: 'このショートカット一覧を表示',
  annotateTooltip: '注釈を編集 (E)',
  toolSelect: '選択 (V)',
  toolText: 'テキスト (T)',
  toolRect: '四角形 (B)',
  toolHighlight: 'ハイライト (H)',
  deleteAnnotationTooltip: '注釈を削除 (Del)',
  textSizeLabel: '文字サイズ',
  thumbSizeLabel: 'サムネイルサイズ (Ctrl+ホイール)',
  previewOf: (current, total) => `${current} / ${total} ページ`,
  pageLabel: (n) => `${n}`,
};

export const dictionaries: Record<Locale, Translations> = { en, ja };

export function detectLocale(lang?: string): Locale {
  const value = (lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase();
  return value.startsWith('ja') ? 'ja' : 'en';
}
