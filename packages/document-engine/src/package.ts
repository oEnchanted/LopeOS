import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (s: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`;
export const escapeXml = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

/** An actual OOXML package, also used by regression fixtures. No HTML serialization. */
export function createDocument(paragraphs: Array<{ text: string; style?: string; pageBreak?: boolean }> = [{ text: '' }]): Uint8Array {
  const parts: Record<string, string> = {
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'),
    'word/document.xml': xml(`<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${paragraphs.map((p, i) => `<w:p w14:paraId="${(i + 1).toString(16).padStart(8, '0')}"><w:pPr>${p.style ? `<w:pStyle w:val="${escapeXml(p.style)}"/>` : ''}${p.pageBreak ? '<w:pageBreakBefore/>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r></w:p>`).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    'word/settings.xml': xml(`<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`),
    'word/styles.xml': xml(`<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>${[1, 2, 3].map(n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="${8 + n}"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 360 : 160}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:color w:val="0F4761"/><w:sz w:val="${n === 1 ? 40 : n === 2 ? 32 : 28}"/></w:rPr></w:style>`).join('')}<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="56"/></w:rPr></w:style><w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style></w:styles>`),
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8(value)])), { level: 6 });
}

export interface CompatibilityReport { warnings: string[]; preserveOriginal: boolean; parts: string[] }
export function inspectPackage(data: Uint8Array): CompatibilityReport {
  if (data.byteLength > 32 * 1024 * 1024) throw new Error('This file exceeds Writer’s 32 MB document limit.');
  if (data[0] === 0xd0 && data[1] === 0xcf) throw new Error('Legacy DOC or encrypted Office files need conversion in Word. The original file has not been changed.');
  if (data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('Choose a DOCX document. This file is not an Open XML package.');
  // Inspect declared sizes before decompression to bound ZIP expansion.
  let expanded = 0, entries = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i + 46 <= data.length; i++) if (view.getUint32(i, true) === 0x02014b50) {
    if (view.getUint16(i + 8, true) & 1) throw new Error('Encrypted ZIP documents need to be decrypted in Word before opening in Writer.');
    expanded += view.getUint32(i + 24, true); entries++;
    if (expanded > 128 * 1024 * 1024 || entries > 5000) throw new Error('This package expands beyond Writer’s safe document limit.');
    i += 45 + view.getUint16(i + 28, true) + view.getUint16(i + 30, true) + view.getUint16(i + 32, true);
  }
  const pkg = unzipSync(data);
  const parts = Object.keys(pkg);
  if (!pkg['word/document.xml'] || !pkg['[Content_Types].xml']) throw new Error('The DOCX package is missing its main document or content types.');
  const body = strFromU8(pkg['word/document.xml']);
  const warnings: string[] = [];
  if (parts.some(p => /vbaProject|activeX/i.test(p))) warnings.push('Macros and ActiveX controls cannot run in Writer.');
  if (parts.some(p => /embeddings\//.test(p)) || /<w:object\b/.test(body)) warnings.push('Embedded objects cannot be edited or previewed reliably.');
  if (/<w:(altChunk|subDoc)\b/.test(body)) warnings.push('Imported subdocuments may not render completely.');
  if (/<w:instrText[^>]*>[^<]*(?:INCLUDETEXT|DATABASE|DDE|LINK|FORMTEXT)/i.test(body)) warnings.push('This document contains fields whose behavior Writer cannot update.');
  if (parts.some(p => /^word\/(charts|diagrams)\//.test(p))) warnings.push('Charts and SmartArt have limited editing support.');
  if (/<w:documentProtection\b/.test(strFromU8(pkg['word/settings.xml'] || new Uint8Array()))) warnings.push('This document has editing protection. Use the read-only route.');
  return { warnings, preserveOriginal: warnings.length > 0, parts };
}

export function documentWordCount(text: string): number {
  return [...new Intl.Segmenter('en', { granularity: 'word' }).segment(text)].filter(s => s.isWordLike).length;
}
