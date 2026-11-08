import { create } from 'zustand';
import { isPrefab, type Prefab } from '../model/prefabs';

const KEY = 'rpe.prefabs';

function load(): Prefab[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(list) ? list.filter(isPrefab) : [];
  } catch {
    return [];
  }
}

function persist(list: Prefab[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked or full */
  }
}

interface PrefabState {
  custom: Prefab[];
  save: (p: Prefab) => void;
  remove: (id: string) => void;
  /** Import prefabs from an exported JSON file. Returns how many were added or updated. */
  importJson: (text: string) => number;
  exportJson: (ids?: string[]) => string;
}

export const usePrefabs = create<PrefabState>((set, get) => ({
  custom: load(),

  save: (p) => {
    const rest = get().custom.filter((x) => x.id !== p.id);
    const i = get().custom.findIndex((x) => x.id === p.id);
    const list = [...rest];
    list.splice(i < 0 ? list.length : i, 0, { ...p, builtin: undefined });
    persist(list);
    set({ custom: list });
  },

  remove: (id) => {
    const list = get().custom.filter((x) => x.id !== id);
    persist(list);
    set({ custom: list });
  },

  importJson: (text) => {
    const data = JSON.parse(text) as { prefabs?: unknown[] } | unknown[];
    const items = Array.isArray(data) ? data : data.prefabs;
    if (!Array.isArray(items)) throw new Error('Not a prefab file');
    const good = items.filter(isPrefab);
    if (good.length === 0) throw new Error('No prefabs found in the file');
    let list = [...get().custom];
    for (const p of good) {
      const clean = { ...p, builtin: undefined };
      const i = list.findIndex((x) => x.id === p.id);
      if (i >= 0) list[i] = clean;
      else list.push(clean);
    }
    list = list.filter(isPrefab);
    persist(list);
    set({ custom: list });
    return good.length;
  },

  exportJson: (ids) => {
    const prefabs = get().custom.filter((p) => !ids || ids.includes(p.id));
    return JSON.stringify({ app: 'rollcall-proxy-editor', version: 1, prefabs }, null, 2);
  },
}));

export function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
