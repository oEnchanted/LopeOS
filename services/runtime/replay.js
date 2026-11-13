/** Bounded output ring. Cursors count JavaScript UTF-16 units, never bytes. */
export class ReplayBuffer {
  constructor(limit = 512 * 1024) { this.limit = limit; this.chunks = []; this.bytes = 0; this.end = 0; }
  get start() { return this.chunks[0]?.start ?? this.end; }
  append(data) {
    const start = this.end; this.end += data.length;
    // node-pty normally delivers small chunks; also bound an unexpectedly large event.
    if (Buffer.byteLength(data) > this.limit) {
      let tail = data.slice(-Math.floor(this.limit / 4));
      if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
      data = tail;
      this.chunks = []; this.bytes = 0;
    }
    const size = Buffer.byteLength(data);
    if (data) { this.chunks.push({ start: this.end - data.length, end: this.end, data, size }); this.bytes += size; }
    while (this.bytes > this.limit && this.chunks.length > 1) this.bytes -= this.chunks.shift().size;
    return start;
  }
  read(cursor, max = 16384) {
    cursor = Math.max(this.start, Math.min(cursor, this.end));
    let data = '';
    for (const chunk of this.chunks) {
      if (chunk.end <= cursor) continue;
      const offset = Math.max(0, cursor - chunk.start);
      data += chunk.data.slice(offset, offset + max - data.length);
      if (data.length >= max) break;
    }
    // Do not split UTF-16 surrogate pairs between websocket messages.
    if (data.length === 1 && /[\uD800-\uDBFF]/.test(data) && max === 1) return this.read(cursor, 2);
    if (data.length > 1 && /[\uD800-\uDBFF]$/.test(data)) data = data.slice(0, -1);
    return { data, start: cursor, end: cursor + data.length };
  }
}
