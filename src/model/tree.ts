import { compareAddr, parentOf, ROOT } from './address';
import type { NetAddr, ProxyDoc } from './types';

export interface TreeNode {
  addr: NetAddr;
  name: string;
  /** False when the net has no NetNames entry but is needed as a parent or by an IpShare. */
  named: boolean;
  children: TreeNode[];
  /** Indexes into doc.ipShares of devices attached to this net. */
  devices: number[];
}

export interface Tree {
  root: TreeNode;
  byAddr: Map<NetAddr, TreeNode>;
}

export function buildTree(doc: ProxyDoc): Tree {
  const byAddr = new Map<NetAddr, TreeNode>();

  const ensure = (addr: NetAddr): TreeNode => {
    let node = byAddr.get(addr);
    if (node) return node;
    node = { addr, name: '', named: false, children: [], devices: [] };
    byAddr.set(addr, node);
    const parent = parentOf(addr);
    if (parent !== null) ensure(parent).children.push(node);
    return node;
  };

  ensure(ROOT);
  for (const n of doc.netNames) {
    const node = ensure(n.addr);
    if (!node.named) {
      node.name = n.name;
      node.named = true;
    }
  }
  doc.ipShares.forEach((s, i) => ensure(s.net).devices.push(i));

  for (const node of byAddr.values()) node.children.sort((a, b) => compareAddr(a.addr, b.addr));
  return { root: byAddr.get(ROOT)!, byAddr };
}

/** Name to show for a node, with a fallback for unnamed ones. */
export function labelOf(node: TreeNode): string {
  if (node.named && node.name.trim() !== '') return node.name;
  return node.addr === ROOT ? '(root)' : `(unnamed ${node.addr})`;
}
