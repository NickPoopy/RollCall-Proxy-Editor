import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { childDigit, depthOf, displayAddr, inSubtree, MAX_DEPTH, parentOf, ROOT } from '../../model/address';
import { moveNet } from '../../model/ops';
import { labelOf, type Tree, type TreeNode } from '../../model/tree';
import type { NetAddr } from '../../model/types';
import { useStore } from '../../state/store';

interface Props {
  tree: Tree;
  filter: string;
}

type Zone = 'before' | 'into' | 'after';
interface DropHint {
  addr: NetAddr;
  zone: Zone;
}

interface DragCtx {
  dragging: NetAddr | null;
  hint: DropHint | null;
  setDragging: (a: NetAddr | null) => void;
  setHint: (h: DropHint | null) => void;
  expand: (a: NetAddr) => void;
}
const Drag = createContext<DragCtx | null>(null);

/** Where a drop on `target` in `zone` would put the dragged net: parent and slot (undefined = next free). */
function dropTarget(src: NetAddr, target: NetAddr, zone: Zone): { parent: NetAddr; slot?: number } | null {
  if (target === src) return null;
  if (zone === 'into') {
    if (inSubtree(target, src) || depthOf(target) >= MAX_DEPTH) return null;
    return { parent: target };
  }
  const parent = parentOf(target);
  if (parent === null || inSubtree(parent, src)) return null;
  const t = childDigit(target);
  const sameParentAndBefore = parentOf(src) === parent && childDigit(src) < t;
  // Within the same parent, moving down shifts the siblings in between up by one.
  const slot = zone === 'before' ? (sameParentAndBefore ? t - 1 : t) : sameParentAndBefore ? t : t + 1;
  return { parent, slot };
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
  const drag = useContext(Drag)!;
  const ref = useRef<HTMLDivElement>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (selected && useStore.getState().selectOrigin !== 'editor') ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (visible && !visible.has(node.addr)) return null;
  const open = visible ? true : !collapsed.has(node.addr);
  const hasKids = node.children.length > 0;
  const sev = issueAddrs.get(node.addr);
  const isRoot = node.addr === ROOT;
  const hint = drag.hint?.addr === node.addr ? drag.hint.zone : null;
  const isDragged = drag.dragging !== null && inSubtree(node.addr, drag.dragging);

  const zoneAt = (e: React.DragEvent): Zone => {
    if (isRoot) return 'into';
    const r = ref.current!.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const canInto = depthOf(node.addr) < MAX_DEPTH;
    if (!canInto) return y < 0.5 ? 'before' : 'after';
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into';
  };

  return (
    <>
      <div
        ref={ref}
        className={`nt-row${selected ? ' selected' : ''}${node.named ? '' : ' unnamed'}${hint ? ` drop-${hint}` : ''}${isDragged ? ' dragging' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => useStore.getState().select(node.addr, 'editor')}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasKids ? open : undefined}
        draggable={!isRoot}
        title={isRoot ? undefined : 'Drag onto a net to move it inside, or onto the top/bottom edge of a row to place it before/after'}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.addr);
          drag.setDragging(node.addr);
          useStore.getState().select(node.addr, 'editor');
        }}
        onDragEnd={() => {
          drag.setDragging(null);
          drag.setHint(null);
        }}
        onDragOver={(e) => {
          const src = drag.dragging;
          if (!src) return;
          const zone = zoneAt(e);
          if (!dropTarget(src, node.addr, zone)) {
            if (hint) drag.setHint(null);
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (hint !== zone) drag.setHint({ addr: node.addr, zone });
          // Hovering in the middle of a collapsed net opens it.
          if (zone === 'into' && hasKids && !open && !expandTimer.current) {
            expandTimer.current = setTimeout(() => {
              drag.expand(node.addr);
              expandTimer.current = undefined;
            }, 650);
          }
        }}
        onDragLeave={() => {
          clearTimeout(expandTimer.current);
          expandTimer.current = undefined;
        }}
        onDrop={(e) => {
          e.preventDefault();
          clearTimeout(expandTimer.current);
          expandTimer.current = undefined;
          const src = drag.dragging;
          drag.setDragging(null);
          drag.setHint(null);
          if (!src) return;
          const t = dropTarget(src, node.addr, zoneAt(e));
          if (!t) return;
          const st = useStore.getState();
          let result: { addr: NetAddr; shifted: number } | null = null;
          const ok = st.apply((d) => {
            const r = moveNet(d, src, t.parent, t.slot);
            result = r;
            return r.doc;
          });
          const r = result as { addr: NetAddr; shifted: number } | null;
          if (ok && r && r.addr !== src) {
            st.select(r.addr, 'editor');
            if (t.slot === undefined) drag.expand(t.parent);
            const extra = r.shifted ? `; ${r.shifted} sibling${r.shifted > 1 ? 's' : ''} shifted one slot` : '';
            st.showToast(`Moved to ${r.addr} (shows as ${displayAddr(r.addr)})${extra}. Undo with Ctrl+Z.`, 'info');
          }
        }}
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
        {!isRoot && <span className="nt-grip" aria-hidden="true">⋮⋮</span>}
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
  const [dragging, setDragging] = useState<NetAddr | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
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

  const ctx = useMemo<DragCtx>(
    () => ({
      dragging,
      hint,
      setDragging,
      setHint,
      expand: (a) =>
        setCollapsed((prev) => {
          if (!prev.has(a)) return prev;
          const next = new Set(prev);
          next.delete(a);
          return next;
        }),
    }),
    [dragging, hint],
  );

  return (
    <Drag.Provider value={ctx}>
      <div
        className={`node-tree${dragging ? ' is-dragging' : ''}`}
        role="tree"
        onDragLeave={(e) => e.currentTarget === e.target && setHint(null)}
        onDragOver={(e) => {
          // Scroll when dragging near the top or bottom edge.
          if (!dragging) return;
          const el = e.currentTarget;
          const r = el.getBoundingClientRect();
          const edge = 40;
          if (e.clientY < r.top + edge) el.scrollTop -= Math.ceil((r.top + edge - e.clientY) / 3);
          else if (e.clientY > r.bottom - edge) el.scrollTop += Math.ceil((e.clientY - (r.bottom - edge)) / 3);
        }}
      >
        <Item node={tree.root} depth={0} collapsed={collapsed} toggle={toggle} visible={visible} issueAddrs={issueAddrs} />
        {visible && visible.size === 1 && <p className="empty">No nets match “{filter}”.</p>}
      </div>
    </Drag.Provider>
  );
}
