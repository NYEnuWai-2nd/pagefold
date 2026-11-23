import { toViewCoords, toViewRect } from './annotations.ts';
import { renderPdfThumbnail, type LoadedSource } from './pdf.ts';
import type { Annotation, PageItem, Rotation, SourceFileInfo } from './state.ts';

export interface GridCallbacks {
  onSelectOne: (uid: string) => void;
  onToggleSelect: (uid: string) => void;
  onSelectRange: (uid: string) => void;
  onClearSelection: () => void;
  onReorder: (targetIndex: number) => void;
  onOpenPreview: (uid: string) => void;
  getTranslationPageLabel: (n: number) => string;
}

const SOURCE_COLOR_COUNT = 8;

export class PageGridController {
  private container: HTMLElement;
  private sourcesMap: Map<string, LoadedSource>;
  private callbacks: GridCallbacks;
  private thumbCache = new Map<string, string>();
  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderQueue: Array<{
    key: string;
    sourceId: string;
    pageIndex: number;
    imgEl: HTMLImageElement;
    stageEl: HTMLElement;
  }> = [];
  private activeRenders = 0;
  private readonly maxConcurrentRenders = 3;

  private sourceInfoMap = new Map<string, SourceFileInfo>();
  private selectedUids = new Set<string>();
  private externalMarkerEl: HTMLElement | null = null;

  private dragState: {
    uid: string;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    active: boolean;
    targetIndex: number | null;
    ghostEl: HTMLElement | null;
    markerEl: HTMLElement | null;
    cardRects: Array<{ index: number; rect: DOMRect }>;
    autoScrollRaf: number | null;
  } | null = null;

  constructor(
    container: HTMLElement,
    sourcesMap: Map<string, LoadedSource>,
    callbacks: GridCallbacks
  ) {
    this.container = container;
    this.sourcesMap = sourcesMap;
    this.callbacks = callbacks;
    this.setupObserver();
    this.setupResizeObserver();
    this.setupContainerEvents();
  }

