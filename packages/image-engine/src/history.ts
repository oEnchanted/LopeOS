import { allLayers, uid, type ImageDocument, type Surface } from './model.ts';
export function documentMemory(documents: ImageDocument[]) {
  const buffers = new Set<ArrayBufferLike>();
  const add = (surface?: Surface) => { if (surface) Object.values(surface.tiles).forEach(tile => buffers.add(tile.buffer)); };
  for (const doc of documents) { if (doc.selection) buffers.add(doc.selection.buffer);doc.savedSelections?.forEach(s=>buffers.add(s.pixels.buffer)); for (const layer of allLayers(doc.layers)) { add(layer.pixels); add(layer.source); add(layer.mask?.pixels);layer.rasterFilters?.forEach(filter=>add(filter.mask?.pixels)); } }
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}
export class History {
  version=0;
  entries: { name: string; document: ImageDocument }[];
  index = 0;
  savedRevision: string;
  snapshots: { name: string; document: ImageDocument }[] = [];
  readonly budget: number;
  private coalesceKey='';
  private lastCommit=0;
  constructor(document: ImageDocument, budget = 192 * 1024 * 1024) { this.budget = budget; this.entries = [{ name: 'Open', document }]; this.savedRevision = document.revision; }
  get current() { return this.entries[this.index].document; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  get dirty() { return this.current.revision !== this.savedRevision; }
  commit(name: string, document: ImageDocument, coalesceKey='') {
    if (document === this.current) return this.current;
    document = { ...document, revision: uid() };
    this.version++;
    const now=Date.now();const merge=coalesceKey&&coalesceKey===this.coalesceKey&&now-this.lastCommit<650&&this.index===this.entries.length-1&&this.index>0&&this.current.revision!==this.savedRevision;
    this.entries.splice(this.index + 1);if(merge)this.entries[this.index]={name,document};else{this.entries.push({ name, document }); this.index++;}this.coalesceKey=coalesceKey;this.lastCommit=now;
    while (this.entries.length > 2 && (this.entries.length > 80 || documentMemory(this.entries.map(entry => entry.document).concat(this.snapshots.map(s => s.document))) > this.budget)) { this.entries.shift(); this.index--; }
    return document;
  }
  view(document: ImageDocument) { if(document!==this.current)this.version++;this.entries[this.index] = { ...this.entries[this.index], document }; return document; }
  undo() { this.coalesceKey='';if (this.canUndo) {this.index--;this.version++;} return this.current; }
  redo() { this.coalesceKey='';if (this.canRedo) {this.index++;this.version++;} return this.current; }
  go(index: number) { this.coalesceKey='';this.index = Math.max(0, Math.min(index, this.entries.length - 1));this.version++; return this.current; }
  markSaved(revision = this.current.revision) { this.coalesceKey='';this.savedRevision = revision;this.version++; }
  exportState(){return {entries:[...this.entries],index:this.index,savedRevision:this.savedRevision,snapshots:[...this.snapshots]};}
  static restore(state:ReturnType<History['exportState']>){
    if(!state.entries?.length||!Number.isInteger(state.index)||!state.entries[state.index]?.document)throw new Error('Invalid session history.');
    const history=new History(state.entries[0].document);history.entries=state.entries;history.index=state.index;history.savedRevision=state.savedRevision;history.snapshots=state.snapshots||[];return history;
  }
  snapshot(name = `Snapshot ${this.snapshots.length + 1}`) {
    const docs = this.snapshots.map(s => s.document).concat(this.current);
    if (documentMemory(docs) > this.budget) throw new Error('Snapshot memory budget reached. Remove a snapshot first.');
    this.snapshots.push({ name, document: this.current });
    this.version++;
  }
}
