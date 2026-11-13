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
export function findNext(text: string, query: string, from = 0, matchCase = false): [number, number] | null {
  if (!query) return null;
  const source = matchCase ? text : text.toLocaleLowerCase();
  const needle = matchCase ? query : query.toLocaleLowerCase();
  let index = source.indexOf(needle, from);
  if (index < 0) index = source.indexOf(needle);
  return index < 0 ? null : [index, index + query.length];
}
export function replaceAllText(text: string, query: string, replacement: string, matchCase = false): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let count = 0;
  return { text: text.replace(new RegExp(escaped, matchCase ? 'g' : 'gi'), () => { count++; return replacement; }), count };
}
