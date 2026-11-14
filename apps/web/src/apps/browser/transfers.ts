import type { FileService } from '../../../../../packages/contracts/src';

export function downloadName(input: string): string {
  const clean = input.normalize('NFC').replace(/[\x00-\x1f\x7f/\\]/g, '_');
  let name = '';
  for (const character of clean) { if (new TextEncoder().encode(name + character).length > 180) break; name += character; }
  return !name || name === '.' || name === '..' ? 'download' : name;
}

/** Runs in the user's client. LopeDrive's normal sync encrypts content and metadata. */
export async function saveBrowserDownload(files: FileService, blob: Blob, filename: string, assertCurrent: () => void = () => {}): Promise<string> {
  if (!files.writeBinary) throw new Error('File storage is unavailable. Save this download to your device.');
  if (blob.size > 1024 * 1024 * 1024) throw new Error('LopeDrive files are limited to 1 GB. Save this download to your device.');
  const directory = '/LopeDrive/Downloads';
  assertCurrent();
  try { await files.mkdir(directory); }
  catch (error) { assertCurrent(); if ((error as { code?: string }).code !== 'CONFLICT' || (await files.stat(directory)).type !== 'directory') throw error; }
  assertCurrent();
  const data = new Uint8Array(await blob.arrayBuffer()), name = downloadName(filename);
  for (let index = 0; index < 100; index++) {
    const path = `${directory}/${index ? index + '-' : ''}${name}`;
    assertCurrent();
    try { await files.writeBinary(path, data, { createOnly: true, assertCurrent }); return path; }
    catch (error) { if ((error as { code?: string }).code !== 'CONFLICT') throw error; }
  }
  throw new Error('A file with this name already exists. Save a copy to your device.');
}
