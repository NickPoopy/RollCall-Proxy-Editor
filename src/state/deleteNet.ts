import { parentOf, ROOT } from '../model/address';
import { removeSubtree } from '../model/ops';
import { buildTree, labelOf, type TreeNode } from '../model/tree';
import type { NetAddr } from '../model/types';
import { useStore } from './store';

export function countSubtree(node: TreeNode): { nets: number; devices: number } {
  let nets = node.named ? 1 : 0;
  let devices = node.devices.length;
  for (const c of node.children) {
    const r = countSubtree(c);
    nets += r.nets;
    devices += r.devices;
  }
  return { nets, devices };
}

/**
 * Delete a net and everything under it, then select its next sibling (or the
 * previous one, or the parent) so Delete can be pressed again to keep going.
 * `confirm: 'always'` asks every time (the Delete button); `'branch'` only asks
 * when more than the net itself and one device would go (the Delete key).
 */
export function deleteNet(addr: NetAddr, confirm: 'always' | 'branch'): boolean {
  const st = useStore.getState();
  if (addr === ROOT) {
    st.showToast("The top-level net (0000) can't be deleted.");
    return false;
  }
  const tree = buildTree(st.doc);
  const node = tree.byAddr.get(addr);
  if (!node) return false;
  const size = countSubtree(node);
  const big = size.nets + size.devices > 2 || node.children.length > 0;
  const what = big
    ? `"${labelOf(node)}" and everything under it (${size.nets} net(s), ${size.devices} device(s))`
    : `"${labelOf(node)}"`;
  if ((confirm === 'always' || big) && !window.confirm(`Delete ${what}?`)) return false;

  const parent = parentOf(addr) ?? ROOT;
  const siblings = tree.byAddr.get(parent)?.children ?? [];
  const i = siblings.findIndex((c) => c.addr === addr);
  const next = siblings[i + 1]?.addr ?? siblings[i - 1]?.addr ?? (parent === ROOT ? null : parent);

  if (!st.apply((d) => removeSubtree(d, addr))) return false;
  st.select(next, 'editor');
  st.showToast(`Deleted ${what}. Ctrl+Z to undo.`, 'info');
  return true;
}
