export type ClipboardSource = 'copy' | 'cut' | 'paste' | 'import' | 'spotlight';
export interface ClipboardItem {
  id: string;
  text: string;
  time: number;
  pinned: boolean;
  source: ClipboardSource;
}
export interface ClipboardPolicy { enabled: boolean; retentionMinutes: number }

/** Text stays in this tab's memory. Even pinned items obey the retention limit. */
export class ClipboardHistory {
  private entries: ClipboardItem[] = [];
  private sequence = 0;
  private readonly policy: () => ClipboardPolicy;
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly maxTextLength: number;
  constructor(policy: () => ClipboardPolicy, now: () => number = Date.now, capacity = 50, maxTextLength = 100_000) {
    this.policy = policy; this.now = now; this.capacity = capacity; this.maxTextLength = maxTextLength;
  }

  prune(): boolean {
    const { enabled, retentionMinutes } = this.policy();
    const cutoff = this.now() - retentionMinutes * 60_000;
    const next = enabled ? this.entries.filter(item => item.time > cutoff) : [];
    if (next.length === this.entries.length) return false;
    this.entries = next;
    return true;
  }

  items(): ClipboardItem[] {
    this.prune();
    return this.entries.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time);
  }

  add(text: string, source: ClipboardSource = 'spotlight'): ClipboardItem | null {
    this.prune();
    if (!this.policy().enabled || !text.trim()) return null;
    if (text.length > this.maxTextLength) throw new Error('This text is too large for clipboard history. Save it in a document instead.');
    const duplicate = this.entries.find(item => item.text === text);
    const item = { id: duplicate?.id ?? `clip-${this.now().toString(36)}-${++this.sequence}`, text, time: this.now(), pinned: duplicate?.pinned ?? false, source };
    let others = this.entries.filter(entry => entry.id !== item.id);
    if (others.length >= this.capacity) {
      const oldest = others.filter(entry => !entry.pinned).sort((a, b) => a.time - b.time)[0];
      if (!oldest) throw new Error('Clipboard history is full. Unpin or remove an item to add another.');
      others = others.filter(entry => entry.id !== oldest.id);
    }
    this.entries = [item, ...others];
    return item;
  }

  remove(id: string): boolean {
    const next = this.entries.filter(item => item.id !== id);
    if (next.length === this.entries.length) return false;
    this.entries = next;
    return true;
  }

  togglePin(id: string): boolean {
    this.prune();
    const item = this.entries.find(entry => entry.id === id);
    if (!item) return false;
    this.entries = this.entries.map(entry => entry.id === id ? { ...entry, pinned: !entry.pinned } : entry);
    return true;
  }

  clear(): boolean {
    if (!this.entries.length) return false;
    this.entries = [];
    return true;
  }
}