  public destroy(): void {
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.renderQueue = [];
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      this.syncAllAnnotationOverlays();
    });
  }

  private syncThumbAnnotationOverlay(
    stage: HTMLElement,
    img: HTMLImageElement,
    overlay: HTMLElement
  ): void {
    if (!img.isConnected || !stage.isConnected) return;
    const sr = stage.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    if (sr.width <= 0 || ir.width <= 0) return;
    overlay.style.left = `${ir.left - sr.left}px`;
    overlay.style.top = `${ir.top - sr.top}px`;
    overlay.style.width = `${ir.width}px`;
    overlay.style.height = `${ir.height}px`;
  }

  private syncAllAnnotationOverlays(): void {
    const overlays = this.container.querySelectorAll<HTMLElement>('.thumb-ann-overlay');
    for (const overlay of overlays) {
      const stage = overlay.parentElement;
      if (!stage) continue;
      const img = stage.querySelector<HTMLImageElement>('.thumb-img');
      if (!img) continue;
      this.syncThumbAnnotationOverlay(stage, img, overlay);
    }
  }

  private setupObserver(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target as HTMLElement;
          const key = card.dataset.thumbKey;
          const sourceId = card.dataset.sourceId;
          const pageIndexStr = card.dataset.pageIndex;
          if (!key || !sourceId || pageIndexStr === undefined) continue;

          this.observer?.unobserve(card);
          const imgEl = card.querySelector<HTMLImageElement>('.thumb-img');
          const stageEl = card.querySelector<HTMLElement>('.thumb-stage');
          if (!imgEl || !stageEl) continue;

          const cached = this.thumbCache.get(key);
          if (cached) {
            imgEl.src = cached;
            stageEl.classList.add('is-loaded');
            continue;
          }

          this.enqueueRender({
            key,
            sourceId,
            pageIndex: Number(pageIndexStr),
            imgEl,
            stageEl,
          });
        }
      },
      {
        root: this.container.parentElement,
        rootMargin: '240px 0px',
        threshold: 0.01,
      }
    );
  }

  private enqueueRender(job: {
    key: string;
    sourceId: string;
    pageIndex: number;
    imgEl: HTMLImageElement;
    stageEl: HTMLElement;
  }): void {
    this.renderQueue.push(job);
    this.pumpQueue();
  }

  private pumpQueue(): void {
    while (this.activeRenders < this.maxConcurrentRenders && this.renderQueue.length > 0) {
      const job = this.renderQueue.shift()!;
      if (!job.imgEl.isConnected) continue;

      const cached = this.thumbCache.get(job.key);
      if (cached) {
        job.imgEl.src = cached;
        job.stageEl.classList.add('is-loaded');
        continue;
      }

      const loaded = this.sourcesMap.get(job.sourceId);
      if (!loaded || loaded.kind !== 'pdf') continue;

      this.activeRenders += 1;
      const canvas = document.createElement('canvas');
      renderPdfThumbnail(loaded, job.pageIndex, canvas, 180)
        .then(() => canvasToJpegUrl(canvas))
        .then((blobUrl) => {
          const prev = this.thumbCache.get(job.key);
          if (prev && prev !== blobUrl) {
            URL.revokeObjectURL(prev);
          }
          this.thumbCache.set(job.key, blobUrl);
          if (job.imgEl.isConnected) {
            job.imgEl.src = blobUrl;
            job.stageEl.classList.add('is-loaded');
          }
        })
        .catch(() => {
          // Keep placeholder on error
        })
        .finally(() => {
          this.activeRenders -= 1;
          this.pumpQueue();
        });
    }
  }

  public clearThumbnailCacheForSource(sourceId: string): void {
    const prefix = `${sourceId}:`;
    for (const [key, url] of this.thumbCache.entries()) {
      if (key.startsWith(prefix)) {
        URL.revokeObjectURL(url);
        this.thumbCache.delete(key);
      }
    }
  }

  public updateSelection(selectedUids: Set<string>): void {
    this.selectedUids = selectedUids;
    const cards = this.container.querySelectorAll<HTMLElement>('.page-card');
    for (const card of cards) {
      const uid = card.dataset.uid ?? '';
      const isSelected = selectedUids.has(uid);
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }
  }

  public render(
    pages: PageItem[],
    sources: SourceFileInfo[],
    selectedUids: Set<string>
  ): void {
    this.selectedUids = selectedUids;
    this.sourceInfoMap = new Map(sources.map((s) => [s.id, s]));

    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.renderQueue = [];
    this.container.replaceChildren();

    const fragment = document.createDocumentFragment();

    pages.forEach((page, index) => {
      const srcInfo = this.sourceInfoMap.get(page.sourceId);
      const loaded = this.sourcesMap.get(page.sourceId);
      const isSelected = selectedUids.has(page.uid);

      const card = document.createElement('div');
      card.className = 'page-card';
      if (isSelected) card.classList.add('is-selected');
      card.dataset.uid = page.uid;
      card.dataset.index = String(index);
      card.dataset.sourceId = page.sourceId;
      card.dataset.pageIndex = String(page.pageIndex);
      card.tabIndex = 0;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', isSelected ? 'true' : 'false');

      const colorIdx = (srcInfo?.colorIndex ?? 0) % SOURCE_COLOR_COUNT;
      card.style.setProperty('--source-color', `var(--tag-${colorIdx})`);

      const stage = document.createElement('div');
      stage.className = 'thumb-stage';

      const img = document.createElement('img');
      img.className = 'thumb-img';
      img.alt = `${srcInfo?.name ?? 'Page'} ${page.pageIndex + 1}`;
      img.draggable = false;
      if (page.rotation === 90 || page.rotation === 270) {
        img.classList.add('is-quarter-rotated');
      }
      if (page.rotation !== 0) {
        img.style.transform = `rotate(${page.rotation}deg)`;
      }

      if (loaded?.kind === 'image' && loaded.objectUrl) {
        img.src = loaded.objectUrl;
        stage.classList.add('is-loaded');
      } else {
        const key = `${page.sourceId}:${page.pageIndex}`;
        card.dataset.thumbKey = key;
        const cached = this.thumbCache.get(key);
        if (cached) {
          img.src = cached;
          stage.classList.add('is-loaded');
        } else {
          this.observer?.observe(card);
        }
      }

      stage.appendChild(img);

      const meta = document.createElement('div');
      meta.className = 'page-meta';

      const numBadge = document.createElement('span');
      numBadge.className = 'page-number';
      numBadge.textContent = this.callbacks.getTranslationPageLabel(index + 1);

      const sourceTag = document.createElement('span');
      sourceTag.className = 'source-tag';
      sourceTag.title = srcInfo?.name ?? '';

      const dot = document.createElement('span');
      dot.className = 'source-dot';
      const label = document.createElement('span');
      label.className = 'source-name';
      label.textContent = srcInfo?.name ?? '';

      sourceTag.append(dot, label);
      meta.append(numBadge, sourceTag);

      if (page.rotation !== 0) {
        const rotBadge = document.createElement('span');
        rotBadge.className = 'rotation-badge';
        rotBadge.textContent = `${page.rotation}°`;
        stage.appendChild(rotBadge);
      }

      if (page.annotations?.length) {
        const annBadge = document.createElement('span');
        annBadge.className = 'annotation-badge';
        annBadge.innerHTML =
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
        stage.appendChild(annBadge);

        const existingAngle =
          loaded?.kind === 'pdf'
            ? loaded.pdfDoc.getPage(page.pageIndex).getRotation().angle
            : 0;
        const totalRot = (((existingAngle + page.rotation) % 360) + 360) % 360 as Rotation;
        const annOverlay = buildThumbAnnotationOverlay(page.annotations, totalRot);
        stage.appendChild(annOverlay);

        const syncOverlay = (): void => {
          this.syncThumbAnnotationOverlay(stage, img, annOverlay);
        };
        img.addEventListener('load', syncOverlay);
        this.resizeObserver?.observe(stage);
        this.resizeObserver?.observe(img);
        requestAnimationFrame(syncOverlay);
      }

      card.append(stage, meta);
      fragment.appendChild(card);
    });

    this.container.appendChild(fragment);
  }

  private setupContainerEvents(): void {
    this.container.addEventListener('dblclick', (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.page-card');
      const uid = card?.dataset.uid;
      if (uid) {
        this.callbacks.onOpenPreview(uid);
      }
    });

    this.container.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      const card = (e.target as HTMLElement).closest<HTMLElement>('.page-card');
      if (!card) {
        this.callbacks.onClearSelection();
        return;
      }

      const uid = card.dataset.uid;
      if (!uid) return;

      // Prevent text selection while dragging
      e.preventDefault();
      card.focus({ preventScroll: true });

      this.dragState = {
        uid,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        active: false,
        targetIndex: null,
        ghostEl: null,
        markerEl: null,
        cardRects: [],
        autoScrollRaf: null,
      };
    });

    const scrollContainer = this.container.parentElement;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', () => {
        const ds = this.dragState;
        if (!ds || !ds.active) return;
        this.refreshCardRects(ds);
        this.updateDrag(ds, ds.lastX, ds.lastY);
      });
    }

    window.addEventListener('pointermove', (e: PointerEvent) => {
      const ds = this.dragState;
      if (!ds || e.pointerId !== ds.pointerId) return;

      ds.lastX = e.clientX;
      ds.lastY = e.clientY;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (!ds.active) {
        if (Math.hypot(dx, dy) < 6) return;
        this.beginDrag(ds, e.clientX, e.clientY);
      }

      this.updateDrag(ds, e.clientX, e.clientY);
      this.ensureAutoScroll(ds);
    });

    window.addEventListener('pointerup', (e: PointerEvent) => {
      const ds = this.dragState;
      if (!ds || e.pointerId !== ds.pointerId) return;
      this.dragState = null;

      if (!ds.active) {
        // Treat as click selection
        if (e.shiftKey) {
          this.callbacks.onSelectRange(ds.uid);
        } else if (e.ctrlKey || e.metaKey) {
          this.callbacks.onToggleSelect(ds.uid);
        } else {
          this.callbacks.onSelectOne(ds.uid);
        }
        return;
      }

      const targetIndex = ds.targetIndex;
      this.endDrag(ds);
      if (targetIndex !== null) {
        this.callbacks.onReorder(targetIndex);
      }
    });

    window.addEventListener('pointercancel', (e: PointerEvent) => {
      const ds = this.dragState;
      if (!ds || e.pointerId !== ds.pointerId) return;
      this.dragState = null;
      if (ds.active) {
        this.endDrag(ds);
      }
    });
  }

  private beginDrag(
    ds: NonNullable<PageGridController['dragState']>,
    clientX: number,
    clientY: number
  ): void {
    ds.active = true;
    if (!this.selectedUids.has(ds.uid)) {
      this.callbacks.onSelectOne(ds.uid);
    }

    const cards = Array.from(this.container.querySelectorAll<HTMLElement>('.page-card'));
    ds.cardRects = cards.map((el, index) => {
      if (el.dataset.uid && this.selectedUids.has(el.dataset.uid)) {
        el.classList.add('is-dragging');
      }
      return { index, rect: el.getBoundingClientRect() };
    });

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const count = Math.max(1, this.selectedUids.size);
    ghost.textContent = count === 1 ? '1' : `${count}`;
    ghost.style.left = `${clientX + 12}px`;
    ghost.style.top = `${clientY + 12}px`;
    document.body.appendChild(ghost);
    ds.ghostEl = ghost;

    const marker = document.createElement('div');
    marker.className = 'insertion-marker';
    document.body.appendChild(marker);
    ds.markerEl = marker;
  }

  private computeDropSlot(
    cardRects: Array<{ index: number; rect: DOMRect }>,
    clientX: number,
    clientY: number
  ): { index: number; markerX: number; markerTop: number; markerHeight: number } | null {
    if (cardRects.length === 0) return null;

    let bestIndex = 0;
    let bestDist = Infinity;
    let markerX = cardRects[0].rect.left - 6;
    let markerTop = cardRects[0].rect.top;
    let markerHeight = cardRects[0].rect.height;

    for (const { index, rect } of cardRects) {
      const cy = rect.top + rect.height / 2;
      const dy = Math.abs(clientY - cy);

      const leftDist = Math.hypot(clientX - rect.left, dy * 1.4);
      if (leftDist < bestDist) {
        bestDist = leftDist;
        bestIndex = index;
        markerX = rect.left - 7;
        markerTop = rect.top;
        markerHeight = rect.height;
      }

      const rightDist = Math.hypot(clientX - rect.right, dy * 1.4);
      if (rightDist < bestDist) {
        bestDist = rightDist;
        bestIndex = index + 1;
        markerX = rect.right + 5;
        markerTop = rect.top;
        markerHeight = rect.height;
      }
    }

    return { index: bestIndex, markerX, markerTop, markerHeight };
  }

  public findDropSlot(clientX: number, clientY: number): number | undefined {
    const cards = Array.from(this.container.querySelectorAll<HTMLElement>('.page-card'));
    if (cards.length === 0) return undefined;
    const rects = cards.map((el, index) => ({ index, rect: el.getBoundingClientRect() }));
    return this.computeDropSlot(rects, clientX, clientY)?.index;
  }

  public showExternalDropMarker(clientX: number, clientY: number): void {
    const cards = Array.from(this.container.querySelectorAll<HTMLElement>('.page-card'));
    if (cards.length === 0) {
      this.hideExternalDropMarker();
      return;
    }
    const rects = cards.map((el, index) => ({ index, rect: el.getBoundingClientRect() }));
    const slot = this.computeDropSlot(rects, clientX, clientY);
    if (!slot) return;

    if (!this.externalMarkerEl) {
      this.externalMarkerEl = document.createElement('div');
      this.externalMarkerEl.className = 'insertion-marker';
      document.body.appendChild(this.externalMarkerEl);
    }
    this.externalMarkerEl.style.left = `${slot.markerX}px`;
    this.externalMarkerEl.style.top = `${slot.markerTop}px`;
    this.externalMarkerEl.style.height = `${slot.markerHeight}px`;
  }

  public hideExternalDropMarker(): void {
    if (this.externalMarkerEl) {
      this.externalMarkerEl.remove();
      this.externalMarkerEl = null;
    }
  }

  private updateDrag(
    ds: NonNullable<PageGridController['dragState']>,
    clientX: number,
    clientY: number
  ): void {
    if (ds.ghostEl) {
      ds.ghostEl.style.left = `${clientX + 12}px`;
      ds.ghostEl.style.top = `${clientY + 12}px`;
    }

    const slot = this.computeDropSlot(ds.cardRects, clientX, clientY);
    if (!slot) return;

    ds.targetIndex = slot.index;
    if (ds.markerEl) {
      ds.markerEl.style.left = `${slot.markerX}px`;
      ds.markerEl.style.top = `${slot.markerTop}px`;
      ds.markerEl.style.height = `${slot.markerHeight}px`;
    }
  }

  private refreshCardRects(ds: NonNullable<PageGridController['dragState']>): void {
    const cards = Array.from(this.container.querySelectorAll<HTMLElement>('.page-card'));
    ds.cardRects = cards.map((el, index) => ({
      index,
      rect: el.getBoundingClientRect(),
    }));
  }

  private ensureAutoScroll(ds: NonNullable<PageGridController['dragState']>): void {
    if (ds.autoScrollRaf !== null) return;
    const scrollContainer = this.container.parentElement;
    if (!scrollContainer) return;

    const step = () => {
      const current = this.dragState;
      if (!current || !current.active || current !== ds) {
        ds.autoScrollRaf = null;
        return;
      }

      const rect = scrollContainer.getBoundingClientRect();
      const edge = 48;
      let delta = 0;
      if (current.lastY < rect.top + edge) {
        const ratio = Math.min(1, Math.max(0, (rect.top + edge - current.lastY) / edge));
        delta = -Math.ceil(4 + ratio * 14);
      } else if (current.lastY > rect.bottom - edge) {
        const ratio = Math.min(1, Math.max(0, (current.lastY - (rect.bottom - edge)) / edge));
        delta = Math.ceil(4 + ratio * 14);
      }

      if (delta !== 0) {
        const prevTop = scrollContainer.scrollTop;
        scrollContainer.scrollTop += delta;
        if (scrollContainer.scrollTop !== prevTop) {
          this.refreshCardRects(current);
          this.updateDrag(current, current.lastX, current.lastY);
        }
        ds.autoScrollRaf = requestAnimationFrame(step);
      } else {
        ds.autoScrollRaf = null;
      }
    };

    const rect = scrollContainer.getBoundingClientRect();
    if (ds.lastY < rect.top + 48 || ds.lastY > rect.bottom - 48) {
      ds.autoScrollRaf = requestAnimationFrame(step);
    }
  }

  private endDrag(ds: NonNullable<PageGridController['dragState']>): void {
    if (ds.autoScrollRaf !== null) {
      cancelAnimationFrame(ds.autoScrollRaf);
      ds.autoScrollRaf = null;
    }
    ds.ghostEl?.remove();
    ds.markerEl?.remove();
    for (const el of this.container.querySelectorAll<HTMLElement>('.page-card.is-dragging')) {
      el.classList.remove('is-dragging');
    }
  }
}

