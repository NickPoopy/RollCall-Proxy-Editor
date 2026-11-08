import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { inSubtree, parentOf, ROOT } from '../../model/address';
import { labelOf, type Tree, type TreeNode } from '../../model/tree';
import type { NetAddr } from '../../model/types';
import { useStore } from '../../state/store';

interface Props {
  tree: Tree;
  filter: string;
}

function matches(node: TreeNode, f: string): boolean {
  return labelOf(node).toLowerCase().includes(f) || node.addr.toLowerCase().includes(f);
}

const Item = memo(function Item({
  node,
  depth,
  collapsed,
  toggle,
  visible,
  issueAddrs,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Set<NetAddr>;
  toggle: (a: NetAddr) => void;
  visible: Set<NetAddr> | null;
  issueAddrs: Map<NetAddr, 'error' | 'warning'>;
}) {
  const selected = useStore((s) => s.selected === node.addr);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && useStore.getState().selectOrigin !== 'editor') ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (visible && !visible.has(node.addr)) return null;
  const open = visible ? true : !collapsed.has(node.addr);
  const hasKids = node.children.length > 0;
  const sev = issueAddrs.get(node.addr);

  return (
    <>
      <div
        ref={ref}
        className={`nt-row${selected ? ' selected' : ''}${node.named ? '' : ' unnamed'}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => useStore.getState().select(node.addr, 'editor')}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasKids ? open : undefined}
      >
        <span
          className="nt-toggle"
          onClick={(e) => {
            e.stopPropagation();
            if (hasKids) toggle(node.addr);
          }}
        >
          {hasKids ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="nt-name">{labelOf(node)}</span>
        {sev && <span className={`nt-dot sev-${sev}`} title={`Has ${sev}s. See the Issues tab.`}>●</span>}
        {node.devices.length > 0 && (
          <span className="nt-dev" title={`${node.devices.length} device(s)`}>
            ⧉{node.devices.length > 1 ? node.devices.length : ''}
          </span>
        )}
        <span className="nt-addr">{node.addr}</span>
      </div>
      {open &&
        node.children.map((c) => (
          <Item key={c.addr} node={c} depth={depth + 1} collapsed={collapsed} toggle={toggle} visible={visible} issueAddrs={issueAddrs} />
        ))}
    </>
  );
});

export function NodeTree({ tree, filter }: Props) {
  const [collapsed, setCollapsed] = useState<Set<NetAddr>>(new Set());
  const selected = useStore((s) => s.selected);
  const issues = useStore((s) => s.issues);

  const issueAddrs = useMemo(() => {
    const m = new Map<NetAddr, 'error' | 'warning'>();
    for (const i of issues) {
      if (!i.addr || i.severity === 'info') continue;
      if (m.get(i.addr) !== 'error') m.set(i.addr, i.severity as 'error' | 'warning');
    }
    return m;
  }, [issues]);

  // With a filter, show matches plus their ancestors.
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return null;
    const v = new Set<NetAddr>([ROOT]);
    for (const node of tree.byAddr.values()) {
      if (!matches(node, f)) continue;
      for (let a: NetAddr | null = node.addr; a !== null; a = parentOf(a)) v.add(a);
    }
    return v;
  }, [filter, tree]);

  // Expand ancestors of a node selected elsewhere.
  useEffect(() => {
    if (!selected) return;
    setCollapsed((prev) => {
      const hidden = [...prev].filter((a) => a !== selected && inSubtree(selected, a));
      if (hidden.length === 0) return prev;
      const next = new Set(prev);
      hidden.forEach((a) => next.delete(a));
      return next;
    });
  }, [selected]);

  const toggle = (a: NetAddr) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });

  return (
    <div className="node-tree" role="tree">
      <Item node={tree.root} depth={0} collapsed={collapsed} toggle={toggle} visible={visible} issueAddrs={issueAddrs} />
      {visible && visible.size === 1 && <p className="empty">No nets match “{filter}”.</p>}
    </div>
  );
}
