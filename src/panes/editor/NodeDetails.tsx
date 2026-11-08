import { useMemo, useState } from 'react';
import { childDigit, depthOf, displayAddr, inSubtree, isValidAddr, MAX_DEPTH, ROOT } from '../../model/address';
import { addChild, addIpShare, moveSubtree, rebaseAddr, removeIpShare, removeSubtree, setNetName, shiftNet, updateIpShare } from '../../model/ops';
import { SCHEME_LABEL, SCHEMES, schemeFor, schemeSource, suggestDevice, type Scheme } from '../../model/ipscheme';
import { useFileSchemes, useSchemes } from '../../state/schemes';
import { labelOf, type TreeNode } from '../../model/tree';
import { useStore } from '../../state/store';
import { BulkAddDialog } from './BulkAddDialog';
import { CommitInput } from './CommitInput';
import { DeviceFields } from './DeviceFields';
import { DuplicateDialog } from './DuplicateDialog';
import { OutlineDialog } from './OutlineDialog';
import { PrefabEditor } from './PrefabEditor';
import { prefabFromBranch, type Prefab } from '../../model/prefabs';

export function NodeDetails({ node }: { node: TreeNode }) {
  const { apply, select } = useStore.getState();
  const shares = useStore((s) => s.doc.ipShares);
  const allIssues = useStore((s) => s.issues);
  const issues = useMemo(() => allIssues.filter((i) => i.addr === node.addr), [allIssues, node.addr]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [prefabDraft, setPrefabDraft] = useState<Prefab | null>(null);
  const isRoot = node.addr === ROOT;
  const canHaveChildren = depthOf(node.addr) < MAX_DEPTH;
  const subtreeSize = countSubtree(node);
  const fileName = useStore((s) => s.fileName);
  const netNames = useStore((s) => s.doc.netNames);
  const schemes = useFileSchemes(fileName);
  const scheme = schemeFor(schemes, node.addr);
  const explicit = schemes[node.addr] ?? '';
  const source = schemeSource(schemes, node.addr);
  const sourceName = source ? (netNames.find((n) => n.addr === source)?.name ?? source) : '';

  const onAddDevice = () => {
    const doc = useStore.getState().doc;
    apply((d) => addIpShare(d, node.addr, suggestDevice(doc, node.addr, scheme) ?? {}));
  };

  const onAddChild = () => {
    let added: string | null = null;
    const ok = apply((d) => {
      const r = addChild(d, node.addr, 'New net');
      added = r.addr;
      return r.doc;
    });
    if (ok && added) select(added, 'editor');
  };

  const onShift = (dir: -1 | 1) => {
    let to: string | null = null;
    if (apply((d) => {
      const r = shiftNet(d, node.addr, dir);
      to = r.addr;
      return r.doc;
    }) && to) select(to, 'editor');
  };

  const onDelete = () => {
    const what =
      subtreeSize.nets + subtreeSize.devices > 1
        ? `"${labelOf(node)}" and everything under it (${subtreeSize.nets} net(s), ${subtreeSize.devices} device(s))`
        : `"${labelOf(node)}"`;
    if (!window.confirm(`Delete ${what}?`)) return;
    if (apply((d) => removeSubtree(d, node.addr))) select(null, 'editor');
  };

  return (
    <div className="details">
      <div className="details-head">
        <div>
          <div className="details-title">{labelOf(node)}</div>
          <div className="muted mono small">
            Net {node.addr}
            {!isRoot && <> · RollCall shows {displayAddr(node.addr)} · slot {childDigit(node.addr).toString(16).toUpperCase()}</>}
          </div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="nd-name">{isRoot ? 'Network / system name (0000)' : 'Name'}</label>
        <CommitInput id="nd-name" value={node.named ? node.name : ''} placeholder="Name shown in RollCall" onCommit={(v) => apply((d) => setNetName(d, node.addr, v))} />
      </div>

      {!isRoot && (
        <div className="field">
          <label htmlFor="nd-addr">Address</label>
          <CommitInput
            id="nd-addr"
            className="mono addr-input"
            value={node.addr}
            maxLength={4}
            check={(v) => (isValidAddr(v.trim()) ? null : 'Must be 4 hex digits, e.g. 1210')}
            onCommit={(v) => {
              const to = v.trim().toUpperCase();
              if (isValidAddr(to) && apply((d) => moveSubtree(d, node.addr, to))) {
                const from = node.addr;
                useSchemes.getState().remap(fileName, (a) => (inSubtree(a, from) ? rebaseAddr(a, from, to) : a));
                select(to, 'editor');
              }
            }}
            title="Change to move this net and everything under it"
          />
          <span className="hint">Changing this moves the net and everything under it.</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="nd-scheme">IP scheme</label>
        <select
          id="nd-scheme"
          value={explicit}
          onChange={(e) => useSchemes.getState().set(fileName, node.addr, (e.target.value || null) as Scheme | null)}
        >
          <option value="">
            {source && source !== node.addr ? `Inherit: ${scheme} from “${sourceName}”` : isRoot ? 'Default: flat' : `Inherit: ${scheme}`}
          </option>
          {SCHEMES.map((s) => (
            <option key={s} value={s}>
              {SCHEME_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="hint">
          {scheme === 'flat' ? 'Devices step by one address.' : `Each device gets its own ${scheme}: tools step by whole subnets, and Issues checks host positions.`}
          {isRoot ? ' Applies to the whole file unless a branch overrides it.' : ' Applies to everything under this net.'}
        </span>
      </div>

      <div className="button-row">
        {canHaveChildren && <button onClick={onAddChild}>+ Child</button>}
        {canHaveChildren && <button onClick={() => setBulkOpen(true)}>+ Several children…</button>}
        {canHaveChildren && (
          <button onClick={() => setOutlineOpen(true)} title="Add prefabs (IQ frames, multiviewers…), paste from Excel, or type an outline">
            Toolbox…
          </button>
        )}
        {!isRoot && (
          <>
            <button onClick={() => setDupOpen(true)} title="Copy this net, everything under it and its devices, with shifted IPs">Duplicate…</button>
            <button onClick={() => setPrefabDraft(prefabFromBranch(useStore.getState().doc, node.addr, '2050', scheme))} title="Save this branch as a reusable prefab in the Toolbox">
              Save as prefab…
            </button>
            <button onClick={() => onShift(-1)} title="Move up one slot (swaps with the sibling there)">↑</button>
            <button onClick={() => onShift(1)} title="Move down one slot (swaps with the sibling there)">↓</button>
            <button className="danger" onClick={onDelete}>Delete</button>
          </>
        )}
      </div>

      {!isRoot && (
        <div className="details-section">
          <div className="section-title">
            Devices (IpShare)
            <button className="small" onClick={onAddDevice} title="Suggests the next free address in this branch">+ Add device</button>
          </div>
          {node.devices.length === 0 && <p className="muted small">No device attached. Leaf nets usually get one IpShare that points at the device's IP.</p>}
          {node.devices.map((i) => (
            <div className="device-card" key={i}>
              <div className="device-card-head">
                <span className="mono small muted">IpShare{i}</span>
                <button className="small danger" onClick={() => apply((d) => removeIpShare(d, i))}>Remove</button>
              </div>
              <DeviceFields share={shares[i]} scheme={scheme} onChange={(k, v) => apply((d) => updateIpShare(d, i, { [k]: v }))} />
            </div>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <ul className="issue-list compact">
          {issues.map((i, k) => (
            <li key={k} className={`sev-${i.severity}`}>{i.message}</li>
          ))}
        </ul>
      )}

      {bulkOpen && <BulkAddDialog parent={node.addr} parentName={labelOf(node)} scheme={scheme} onClose={() => setBulkOpen(false)} />}
      {outlineOpen && <OutlineDialog parent={node.addr} parentName={labelOf(node)} scheme={scheme} onClose={() => setOutlineOpen(false)} />}
      {dupOpen && (
        <DuplicateDialog src={node.addr} srcName={labelOf(node)} scheme={scheme} explicitScheme={schemes[node.addr]} onClose={() => setDupOpen(false)} />
      )}
      {prefabDraft && <PrefabEditor initial={prefabDraft} onClose={() => setPrefabDraft(null)} />}
    </div>
  );
}

function countSubtree(node: TreeNode): { nets: number; devices: number } {
  let nets = node.named ? 1 : 0;
  let devices = node.devices.length;
  for (const c of node.children) {
    const r = countSubtree(c);
    nets += r.nets;
    devices += r.devices;
  }
  return { nets, devices };
}