function buildThumbAnnotationOverlay(
  annotations: Annotation[],
  rotation: Rotation
): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'thumb-ann-overlay';

  for (const ann of annotations) {
    const el = document.createElement('div');
    el.className = 'thumb-ann-item';
    if (ann.kind === 'text') {
      const vp = toViewCoords({ x: ann.x, y: ann.y }, rotation);
      el.classList.add('thumb-ann-text');
      el.style.left = `${vp.x * 100}%`;
      el.style.top = `${vp.y * 100}%`;
      el.style.color = ann.color;
      el.style.fontSize = `${Math.max(4, Math.round(ann.size * 0.25))}px`;
      el.style.transformOrigin = '0 0';
      el.style.transform = `rotate(${rotation}deg)`;
      el.textContent = ann.text;
    } else {
      const vr = toViewRect({ x: ann.x, y: ann.y, w: ann.w, h: ann.h }, rotation);
      el.style.left = `${vr.x * 100}%`;
      el.style.top = `${vr.y * 100}%`;
      el.style.width = `${vr.w * 100}%`;
      el.style.height = `${vr.h * 100}%`;
      if (ann.kind === 'rect') {
        el.style.border = `1.5px solid ${ann.color}`;
      } else {
        el.style.backgroundColor = ann.color;
        el.style.opacity = '0.35';
      }
    }
    overlay.appendChild(el);
  }
  return overlay;
}

function canvasToJpegUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode thumbnail'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      'image/jpeg',
      0.85
    );
  });
}
