/** CLIP byte-level BPE tokenizer (OpenCLIP/SD 2 variant: pad token "!" = 0). */
const BOS = 49406, EOS = 49407, PAD = 0, LENGTH = 77;
const PATTERN = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu;

function byteEncoder() {
  const bytes: number[] = [];
  for (let i = 33; i <= 126; i++) bytes.push(i);
  for (let i = 161; i <= 172; i++) bytes.push(i);
  for (let i = 174; i <= 255; i++) bytes.push(i);
  const chars = [...bytes]; let n = 0;
  for (let b = 0; b < 256; b++) if (!bytes.includes(b)) { bytes.push(b); chars.push(256 + n++); }
  const map: string[] = [];
  bytes.forEach((b, i) => { map[b] = String.fromCharCode(chars[i]); });
  return map;
}

export class ClipTokenizer {
  private ranks = new Map<string, number>();
  private cache = new Map<string, string[]>();
  private bytes = byteEncoder();
  private encoder = new TextEncoder();
  private vocab: Record<string, number>;
  constructor(vocab: Record<string, number>, merges: string) {
    this.vocab = vocab;
    merges.split('\n').slice(1).filter(Boolean).forEach((line, rank) => this.ranks.set(line, rank));
  }
  private bpe(token: string) {
    const cached = this.cache.get(token); if (cached) return cached;
    let word = [...token]; word[word.length - 1] += '</w>';
    while (word.length > 1) {
      let best = -1, bestRank = Infinity;
      for (let i = 0; i < word.length - 1; i++) { const rank = this.ranks.get(word[i] + ' ' + word[i + 1]); if (rank !== undefined && rank < bestRank) { bestRank = rank; best = i; } }
      if (best < 0) break;
      const pair = word[best] + word[best + 1], next: string[] = [];
      for (let i = 0; i < word.length; i++) {
        if (i < word.length - 1 && word[i] + word[i + 1] === pair && this.ranks.get(word[i] + ' ' + word[i + 1]) === bestRank) { next.push(pair); i++; }
        else next.push(word[i]);
      }
      word = next;
    }
    this.cache.set(token, word); return word;
  }
  encode(text: string) {
    const clean = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    const ids: number[] = [];
    for (const match of clean.matchAll(PATTERN)) {
      const mapped = [...this.encoder.encode(match[0])].map(b => this.bytes[b]).join('');
      for (const piece of this.bpe(mapped)) { const id = this.vocab[piece]; if (id !== undefined) ids.push(id); }
    }
    const tokens = [BOS, ...ids.slice(0, LENGTH - 2), EOS];
    while (tokens.length < LENGTH) tokens.push(PAD);
    return tokens;
  }
}
