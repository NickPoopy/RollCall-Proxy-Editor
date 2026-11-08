import { create } from 'zustand';
import { OpError } from '../model/ops';
import { parse } from '../model/parse';
import { serialize } from '../model/serialize';
import { validate } from '../model/validate';
import type { Diagnostic, LineIndex, NetAddr, ProxyDoc } from '../model/types';
import type { FileEncoding } from './files';

export type Origin = 'text' | 'editor' | 'preview';

interface Derived {
  /** Last model that parsed without errors. The editor and preview show this. */
  doc: ProxyDoc;
  /** Line positions in the current text. */
  lineIndex: LineIndex;
  /** 0-based line -> net address, for the text pane's cursor tracking. */
  lineToAddr: Map<number, NetAddr>;
  /** Errors in the current text. When non-empty, doc is from an older version of the text. */
  parseErrors: Diagnostic[];
  /** Validation results for doc. */
  issues: Diagnostic[];
}

export interface AppState extends Derived {
  text: string;
  fileName: string;
  fileHandle: FileSystemFileHandle | null;
  encoding: FileEncoding;
  /** Text as last opened or saved, to show unsaved changes. */
  savedText: string;
  selected: NetAddr | null;
  selectOrigin: Origin;
  past: string[];
  future: string[];
  lastPushAt: number;
  toast: { message: string; kind: 'error' | 'info' } | null;
  proxyVersion: string;

  /** Text typed in the raw pane. */
  setText: (text: string) => void;
  /** Replace everything, e.g. after opening a file. Clears undo history. */
  load: (text: string, meta: { fileName: string; fileHandle?: FileSystemFileHandle | null; encoding?: FileEncoding }) => void;
  /** Apply a model edit from the editor pane. Returns false if it was refused. */
  apply: (fn: (doc: ProxyDoc) => ProxyDoc) => boolean;
  select: (addr: NetAddr | null, origin: Origin) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (meta: { fileName?: string; fileHandle?: FileSystemFileHandle | null }) => void;
  showToast: (message: string, kind?: 'error' | 'info') => void;
  setProxyVersion: (v: string) => void;
}

const HISTORY_LIMIT = 200;
const TYPING_GROUP_MS = 1000;

function derive(text: string, prevDoc: ProxyDoc | null, prevIssues: Diagnostic[]): Derived {
  const r = parse(text);
  const lineToAddr = new Map<number, NetAddr>();
  r.lineIndex.netNames.forEach((lines, addr) => lines.forEach((l) => lineToAddr.set(l, addr)));
  r.lineIndex.ipShares.forEach((l, i) => lineToAddr.set(l, r.doc.ipShares[i].net));
  const parseErrors = r.diagnostics.filter((d) => d.severity === 'error');
  if (parseErrors.length > 0 && prevDoc) {
    return { doc: prevDoc, lineIndex: r.lineIndex, lineToAddr, parseErrors, issues: prevIssues };
  }
  return {
    doc: r.doc,
    lineIndex: r.lineIndex,
    lineToAddr,
    parseErrors,
    issues: [...r.diagnostics.filter((d) => d.severity !== 'error'), ...validate(r.doc, r.lineIndex)],
  };
}

function readVersion(): string {
  try {
    return localStorage.getItem('rpe.proxyVersion') || '4.9 .0';
  } catch {
    return '4.9 .0';
  }
}

export const useStore = create<AppState>((set, get) => ({
  ...derive('', null, []),
  text: '',
  fileName: 'untitled.txt',
  fileHandle: null,
  encoding: 'utf-8',
  savedText: '',
  selected: null,
  selectOrigin: 'editor',
  past: [],
  future: [],
  lastPushAt: 0,
  toast: null,
  proxyVersion: readVersion(),

  setText: (text) => {
    const s = get();
    if (text === s.text) return;
    const now = Date.now();
    const push = now - s.lastPushAt > TYPING_GROUP_MS;
    set({
      ...derive(text, s.doc, s.issues),
      text,
      past: push ? [...s.past, s.text].slice(-HISTORY_LIMIT) : s.past,
      future: [],
      lastPushAt: now,
    });
  },

  load: (text, meta) => {
    set({
      ...derive(text, null, []),
      text,
      savedText: text,
      fileName: meta.fileName,
      fileHandle: meta.fileHandle ?? null,
      encoding: meta.encoding ?? 'utf-8',
      past: [],
      future: [],
      selected: null,
    });
  },

  apply: (fn) => {
    const s = get();
    if (s.parseErrors.length > 0) {
      s.showToast('Fix the errors in the raw text first. The editor is showing the last valid version.');
      return false;
    }
    let next: ProxyDoc;
    try {
      next = fn(s.doc);
    } catch (e) {
      if (e instanceof OpError) {
        s.showToast(e.message);
        return false;
      }
      throw e;
    }
    const text = serialize(next);
    if (text === s.text) return true;
    set({
      ...derive(text, s.doc, s.issues),
      text,
      past: [...s.past, s.text].slice(-HISTORY_LIMIT),
      future: [],
      lastPushAt: 0,
    });
    return true;
  },

  select: (addr, origin) => {
    if (get().selected === addr && get().selectOrigin === origin) return;
    set({ selected: addr, selectOrigin: origin });
  },

  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const prev = s.past[s.past.length - 1];
    set({
      ...derive(prev, s.doc, s.issues),
      text: prev,
      past: s.past.slice(0, -1),
      future: [s.text, ...s.future],
      lastPushAt: 0,
    });
  },

  redo: () => {
    const s = get();
    if (s.future.length === 0) return;
    const next = s.future[0];
    set({
      ...derive(next, s.doc, s.issues),
      text: next,
      past: [...s.past, s.text],
      future: s.future.slice(1),
      lastPushAt: 0,
    });
  },

  markSaved: (meta) =>
    set((s) => ({
      savedText: s.text,
      fileName: meta.fileName ?? s.fileName,
      fileHandle: meta.fileHandle !== undefined ? meta.fileHandle : s.fileHandle,
    })),

  showToast: (message, kind = 'error') => {
    set({ toast: { message, kind } });
    const shown = get().toast;
    setTimeout(() => {
      if (get().toast === shown) set({ toast: null });
    }, 4000);
  },

  setProxyVersion: (v) => {
    try {
      localStorage.setItem('rpe.proxyVersion', v);
    } catch {
      /* storage unavailable */
    }
    set({ proxyVersion: v });
  },
}));

// ---------- Draft autosave ----------

const DRAFT_KEY = 'rpe.draft';
let draftTimer: ReturnType<typeof setTimeout> | undefined;

export function startDraftAutosave(): void {
  useStore.subscribe((s, prev) => {
    if (s.text === prev.text && s.fileName === prev.fileName) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ text: s.text, fileName: s.fileName, savedText: s.savedText, encoding: s.encoding }),
        );
      } catch {
        /* storage full or blocked */
      }
    }, 500);
  });
}

export function restoreDraft(): boolean {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw) as { text: string; fileName: string; savedText: string; encoding?: FileEncoding };
    if (typeof d.text !== 'string') return false;
    useStore.getState().load(d.text, { fileName: d.fileName || 'untitled.txt', encoding: d.encoding });
    useStore.setState({ savedText: d.savedText ?? d.text });
    return true;
  } catch {
    return false;
  }
}
