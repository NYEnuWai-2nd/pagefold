import { clamp01, toPageCoords, toPageRect, toViewCoords, toViewRect } from './annotations.ts';
import type { Annotation, PageItem, Rotation } from './state.ts';

export type AnnotationTool = 'select' | 'text' | 'rect' | 'highlight';

export interface AnnotationEditorCallbacks {
  onAdd: (uid: string, ann: Annotation) => void;
  onUpdate: (uid: string, annId: string, updater: (ann: Annotation) => Annotation) => void;
  onDelete: (uid: string, annId: string) => void;
  onToolChange?: (tool: AnnotationTool) => void;
  onSelectionChange?: (annId: string | null) => void;
}

const DEFAULT_HIGHLIGHT_COLOR = '#facc15';
const DEFAULT_DRAW_COLOR = '#d93025';
const DEFAULT_TEXT_COLOR = '#1f1e1b';

let annIdCounter = 1;
function nextAnnId(): string {
  return `ann-${Date.now().toString(36)}-${annIdCounter++}`;
}

export class AnnotationEditor {
  private overlay: HTMLElement;
  private callbacks: AnnotationEditorCallbacks;

  private page: PageItem | null = null;
  private viewRotation: Rotation = 0;
  private viewWidthPt = 595.28;

  private tool: AnnotationTool = 'select';
  private color = DEFAULT_TEXT_COLOR;
  private textSize = 14;
  private selectedAnnId: string | null = null;
  private activeTextArea: HTMLTextAreaElement | null = null;

  private dragOp:
    | {
        kind: 'create';
        tool: 'rect' | 'highlight';
        startX: number;
        startY: number;
        curX: number;
        curY: number;
        boxEl: HTMLElement;
      }
    | {
        kind: 'move';
        ann: Annotation;
        startX: number;
        startY: number;
        origViewX: number;
        origViewY: number;
        viewW: number;
        viewH: number;
        dx: number;
        dy: number;
        el: HTMLElement;
      }
    | {
        kind: 'resize';
        ann: Extract<Annotation, { kind: 'rect' | 'highlight' }>;
        startX: number;
        startY: number;
        origViewX: number;
        origViewY: number;
        origViewW: number;
        origViewH: number;
        dx: number;
        dy: number;
        el: HTMLElement;
      }
    | null = null;

  constructor(overlay: HTMLElement, callbacks: AnnotationEditorCallbacks) {
    this.overlay = overlay;
    this.callbacks = callbacks;
    this.setupEvents();
  }

  public getTool(): AnnotationTool {
    return this.tool;
  }

  public getColor(): string {
    return this.color;
  }

  public getTextSize(): number {
    return this.textSize;
  }

  public getSelectedId(): string | null {
    return this.selectedAnnId;
  }

  public isEditingText(): boolean {
    return this.activeTextArea !== null;
  }

  public setTool(tool: AnnotationTool): void {
    this.commitActiveText();
    this.tool = tool;
    this.overlay.dataset.tool = tool;
    if (tool === 'highlight' && this.color === DEFAULT_TEXT_COLOR) {
      this.color = DEFAULT_HIGHLIGHT_COLOR;
    } else if (tool === 'rect' && this.color === DEFAULT_TEXT_COLOR) {
      this.color = DEFAULT_DRAW_COLOR;
    }
    if (tool !== 'select') {
      this.selectedAnnId = null;
      this.callbacks.onSelectionChange?.(null);
    }
    this.callbacks.onToolChange?.(tool);
    this.render();
  }

  public setColor(color: string): void {
    this.color = color;
    if (this.page && this.selectedAnnId) {
      this.callbacks.onUpdate(this.page.uid, this.selectedAnnId, (ann) => ({ ...ann, color }));
    }
  }

  public setTextSize(size: number): void {
    this.textSize = size;
    if (this.page && this.selectedAnnId) {
      this.callbacks.onUpdate(this.page.uid, this.selectedAnnId, (ann) =>
        ann.kind === 'text' ? { ...ann, size } : ann
      );
    }
  }

  public deleteSelected(): boolean {
    if (!this.page || !this.selectedAnnId) return false;
    const id = this.selectedAnnId;
    this.selectedAnnId = null;
    this.callbacks.onSelectionChange?.(null);
    this.callbacks.onDelete(this.page.uid, id);
    return true;
  }

