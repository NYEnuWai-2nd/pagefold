import { renderPdfThumbnail, type LoadedSource } from './pdf.ts';
import type { PageItem, SourceFileInfo } from './state.ts';

export interface GridCallbacks {
  onSelectOne: (uid: string) => void;
  onToggleSelect: (uid: string) => void;
  onSelectRange: (uid: string) => void;
  onClearSelection: () => void;
  onReorder: (targetIndex: number) => void;
  getTranslationPageLabel: (n: number) => string;
}

const SOURCE_COLOR_COUNT = 8;

export class PageGridController {
  private container: HTMLElement;
  private sourcesMap: Map<string, LoadedSource>;
  private callbacks: GridCallbacks;
  private thumbCache = new Map<string, string>();
  private observer: IntersectionObserver | null = null;
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

  private dragState: {
    uid: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    targetIndex: number | null;
    ghostEl: HTMLElement | null;
    markerEl: HTMLElement | null;
    cardRects: Array<{ index: number; rect: DOMRect }>;
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
    this.setupContainerEvents();
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
        .then(() => {
          const dataUrl = canvas.toDataURL('image/png');
          this.thumbCache.set(job.key, dataUrl);
          if (job.imgEl.isConnected) {
            job.imgEl.src = dataUrl;
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
    for (const key of this.thumbCache.keys()) {
      if (key.startsWith(prefix)) {
        this.thumbCache.delete(key);
      }
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

      card.append(stage, meta);
      fragment.appendChild(card);
    });

    this.container.appendChild(fragment);
  }

  private setupContainerEvents(): void {
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
        active: false,
        targetIndex: null,
        ghostEl: null,
        markerEl: null,
        cardRects: [],
      };
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      const ds = this.dragState;
      if (!ds || e.pointerId !== ds.pointerId) return;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (!ds.active) {
        if (Math.hypot(dx, dy) < 6) return;
        this.beginDrag(ds, e.clientX, e.clientY);
      }

      this.updateDrag(ds, e.clientX, e.clientY);
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

  private updateDrag(
    ds: NonNullable<PageGridController['dragState']>,
    clientX: number,
    clientY: number
  ): void {
    if (ds.ghostEl) {
      ds.ghostEl.style.left = `${clientX + 12}px`;
      ds.ghostEl.style.top = `${clientY + 12}px`;
    }

    if (ds.cardRects.length === 0) return;

    let bestIndex = 0;
    let bestDist = Infinity;
    let markerX = ds.cardRects[0].rect.left - 6;
    let markerTop = ds.cardRects[0].rect.top;
    let markerHeight = ds.cardRects[0].rect.height;

    for (const { index, rect } of ds.cardRects) {
      const cy = rect.top + rect.height / 2;
      const dy = Math.abs(clientY - cy);

      // Left edge slot (index)
      const leftDist = Math.hypot(clientX - rect.left, dy * 1.4);
      if (leftDist < bestDist) {
        bestDist = leftDist;
        bestIndex = index;
        markerX = rect.left - 7;
        markerTop = rect.top;
        markerHeight = rect.height;
      }

      // Right edge slot (index + 1)
      const rightDist = Math.hypot(clientX - rect.right, dy * 1.4);
      if (rightDist < bestDist) {
        bestDist = rightDist;
        bestIndex = index + 1;
        markerX = rect.right + 5;
        markerTop = rect.top;
        markerHeight = rect.height;
      }
    }

    ds.targetIndex = bestIndex;
    if (ds.markerEl) {
      ds.markerEl.style.left = `${markerX}px`;
      ds.markerEl.style.top = `${markerTop}px`;
      ds.markerEl.style.height = `${markerHeight}px`;
    }
  }

  private endDrag(ds: NonNullable<PageGridController['dragState']>): void {
    ds.ghostEl?.remove();
    ds.markerEl?.remove();
    for (const el of this.container.querySelectorAll<HTMLElement>('.page-card.is-dragging')) {
      el.classList.remove('is-dragging');
    }
  }
}
