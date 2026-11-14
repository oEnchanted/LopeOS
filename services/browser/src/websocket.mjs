import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** A minimal RFC 6455 server endpoint: unfragmented sends, masked client frames, no extensions. */
export class WebSocketConnection extends EventEmitter {
  constructor(socket, { maxMessage = 1024 * 1024 } = {}) {
    super();
    this.socket = socket; this.maxMessage = maxMessage;
    this.parts = []; this.partsLength = 0; this.fragments = null; this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', chunk => this.receive(chunk));
    socket.on('drain', () => this.emit('drain'));
    socket.on('error', () => this.finish());
    socket.on('close', () => this.finish());
  }
  get bufferedAmount() { return this.socket.writableLength; }
  receive(chunk) {
    this.parts.push(chunk); this.partsLength += chunk.length;
    if (this.partsLength > this.maxMessage + 16) { this.close(1009, 'Message too large'); return; }
    let buffer = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.partsLength);
    let offset = 0;
    while (!this.closed) {
      if (buffer.length - offset < 2) break;
      const first = buffer[offset], second = buffer[offset + 1];
      const fin = (first & 0x80) !== 0, opcode = first & 0x0f, masked = (second & 0x80) !== 0;
      let length = second & 0x7f, header = 2;
      if (first & 0x70) { this.close(1002, 'Unsupported extension'); return; }
      if (length === 126) { if (buffer.length - offset < 4) break; length = buffer.readUInt16BE(offset + 2); header = 4; }
      else if (length === 127) {
        if (buffer.length - offset < 10) break;
        const high = buffer.readUInt32BE(offset + 2), low = buffer.readUInt32BE(offset + 6);
        if (high) { this.close(1009, 'Message too large'); return; }
        length = low; header = 10;
      }
      if (!masked) { this.close(1002, 'Client frames must be masked'); return; }
      if (length > this.maxMessage) { this.close(1009, 'Message too large'); return; }
      if (buffer.length - offset < header + 4 + length) break;
      const mask = buffer.subarray(offset + header, offset + header + 4);
      const payload = Buffer.from(buffer.subarray(offset + header + 4, offset + header + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3];
      offset += header + 4 + length;
      this.frame(fin, opcode, payload);
    }
    const rest = buffer.subarray(offset);
    this.parts = rest.length ? [Buffer.from(rest)] : []; this.partsLength = rest.length;
  }
  frame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000); return; }
    if (opcode === 0x9) { this.write(0xa, payload); return; }
    if (opcode === 0xa) return;
    if (opcode === 0x0) {
      if (!this.fragments) { this.close(1002, 'Unexpected continuation'); return; }
      this.fragments.parts.push(payload); this.fragments.length += payload.length;
      if (this.fragments.length > this.maxMessage) { this.close(1009, 'Message too large'); return; }
      if (fin) { const { opcode: type, parts } = this.fragments; this.fragments = null; this.deliver(type, Buffer.concat(parts)); }
      return;
    }
    if (opcode !== 0x1 && opcode !== 0x2) { this.close(1003, 'Unsupported data'); return; }
    if (!fin) { this.fragments = { opcode, parts: [payload], length: payload.length }; return; }
    this.deliver(opcode, payload);
  }
  deliver(opcode, payload) {
    if (opcode === 0x1) this.emit('message', payload.toString('utf8'), false);
    else this.emit('message', payload, true);
  }
  write(opcode, ...chunks) {
    if (this.closed || this.socket.destroyed) return false;
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const header = length < 126 ? Buffer.from([0x80 | opcode, length])
      : length < 65536 ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127, 0, 0, 0, 0]), (() => { const value = Buffer.alloc(4); value.writeUInt32BE(length); return value; })()]);
    // One write per message keeps it contiguous on the socket and avoids copying large frames.
    if (chunks.length === 1 && length < 65536) return this.socket.write(Buffer.concat([header, chunks[0]]));
    this.socket.cork(); this.socket.write(header); for (const chunk of chunks) this.socket.write(chunk);
    process.nextTick(() => this.socket.uncork());
    return this.socket.writableLength < 1024 * 1024;
  }
  sendText(text) { return this.write(0x1, Buffer.from(text)); }
  sendBinary(...chunks) { return this.write(0x2, ...chunks); }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason)); body.writeUInt16BE(code); body.write(reason, 2);
    try { this.write(0x8, body); } catch {}
    this.closed = true; this.socket.end();
    setTimeout(() => this.socket.destroy(), 2000).unref();
    this.emit('close', code);
  }
  finish() { if (this.closed) return; this.closed = true; this.socket.destroy(); this.emit('close', 1006); }
}

/** Completes the opening handshake for an already-authorized upgrade request, or rejects it. */
export function acceptWebSocket(request, socket, head, options) {
  const key = request.headers['sec-websocket-key'];
  if (String(request.headers.upgrade).toLowerCase() !== 'websocket' || request.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const connection = new WebSocketConnection(socket, options);
  if (head?.length) connection.receive(head);
  return connection;
}
