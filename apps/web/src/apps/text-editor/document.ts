export interface EditSnapshot { text: string; selectionStart: number; selectionEnd: number }
export interface EditorDocument {
  path: string | null;
  text: string;
  savedText: string;
  version: string | number | null;
  undo: EditSnapshot[];
  redo: EditSnapshot[];
  externalChange: boolean;
  deleted: boolean;
}
export function newDocument(text = '', path: string | null = null, version: string | number | null = null): EditorDocument {
  return { path, text, savedText: text, version, undo: [], redo: [], externalChange: false, deleted: false };
}
export const isDirty = (doc: EditorDocument) => doc.text !== doc.savedText;
export function editDocument(doc: EditorDocument, text: string, start = 0, end = start): EditorDocument {
  if (doc.text === text) return doc;
  return { ...doc, text, undo: [...doc.undo.slice(-199), { text: doc.text, selectionStart: start, selectionEnd: end }], redo: [] };
}
export function stepHistory(doc: EditorDocument, direction: 'undo' | 'redo', start = 0, end = start): { doc: EditorDocument; selection?: EditSnapshot } {
  const source = doc[direction]; if (!source.length) return { doc };
  const selection = source[source.length - 1];
  const other = direction === 'undo' ? 'redo' : 'undo';
  return { doc: { ...doc, text: selection.text, [direction]: source.slice(0, -1), [other]: [...doc[other], { text: doc.text, selectionStart: start, selectionEnd: end }] }, selection };
}
/** A save acknowledges the exact submitted snapshot; edits made while saving stay dirty. */
export function acknowledgeSave(doc: EditorDocument, path: string, submittedText: string, version: string | number): EditorDocument {
  return { ...doc, path, savedText: submittedText, version, externalChange: false, deleted: false };
}
export function applyExternalChange(doc: EditorDocument, text: string, version: string | number): EditorDocument {
  if (doc.version === version) return doc;
  if (isDirty(doc)) return { ...doc, externalChange: true };
  return newDocument(text, doc.path, version);
}
function searchPattern(query: string, matchCase: boolean): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
}
export function findNext(text: string, query: string, from = 0, matchCase = false): [number, number] | null {
  if (!query) return null;
  // Match the original text: lowercasing can expand Unicode characters and shift offsets.
  const pattern = searchPattern(query, matchCase);
  pattern.lastIndex = from;
  let match = pattern.exec(text);
  if (!match) { pattern.lastIndex = 0; match = pattern.exec(text); }
  return match ? [match.index, match.index + match[0].length] : null;
}
export function replaceAllText(text: string, query: string, replacement: string, matchCase = false): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  let count = 0;
  return { text: text.replace(searchPattern(query, matchCase), () => { count++; return replacement; }), count };
}
