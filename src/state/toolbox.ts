import { create } from 'zustand';
import { depthOf, MAX_DEPTH, ROOT } from '../model/address';
import { schemeFor, suggestDevice } from '../model/ipscheme';
import { addChild, addIpShare } from '../model/ops';
import type { NetAddr } from '../model/types';
import { schemesFor } from './schemes';
import { useStore } from './store';

/**
 * Toolbox items. "folder" and "device" are added straight away. The others open
 * a dialog aimed at the net they were dropped on.
 */
export type ToolId = 'folder' | 'device' | 'bulk' | 'outline' | `prefab:${string}`;

/** The tool currently being dragged out of the toolbox (null when not dragging). */
export const useToolDrag = create<{ tool: ToolId | null; set: (t: ToolId | null) => void }>((set) => ({
  tool: null,
  set: (tool) => set({ tool }),
}));

export type DialogRequest = { kind: 'bulk'; parent: NetAddr } | { kind: 'outline'; parent: NetAddr; prefabId?: string };

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

/** Run a toolbox item against a target net (the drop target, or the selected net when clicked). */
export function runTool(tool: ToolId, target: NetAddr | null) {
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

  if (tool === 'bulk') useToolDialog.getState().show({ kind: 'bulk', parent });
  else if (tool === 'outline') useToolDialog.getState().show({ kind: 'outline', parent });
  else useToolDialog.getState().show({ kind: 'outline', parent, prefabId: tool.slice('prefab:'.length) });
}
