import type { WriterImage } from './index';

interface ImagePresentationSource {
  revision(): number;
  resolve(frame: HTMLElement): Promise<WriterImage | null>;
  get(imageId: string): Promise<WriterImage>;
}
interface PaintedImage {
  frame: HTMLElement; original: HTMLImageElement; signature: string; imageId?: string;
  resolvedRevision?: number; resolved?: WriterImage | null;
  modelSource?: string; nativeSource?: string; pendingSource?: boolean;
  opacity: string; opacityPriority: string; hiddenStyle?: string;
  mirror?: HTMLSpanElement; picture?: HTMLImageElement;
}
const owned = (node: Node) => node instanceof Element && Boolean(node.closest('[data-writer-image-presentation]'));
const style = (element: HTMLElement, values: Record<string, string>) => {
  const declaration = element.style as unknown as Record<string, string>;
  for (const [key, value] of Object.entries(values)) if (declaration[key] !== value) declaration[key] = value;
};

/** Native media can finish painting after onReady; printing must wait for it. */
export function waitForPaintedImages(host: HTMLElement, expected: number, signal: AbortSignal): Promise<void> {
  if (!expected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const failure = () => new Error('Some pictures are not ready for printing. Wait for them to load and try again.');
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => { cleanup(); reject(failure()); }, 8000);
    function cleanup() { clearTimeout(timer); observer.disconnect(); host.removeEventListener('load', check, true); host.removeEventListener('error', check, true); signal.removeEventListener('abort', aborted); }
    function aborted() { cleanup(); reject(new Error('The print preview was closed.')); }
    function check() {
      const images = [...host.querySelectorAll<HTMLImageElement>('img.superdoc-inline-image,.superdoc-floating-fragment img')];
      if (images.length < expected || images.some(image => !image.complete || !image.naturalWidth)) return;
      cleanup(); void Promise.all(images.map(image => image.decode())).then(() => resolve(), () => reject(failure()));
    }
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    host.addEventListener('load', check, true); host.addEventListener('error', check, true); signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else check();
  });
}

/**
 * The native painter currently omits image crop. Reflect the public image model
 * without changing its original node, source, hit target, size, or pagination.
 */
