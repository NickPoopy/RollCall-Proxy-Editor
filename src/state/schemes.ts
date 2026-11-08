import { create } from 'zustand';
import { isScheme, pruneSchemes, remapSchemes, type Scheme, type SchemeMap } from '../model/ipscheme';
import type { NetAddr, ProxyDoc } from '../model/types';

/**
 * IP schemes (flat, /31, /30) set on branches, kept per file name in the
 * browser. The proxy file has nowhere to store them, and RollCall doesn't need them.
 */
const KEY = 'rpe.schemes';
type ByFile = Record<string, SchemeMap>;

function load(): ByFile {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as ByFile;
    const out: ByFile = {};
    for (const [f, m] of Object.entries(raw ?? {})) {
      out[f] = Object.fromEntries(Object.entries(m ?? {}).filter(([, s]) => isScheme(s)));
    }
    return out;
  } catch {
    return {};
  }
}

function persist(b: ByFile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage blocked or full */
  }
}

interface SchemeState {
  byFile: ByFile;
  /** Set (or with null, clear) the scheme on a branch. */
  set: (file: string, addr: NetAddr, scheme: Scheme | null) => void;
  remap: (file: string, f: (a: NetAddr) => NetAddr) => void;
  prune: (file: string, doc: ProxyDoc) => void;
  rename: (from: string, to: string) => void;
}

export const useSchemes = create<SchemeState>((set, get) => {
  const update = (file: string, next: SchemeMap) => {
    const cur = get().byFile[file] ?? {};
    if (JSON.stringify(cur) === JSON.stringify(next)) return;
    const byFile = { ...get().byFile };
    if (Object.keys(next).length) byFile[file] = next;
    else delete byFile[file];
    persist(byFile);
    set({ byFile });
  };
  return {
    byFile: load(),
    set: (file, addr, scheme) => {
      const next = { ...(get().byFile[file] ?? {}) };
      if (scheme) next[addr] = scheme;
      else delete next[addr];
      update(file, next);
    },
    remap: (file, f) => update(file, remapSchemes(get().byFile[file] ?? {}, f)),
    prune: (file, doc) => update(file, pruneSchemes(get().byFile[file] ?? {}, doc)),
    rename: (from, to) => {
      if (from === to || !get().byFile[from]) return;
      update(to, { ...get().byFile[from] });
    },
  };
});

const EMPTY: SchemeMap = {};
export function schemesFor(file: string): SchemeMap {
  return useSchemes.getState().byFile[file] ?? EMPTY;
}

/** Hook: the scheme map for the open file. */
export function useFileSchemes(file: string): SchemeMap {
  return useSchemes((s) => s.byFile[file] ?? EMPTY);
}
