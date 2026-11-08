/**
 * File open/save. Uses the File System Access API (Chrome/Edge) so Save can
 * write back to the same file, and falls back to a plain download elsewhere.
 * Proxy files are usually ASCII/ANSI, so non-UTF-8 files are read and written
 * as Windows-1252 to avoid mangling accented names.
 */

export type FileEncoding = 'utf-8' | 'windows-1252';

const PICKER_TYPES = [{ description: 'RollCall proxy file', accept: { 'text/plain': ['.txt', '.ini', '.cfg'] } }];

interface FsWindow {
  showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
}
const fsw = window as unknown as FsWindow;

export function decode(bytes: Uint8Array): { text: string; encoding: FileEncoding } {
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

// Windows-1252 bytes 0x80-0x9F that differ from Latin-1.
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

export function encode(text: string, encoding: FileEncoding): Uint8Array {
  if (encoding === 'utf-8') return new TextEncoder().encode(text);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : (CP1252_HIGH[c] ?? 0x3f);
  }
  return out;
}

export interface OpenedFile {
  text: string;
  fileName: string;
  encoding: FileEncoding;
  fileHandle: FileSystemFileHandle | null;
}

export async function readFile(file: File, handle: FileSystemFileHandle | null = null): Promise<OpenedFile> {
  const { text, encoding } = decode(new Uint8Array(await file.arrayBuffer()));
  return { text, encoding, fileName: file.name, fileHandle: handle };
}

/** Show an open dialog. Resolves to null if the user cancels. */
export async function openFile(): Promise<OpenedFile | null> {
  if (fsw.showOpenFilePicker) {
    try {
      const [handle] = await fsw.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      return readFile(await handle.getFile(), handle);
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.ini,.cfg,text/plain';
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? readFile(f) : null);
    };
    input.click();
  });
}

/**
 * Save the text. Writes to `handle` when given, otherwise asks where to save
 * (or downloads). Resolves to the file name and handle used, or null if cancelled.
 */
export async function saveFile(
  text: string,
  encoding: FileEncoding,
  fileName: string,
  handle: FileSystemFileHandle | null,
): Promise<{ fileName: string; fileHandle: FileSystemFileHandle | null } | null> {
  const bytes = encode(text, encoding);
  if (!handle && fsw.showSaveFilePicker) {
    try {
      handle = await fsw.showSaveFilePicker({ suggestedName: fileName, types: PICKER_TYPES });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      throw e;
    }
  }
  if (handle) {
    const w = await (handle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
    await w.write(bytes);
    await w.close();
    return { fileName: handle.name, fileHandle: handle };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { fileName, fileHandle: null };
}