export class ImagePresentation {
  private images = new Map<HTMLElement, PaintedImage>();
  private models = new Map<string, Promise<WriterImage | null>>();
  private modelRevision = -1;
  private frame = 0;
  private dirty = false;
  private work: Promise<void> | null = null;
  private disposed = false;
  private mutations: MutationObserver;
  private resize: ResizeObserver;
  private loaded = (event: Event) => { if (event.target instanceof Node && !owned(event.target)) this.schedule(); };
  constructor(private host: HTMLElement, private source: ImagePresentationSource) {
    this.resize = new ResizeObserver(() => this.schedule());
    this.mutations = new MutationObserver(records => {
      const changed = records.some(record => {
        if (owned(record.target)) return false;
        if (record.type === 'childList') {
          if ([...record.removedNodes].some(node => [...this.images.values()].some(image => image.mirror === node && image.frame.isConnected))) return true;
          return [...record.addedNodes, ...record.removedNodes].some(node => !owned(node));
        }
        if (record.attributeName === 'style') {
          const image = [...this.images.values()].find(image => image.original === record.target);
          if (image?.hiddenStyle !== undefined && image.hiddenStyle === image.original.getAttribute('style')) return false;
        }
        return true;
      });
      if (changed) this.schedule();
    });
    this.mutations.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src', 'data-sd-image-id', 'data-float-para', 'data-float-offset'] });
    host.addEventListener('load', this.loaded, true);
  }
  schedule() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; void this.refresh(); });
  }
  async refresh(): Promise<void> {
    if (this.disposed) return;
    this.dirty = true;
    if (this.work) return this.work;
    this.work = this.update();
    try { await this.work; } finally { this.work = null; }
  }
  private async update() {
    while (this.dirty && !this.disposed) {
      this.dirty = false;
      const revision = this.source.revision();
      if (revision !== this.modelRevision) { this.models.clear(); this.modelRevision = revision; }
      const frames = new Set(this.host.querySelectorAll<HTMLElement>('[data-sd-image-id],img.superdoc-inline-image,.superdoc-floating-fragment'));
      for (const [frame, image] of this.images) if (!frames.has(frame) || !frame.isConnected) { this.remove(image); this.resize.unobserve(frame); this.resize.unobserve(image.original); this.images.delete(frame); }
      await Promise.all([...frames].map(async frame => {
        const original = frame instanceof HTMLImageElement ? frame : frame.querySelector<HTMLImageElement>('img:not([data-writer-image-presentation])');
        if (!original || !frame.isConnected) return;
        const signature = JSON.stringify([frame.dataset.sdImageId, frame.dataset.floatPara, frame.dataset.floatOffset, original.getAttribute('src')]);
        let image = this.images.get(frame);
        if (image && (image.original !== original || image.signature !== signature)) { this.remove(image); this.resize.unobserve(image.original); this.images.delete(frame); image = undefined; }
        if (!image) {
          image = { frame, original, signature, opacity: original.style.getPropertyValue('opacity'), opacityPriority: original.style.getPropertyPriority('opacity') };
          this.images.set(frame, image); this.resize.observe(frame); if (frame !== original) this.resize.observe(original);
        }
        const current = image;
        let model: WriterImage | null;
        if (current.imageId) {
          let pending = this.models.get(current.imageId);
          if (!pending) { pending = this.source.get(current.imageId).catch(() => null); this.models.set(current.imageId, pending); }
          model = await pending;
        } else if (current.resolvedRevision === revision) model = current.resolved || null;
        else {
          model = await this.source.resolve(frame).catch(() => null);
          current.resolvedRevision = revision; current.resolved = model;
          if (model) { current.imageId = model.sdImageId; this.models.set(model.sdImageId, Promise.resolve(model)); }
        }
        if (this.disposed || !frame.isConnected || this.images.get(frame) !== current) return;
        if (revision !== this.source.revision()) { this.dirty = true; return; }
        await this.paint(current, model);
      }));
    }
  }
  private async paint(image: PaintedImage, model: WriterImage | null) {
    if (!model) { this.remove(image); return; }
    const { original, frame } = image;
    const nativeSource = original.srcset ? original.currentSrc || original.src : original.src || original.currentSrc;
    const modelSource = model.properties.src;
    const directSource = modelSource && /^(?:data:image\/|blob:)/i.test(modelSource) ? modelSource : null;
    if (image.modelSource !== undefined && modelSource !== image.modelSource && !directSource && nativeSource === image.nativeSource) image.pendingSource = true;
    if (nativeSource !== image.nativeSource) image.pendingSource = false;
    image.modelSource = modelSource; image.nativeSource = nativeSource;
    // Do not keep a stale decorative source over a newly committed model.
    // The native renderer may deliver its new media URL in a later paint.
    if (image.pendingSource && !directSource) { this.remove(image); return; }
    const crop = model?.properties.crop;
    const percent = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.min(100, value!)) : 0;
    const left = percent(crop?.left) / 100, right = percent(crop?.right) / 100, top = percent(crop?.top) / 100, bottom = percent(crop?.bottom) / 100;
    const visibleWidth = 1 - left - right, visibleHeight = 1 - top - bottom;
    if ((!left && !right && !top && !bottom) || visibleWidth <= 0 || visibleHeight <= 0) { this.remove(image); return; }
    const parent = frame === original ? original.offsetParent : frame;
    if (!(parent instanceof HTMLElement)) { this.remove(image); return; }
    const computed = getComputedStyle(original), rect = original.getBoundingClientRect(), parentRect = parent.getBoundingClientRect();
    const width = parseFloat(computed.width), height = parseFloat(computed.height);
    if (!width || !height || !rect.width || !rect.height) return;
    const scaleX = rect.width / width, scaleY = rect.height / height;
    const x = (rect.left - parentRect.left) / scaleX + parent.scrollLeft - parent.clientLeft;
    const y = (rect.top - parentRect.top) / scaleY + parent.scrollTop - parent.clientTop;
    if (!image.mirror) {
      image.mirror = document.createElement('span'); image.mirror.dataset.writerImagePresentation = 'crop';
      image.mirror.setAttribute('aria-hidden', 'true'); image.mirror.setAttribute('role', 'presentation');
      image.picture = document.createElement('img'); image.picture.alt = ''; image.picture.draggable = false;
      image.picture.setAttribute('aria-hidden', 'true'); image.mirror.append(image.picture);
      style(image.mirror, { position: 'absolute', display: 'block', overflow: 'hidden', pointerEvents: 'none', userSelect: 'none', margin: '0', padding: '0', border: '0' });
      style(image.picture, { position: 'absolute', display: 'block', maxWidth: 'none', maxHeight: 'none', pointerEvents: 'none', userSelect: 'none', margin: '0', padding: '0', border: '0' });
    }
    if (image.mirror.parentElement !== parent) parent.append(image.mirror);
    style(image.mirror, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    style(image.picture!, { left: `${-width * left / visibleWidth}px`, top: `${-height * top / visibleHeight}px`, width: `${width / visibleWidth}px`, height: `${height / visibleHeight}px` });
    // Source replacement can commit before the native media cache repaints.
    // A decodable public data/blob source is authoritative; package-relative
    // sources continue to use the native renderer's resolved asset URL.
    const src = directSource || nativeSource;
    if (image.picture!.src !== src) image.picture!.src = src;
    if (original.style.getPropertyValue('opacity') !== '0') {
      image.opacity = original.style.getPropertyValue('opacity'); image.opacityPriority = original.style.getPropertyPriority('opacity');
      original.style.setProperty('opacity', '0');
    }
    image.hiddenStyle = original.getAttribute('style') || '';
    style(image.mirror, { opacity: image.opacity });
    await image.picture!.decode().catch(() => {});
  }
  private remove(image: PaintedImage) {
    image.mirror?.remove(); image.mirror = undefined; image.picture = undefined;
    if (image.original.style.getPropertyValue('opacity') === '0' && image.hiddenStyle !== undefined) {
      if (image.opacity) image.original.style.setProperty('opacity', image.opacity, image.opacityPriority);
      else image.original.style.removeProperty('opacity');
    }
    image.hiddenStyle = undefined;
  }
  destroy() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.mutations.disconnect(); this.resize.disconnect();
    this.host.removeEventListener('load', this.loaded, true);
    for (const image of this.images.values()) this.remove(image);
    this.images.clear(); this.models.clear();
  }
}