  public setPage(page: PageItem | null, viewRotation: Rotation, viewWidthPt: number): void {
    this.commitActiveText();
    const changedPage = this.page?.uid !== page?.uid;
    this.page = page;
    this.viewRotation = viewRotation;
    this.viewWidthPt = viewWidthPt > 0 ? viewWidthPt : 595.28;
    if (changedPage) {
      this.selectedAnnId = null;
      this.callbacks.onSelectionChange?.(null);
    } else if (
      this.selectedAnnId &&
      !page?.annotations?.some((a) => a.id === this.selectedAnnId)
    ) {
      this.selectedAnnId = null;
      this.callbacks.onSelectionChange?.(null);
    }
    this.overlay.dataset.tool = this.tool;
    this.render();
  }

  public render(): void {
    if (this.activeTextArea) return;
    this.overlay.replaceChildren();
    const page = this.page;
    if (!page || !page.annotations?.length) return;

    const overlayWidth = this.overlay.clientWidth || 1;
    const ptScale = overlayWidth / this.viewWidthPt;

    for (const ann of page.annotations) {
      const el = document.createElement('div');
      el.className = 'ann-item';
      el.dataset.annId = ann.id;
      if (ann.id === this.selectedAnnId) {
        el.classList.add('is-selected');
      }

      if (ann.kind === 'text') {
        const vp = toViewCoords({ x: ann.x, y: ann.y }, this.viewRotation);
        el.classList.add('ann-item-text');
        el.style.left = `${vp.x * 100}%`;
        el.style.top = `${vp.y * 100}%`;
        el.style.color = ann.color;
        el.style.fontSize = `${Math.max(8, ann.size * ptScale)}px`;
        el.textContent = ann.text;
      } else {
        const vr = toViewRect({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, this.viewRotation);
        el.style.left = `${vr.x * 100}%`;
        el.style.top = `${vr.y * 100}%`;
        el.style.width = `${vr.w * 100}%`;
        el.style.height = `${vr.h * 100}%`;

        if (ann.kind === 'rect') {
          el.style.border = `${Math.max(1, ann.stroke * ptScale)}px solid ${ann.color}`;
        } else {
          el.style.backgroundColor = ann.color;
          el.style.opacity = '0.35';
        }

        if (ann.id === this.selectedAnnId && this.tool === 'select') {
          const handle = document.createElement('div');
          handle.className = 'ann-resize-handle';
          el.appendChild(handle);
        }
      }

      this.overlay.appendChild(el);
    }
  }

  private commitActiveText(): void {
    const ta = this.activeTextArea;
    if (!ta) return;
    this.activeTextArea = null;
    ta.blur();
  }

  private openTextEditor(
    vx: number,
    vy: number,
    existing?: Extract<Annotation, { kind: 'text' }>
  ): void {
    if (!this.page) return;
    const pageUid = this.page.uid;
    const rot = this.viewRotation;
    const overlayWidth = this.overlay.clientWidth || 1;
    const ptScale = overlayWidth / this.viewWidthPt;
    const size = existing ? existing.size : this.textSize;
    const color = existing ? existing.color : this.color;

    const ta = document.createElement('textarea');
    ta.className = 'ann-text-input';
    ta.style.left = `${clamp01(vx) * 100}%`;
    ta.style.top = `${clamp01(vy) * 100}%`;
    ta.style.fontSize = `${Math.max(10, size * ptScale)}px`;
    ta.style.color = color;
    ta.value = existing ? existing.text : '';
    ta.rows = existing ? Math.max(1, existing.text.split('\n').length) : 1;

    this.activeTextArea = ta;
    this.overlay.appendChild(ta);
    ta.focus();
    ta.select();

    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      if (this.activeTextArea === ta) {
        this.activeTextArea = null;
      }
      const rawText = ta.value;
      ta.remove();

      if (!commit) {
        this.render();
        return;
      }

      const trimmed = rawText.trim();
      if (existing) {
        if (!trimmed) {
          this.callbacks.onDelete(pageUid, existing.id);
        } else if (rawText !== existing.text) {
          this.callbacks.onUpdate(pageUid, existing.id, (a) =>
            a.kind === 'text' ? { ...a, text: rawText } : a
          );
        } else {
          this.render();
        }
      } else if (trimmed) {
        const pt = toPageCoords({ x: vx, y: vy }, rot);
        const ann: Annotation = {
          id: nextAnnId(),
          kind: 'text',
          x: pt.x,
          y: pt.y,
          text: rawText,
          size,
          color,
        };
        this.selectedAnnId = ann.id;
        this.callbacks.onSelectionChange?.(ann.id);
        this.callbacks.onAdd(pageUid, ann);
      } else {
        this.render();
      }
    };

    ta.addEventListener('input', () => {
      ta.rows = Math.max(1, ta.value.split('\n').length);
    });

    ta.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });

    ta.addEventListener('blur', () => {
      finish(true);
    });
  }

  private setupEvents(): void {
    this.overlay.addEventListener('dblclick', (e: MouseEvent) => {
      if (this.tool !== 'select' || !this.page) return;
      const itemEl = (e.target as HTMLElement).closest<HTMLElement>('.ann-item');
      const annId = itemEl?.dataset.annId;
      if (!annId) return;
      const ann = this.page.annotations?.find((a) => a.id === annId);
      if (ann && ann.kind === 'text') {
        e.stopPropagation();
        const vp = toViewCoords({ x: ann.x, y: ann.y }, this.viewRotation);
        itemEl.style.visibility = 'hidden';
        this.openTextEditor(vp.x, vp.y, ann);
      }
    });

    this.overlay.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || !this.page) return;
      if ((e.target as HTMLElement).classList.contains('ann-text-input')) return;
      if (this.activeTextArea) {
        this.commitActiveText();
        return;
      }

      const rect = this.overlay.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      if (this.tool === 'text') {
        e.preventDefault();
        const vx = clamp01((e.clientX - rect.left) / rect.width);
        const vy = clamp01((e.clientY - rect.top) / rect.height);
        this.openTextEditor(vx, vy);
        return;
      }

      if (this.tool === 'rect' || this.tool === 'highlight') {
        e.preventDefault();
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top;
        const boxEl = document.createElement('div');
        boxEl.className = 'ann-draft-box';
        if (this.tool === 'rect') {
          boxEl.style.border = `2px solid ${this.color}`;
        } else {
          boxEl.style.backgroundColor = this.color;
          boxEl.style.opacity = '0.35';
        }
        boxEl.style.left = `${startX}px`;
        boxEl.style.top = `${startY}px`;
        boxEl.style.width = '0px';
        boxEl.style.height = '0px';
        this.overlay.appendChild(boxEl);

        this.dragOp = {
          kind: 'create',
          tool: this.tool,
          startX,
          startY,
          curX: startX,
          curY: startY,
          boxEl,
        };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }

      // Select tool
      const handleEl = (e.target as HTMLElement).closest<HTMLElement>('.ann-resize-handle');
      const itemEl = (e.target as HTMLElement).closest<HTMLElement>('.ann-item');
      const annId = itemEl?.dataset.annId;
      const ann = annId ? this.page.annotations?.find((a) => a.id === annId) : undefined;

      if (!ann || !itemEl) {
        this.selectedAnnId = null;
        this.callbacks.onSelectionChange?.(null);
        this.render();
        return;
      }

      e.preventDefault();
      if (this.selectedAnnId !== ann.id) {
        this.selectedAnnId = ann.id;
        this.callbacks.onSelectionChange?.(ann.id);
        this.render();
      }

      const freshEl = this.overlay.querySelector<HTMLElement>(`[data-ann-id="${ann.id}"]`) ?? itemEl;

      if (handleEl && (ann.kind === 'rect' || ann.kind === 'highlight')) {
        const vr = toViewRect({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, this.viewRotation);
        this.dragOp = {
          kind: 'resize',
          ann,
          startX: e.clientX,
          startY: e.clientY,
          origViewX: vr.x,
          origViewY: vr.y,
          origViewW: vr.w,
          origViewH: vr.h,
          dx: 0,
          dy: 0,
          el: freshEl,
        };
      } else {
        const pos =
          ann.kind === 'text'
            ? { ...toViewCoords({ x: ann.x, y: ann.y }, this.viewRotation), w: 0, h: 0 }
            : toViewRect({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, this.viewRotation);
        this.dragOp = {
          kind: 'move',
          ann,
          startX: e.clientX,
          startY: e.clientY,
          origViewX: pos.x,
          origViewY: pos.y,
          viewW: pos.w,
          viewH: pos.h,
          dx: 0,
          dy: 0,
          el: freshEl,
        };
      }
      this.overlay.setPointerCapture(e.pointerId);
    });

    this.overlay.addEventListener('pointermove', (e: PointerEvent) => {
      const op = this.dragOp;
      if (!op) return;
      const rect = this.overlay.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      if (op.kind === 'create') {
        op.curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        op.curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        const left = Math.min(op.startX, op.curX);
        const top = Math.min(op.startY, op.curY);
        const w = Math.abs(op.curX - op.startX);
        const h = Math.abs(op.curY - op.startY);
        op.boxEl.style.left = `${left}px`;
        op.boxEl.style.top = `${top}px`;
        op.boxEl.style.width = `${w}px`;
        op.boxEl.style.height = `${h}px`;
      } else if (op.kind === 'move') {
        op.dx = (e.clientX - op.startX) / rect.width;
        op.dy = (e.clientY - op.startY) / rect.height;
        const nx = clamp01(op.origViewX + op.dx);
        const ny = clamp01(op.origViewY + op.dy);
        op.el.style.left = `${nx * 100}%`;
        op.el.style.top = `${ny * 100}%`;
      } else if (op.kind === 'resize') {
        op.dx = (e.clientX - op.startX) / rect.width;
        op.dy = (e.clientY - op.startY) / rect.height;
        const nw = Math.max(0.015, Math.min(1 - op.origViewX, op.origViewW + op.dx));
        const nh = Math.max(0.015, Math.min(1 - op.origViewY, op.origViewH + op.dy));
        op.el.style.width = `${nw * 100}%`;
        op.el.style.height = `${nh * 100}%`;
      }
    });

    const finishDrag = (commit: boolean): void => {
      const op = this.dragOp;
      if (!op) return;
      this.dragOp = null;

      const rect = this.overlay.getBoundingClientRect();
      if (op.kind === 'create') {
        op.boxEl.remove();
        if (!commit || !this.page || rect.width <= 0 || rect.height <= 0) return;
        const pxW = Math.abs(op.curX - op.startX);
        const pxH = Math.abs(op.curY - op.startY);
        if (pxW < 4 || pxH < 4) return;

        const vx = Math.min(op.startX, op.curX) / rect.width;
        const vy = Math.min(op.startY, op.curY) / rect.height;
        const vw = pxW / rect.width;
        const vh = pxH / rect.height;
        const pageRect = toPageRect({ x: vx, y: vy, w: vw, h: vh }, this.viewRotation);

        const ann: Annotation =
          op.tool === 'rect'
            ? {
                id: nextAnnId(),
                kind: 'rect',
                ...pageRect,
                color: this.color,
                stroke: 2,
              }
            : {
                id: nextAnnId(),
                kind: 'highlight',
                ...pageRect,
                color: this.color,
              };

        this.selectedAnnId = ann.id;
        this.callbacks.onSelectionChange?.(ann.id);
        this.callbacks.onAdd(this.page.uid, ann);
      } else if (op.kind === 'move') {
        if (!commit || !this.page || (Math.abs(op.dx) < 0.002 && Math.abs(op.dy) < 0.002)) {
          this.render();
          return;
        }
        const nx = clamp01(op.origViewX + op.dx);
        const ny = clamp01(op.origViewY + op.dy);
        if (op.ann.kind === 'text') {
          const pt = toPageCoords({ x: nx, y: ny }, this.viewRotation);
          this.callbacks.onUpdate(this.page.uid, op.ann.id, (a) =>
            a.kind === 'text' ? { ...a, x: pt.x, y: pt.y } : a
          );
        } else {
          const pr = toPageRect(
            { x: nx, y: ny, w: op.viewW, h: op.viewH },
            this.viewRotation
          );
          this.callbacks.onUpdate(this.page.uid, op.ann.id, (a) =>
            a.kind === 'rect' || a.kind === 'highlight' ? { ...a, ...pr } : a
          );
        }
      } else if (op.kind === 'resize') {
        if (!commit || !this.page || (Math.abs(op.dx) < 0.002 && Math.abs(op.dy) < 0.002)) {
          this.render();
          return;
        }
        const nw = Math.max(0.015, Math.min(1 - op.origViewX, op.origViewW + op.dx));
        const nh = Math.max(0.015, Math.min(1 - op.origViewY, op.origViewH + op.dy));
        const pr = toPageRect(
          { x: op.origViewX, y: op.origViewY, w: nw, h: nh },
          this.viewRotation
        );
        this.callbacks.onUpdate(this.page.uid, op.ann.id, (a) =>
          a.kind === 'rect' || a.kind === 'highlight' ? { ...a, ...pr } : a
        );
      }
    };

    this.overlay.addEventListener('pointerup', () => finishDrag(true));
    this.overlay.addEventListener('pointercancel', () => finishDrag(false));
  }
}
