import { create } from 'zustand';
import { depthOf, MAX_DEPTH, ROOT } from '../model/address';
import { applyOutline, parseOutline } from '../model/bulk';
import { schemeFor, suggestDevice } from '../model/ipscheme';
import { addChild, addIpShare, OpError } from '../model/ops';
import { BUILTIN_PREFABS, checkParam, defaultValues, renderPrefab, type Prefab } from '../model/prefabs';
import { TemplateError, type Vars } from '../model/template';
import type { NetAddr } from '../model/types';
import { usePrefabs } from './prefabs';
import { schemesFor } from './schemes';
import { useStore } from './store';

/**
 * Toolbox items. "folder" and "device" are added straight away. The others open
 * a dialog aimed at the net they were dropped on, unless a preset (from a choice
 * chip such as Media / Control) fills in everything the prefab needs.
 */
export type ToolId = 'folder' | 'device' | 'bulk' | 'outline' | `prefab:${string}`;

/** The tool currently being dragged out of the toolbox (null when not dragging). */
export const useToolDrag = create<{ tool: ToolId | null; preset?: Vars; set: (t: ToolId | null, preset?: Vars) => void }>((set) => ({
  tool: null,
  preset: undefined,
  set: (tool, preset) => set({ tool, preset }),
}));

export type DialogRequest =
  | { kind: 'bulk'; parent: NetAddr }
  | { kind: 'outline'; parent: NetAddr; prefabId?: string; values?: Vars };

/** Dialogs opened from the toolbox, shown by <ToolDialogHost/>. */
export const useToolDialog = create<{ open: DialogRequest | null; show: (r: DialogRequest | null) => void }>((set) => ({
  open: null,
  show: (open) => set({ open }),
}));

/** Net whose name field should grab focus the next time it's shown (after "Folder"/"Device"). */
export const useFocusName = create<{ addr: NetAddr | null; set: (a: NetAddr | null) => void }>((set) => ({
  addr: null,
  set: (addr) => set({ addr }),
}));

export function canHoldChildren(addr: NetAddr): boolean {
  return depthOf(addr) < MAX_DEPTH;
}

export function findPrefab(id: string): Prefab | undefined {
  return [...BUILTIN_PREFABS, ...usePrefabs.getState().custom].find((p) => p.id === id);
}

/** A prefab can be added without its dialog when every setting is a choice that the preset answers. */
export function isQuickAdd(p: Prefab, preset?: Vars): boolean {
  return !!preset && p.params.length > 0 && p.params.every((x) => x.type === 'choice' && checkParam(x, preset[x.key] ?? x.default) === null);
}

/** Render a prefab and add it under `parent` in one undo step. */
function quickAdd(p: Prefab, parent: NetAddr, preset: Vars) {
  const st = useStore.getState();
  let text: string;
  try {
    text = renderPrefab(p, { ...defaultValues(p), ...preset });
  } catch (e) {
    if (e instanceof TemplateError) return st.showToast(`${p.name}: ${e.message}`);
    throw e;
  }
  const { rows, errors } = parseOutline(text);
  if (errors.length) return st.showToast(`${p.name}: line ${errors[0].line + 1}: ${errors[0].message}`);
  let plan: ReturnType<typeof applyOutline>['plan'] = [];
  const ok = st.apply((d) => {
    const r = applyOutline(d, parent, rows, { defaultPort: '2050', merge: true });
    plan = r.plan;
    return r.doc;
  });
  if (!ok) return;
  const nets = plan.filter((x) => x.status === 'new').length;
  const devices = plan.filter((x) => x.device?.status === 'new').length;
  const label = Object.values(preset).join(' ');
  if (nets + devices === 0) {
    st.showToast(`${p.name} ${label} is already there; nothing added.`, 'info');
    return;
  }
  const first = plan.find((x) => x.status === 'new') ?? plan[0];
  if (first) st.select(first.addr, 'editor');
  st.showToast(`Added ${p.name} ${label}: ${nets} net${nets === 1 ? '' : 's'}, ${devices} device${devices === 1 ? '' : 's'}. Ctrl+Z to undo.`, 'info');
}

/** Run a toolbox item against a target net (the drop target, or the selected net when clicked). */
export function runTool(tool: ToolId, target: NetAddr | null, preset?: Vars) {
  const st = useStore.getState();
  const parent = target ?? ROOT;
  if (!canHoldChildren(parent)) {
    st.showToast(`${parent} is at the deepest level (4) and can't hold anything. Drop onto its parent instead.`);
    return;
  }

  if (tool === 'folder' || tool === 'device') {
    let added: NetAddr | null = null;
    const ok = st.apply((d) => {
      const r = addChild(d, parent, tool === 'folder' ? 'New folder' : 'New device');
      added = r.addr;
      if (tool === 'folder') return r.doc;
      const scheme = schemeFor(schemesFor(st.fileName), r.addr);
      return addIpShare(r.doc, r.addr, suggestDevice(r.doc, r.addr, scheme) ?? {});
    });
    if (ok && added) {
      useFocusName.getState().set(added);
      st.select(added, 'editor');
    }
    return;
  }

  if (tool === 'bulk') return useToolDialog.getState().show({ kind: 'bulk', parent });
  if (tool === 'outline') return useToolDialog.getState().show({ kind: 'outline', parent });

  const id = tool.slice('prefab:'.length);
  const p = findPrefab(id);
  if (p && isQuickAdd(p, preset)) {
    try {
      quickAdd(p, parent, preset!);
    } catch (e) {
      if (e instanceof OpError) st.showToast(e.message);
      else throw e;
    }
    return;
  }
  useToolDialog.getState().show({ kind: 'outline', parent, prefabId: id, values: preset });
}
