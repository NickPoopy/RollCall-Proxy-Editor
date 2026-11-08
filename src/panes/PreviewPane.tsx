import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { displayAddr, parentOf } from '../model/address';
import { buildTree, labelOf, type TreeNode } from '../model/tree';
import type { IpShare, NetAddr } from '../model/types';
import { useStore } from '../state/store';

function GlobeIcon() {
  return (
    <svg className="rc-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.6" fill="url(#rcg)" stroke="#1d5a3a" strokeWidth="0.8" />
      <path d="M1.6 8h12.8M8 1.4c-2.6 2.8-2.6 10.4 0 13.2M8 1.4c2.6 2.8 2.6 10.4 0 13.2M2.6 4.8h10.8M2.6 11.2h10.8" stroke="#d8f0ff" strokeWidth="0.7" fill="none" opacity="0.85" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg className="rc-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="4" width="13" height="8" rx="1" fill="#2b5fb4" stroke="#9cc0ff" strokeWidth="0.8" />
      <rect x="3" y="6" width="5" height="1.4" fill="#cfe0ff" />
      <circle cx="12" cy="8" r="1" fill="#7cff8a" />
    </svg>
  );
}

function deviceTitle(s: IpShare): string {
  const pairs = [
    [s.ip1, s.port1],
    [s.ip2, s.port2],
    [s.ip3, s.port3],
  ]
    .map(([ip, port], i) => `Address ${i + 1}: ${ip === '-' ? '(unused)' : `${ip}:${port}`}`)
    .join('\n');
  return `${pairs}\n\nThe real device name, address and version come from the device itself once RollCall connects.`;
}

interface RowProps {
  node: TreeNode;
  expanded: Set<NetAddr>;
  toggle: (a: NetAddr) => void;
}

const Row = memo(function Row({ node, expanded, toggle }: RowProps) {
  const selected = useStore((s) => s.selected === node.addr);
  const version = useStore((s) => s.proxyVersion);
  const shares = useStore((s) => s.doc.ipShares);
  const rowRef = useRef<HTMLDivElement>(null);
  const hasKids = node.children.length > 0 || node.devices.length > 0;
  const open = expanded.has(node.addr);

  useEffect(() => {
    if (selected && useStore.getState().selectOrigin !== 'preview') rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <li>
      <div
        ref={rowRef}
        className={`rc-row${selected ? ' rc-selected' : ''}${node.named ? '' : ' rc-unnamed'}`}
        onClick={() => useStore.getState().select(node.addr, 'preview')}
        onDoubleClick={() => hasKids && toggle(node.addr)}
      >
        <span
          className={`rc-toggle${hasKids ? '' : ' rc-toggle-none'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hasKids) toggle(node.addr);
          }}
        >
          {hasKids ? (open ? '▾' : '▸') : ''}
        </span>
        <GlobeIcon />
        <span className="rc-label">
          {labelOf(node)} {displayAddr(node.addr)} ({version})
        </span>
      </div>
      {hasKids && open && (
        <ul>
          {node.devices.map((i) => (
            <li key={`d${i}`}>
              <div className="rc-row rc-device" title={deviceTitle(shares[i])} onClick={() => useStore.getState().select(node.addr, 'preview')}>
                <span className="rc-toggle rc-toggle-none" />
                <DeviceIcon />
                <span className="rc-label">
                  Device @ {shares[i].ip1} {node.addr}:??:00
                </span>
              </div>
            </li>
          ))}
          {node.children.map((c) => (
            <Row key={c.addr} node={c} expanded={expanded} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
});

export function PreviewPane() {
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selected);
  const version = useStore((s) => s.proxyVersion);
  const tree = useMemo(() => buildTree(doc), [doc]);
  const [expanded, setExpanded] = useState<Set<NetAddr>>(() => new Set(['0000']));

  // Reveal the selected node by expanding its ancestors.
  useEffect(() => {
    if (!selected) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let p = parentOf(selected);
      let changed = false;
      while (p !== null) {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
        p = parentOf(p);
      }
      return changed ? next : prev;
    });
  }, [selected]);

  const toggle = (a: NetAddr) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });

  const expandAll = () => setExpanded(new Set(tree.byAddr.keys()));
  const collapseAll = () => setExpanded(new Set());

  return (
    <section className="pane">
      <div className="pane-header">
        <h2>RollCall preview</h2>
        <div className="pane-actions">
          <button className="small" onClick={expandAll}>Expand all</button>
          <button className="small" onClick={collapseAll}>Collapse</button>
        </div>
      </div>
      <div className="pane-body rc-tree">
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <radialGradient id="rcg" cx="0.35" cy="0.35" r="0.75">
              <stop offset="0" stopColor="#9be3b0" />
              <stop offset="0.55" stopColor="#2f9a5e" />
              <stop offset="1" stopColor="#1f5fa8" />
            </radialGradient>
          </defs>
        </svg>
        {tree.root.children.length === 0 ? (
          <p className="empty">Nothing to show yet. Add nets in the editor, or paste a proxy file on the left.</p>
        ) : (
          <ul className="rc-root">
            {tree.root.children.map((c) => (
              <Row key={c.addr} node={c} expanded={expanded} toggle={toggle} />
            ))}
          </ul>
        )}
      </div>
      <div className="pane-footer muted">
        {tree.root.named ? `Network: ${tree.root.name} · ` : ''}Proxy version shown as ({version}). Change it in Settings.
      </div>
    </section>
  );
}
