import { useMemo, useState } from 'react';
import { isValidAddr } from '../../model/address';
import { removeIpShare, updateIpShare } from '../../model/ops';
import { labelOf, type Tree } from '../../model/tree';
import type { IpShare } from '../../model/types';
import { useStore } from '../../state/store';
import { CommitInput } from './CommitInput';
import { checkIp, checkPort } from './DeviceFields';

type Key = 'ip1' | 'port1' | 'ip2' | 'port2' | 'ip3' | 'port3';

export function DevicesTab({ tree }: { tree: Tree }) {
  const shares = useStore((s) => s.doc.ipShares);
  const selected = useStore((s) => s.selected);
  const { apply, select } = useStore.getState();
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return shares
      .map((s, i) => ({ s, i, name: tree.byAddr.get(s.net) ? labelOf(tree.byAddr.get(s.net)!) : '' }))
      .filter(({ s, name }) => !f || [s.net, name, s.ip1, s.ip2, s.ip3].some((x) => x.toLowerCase().includes(f)));
  }, [shares, tree, filter]);

  const set = (i: number, patch: Partial<IpShare>) => apply((d) => updateIpShare(d, i, patch));
  const cell = (s: IpShare, i: number, k: Key) => (
    <CommitInput
      className={k.startsWith('ip') ? 'ip' : 'port'}
      value={s[k]}
      check={k.startsWith('ip') ? checkIp(k !== 'ip1') : checkPort}
      onCommit={(v) => set(i, { [k]: v.trim() || (k.startsWith('ip') && k !== 'ip1' ? '-' : v) })}
      aria-label={`IpShare${i} ${k}`}
    />
  );

  return (
    <div className="devices-tab">
      <div className="tree-tools">
        <input type="search" placeholder="Filter by net, name or IP…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter devices" />
        <span className="muted small">{rows.length} of {shares.length}</span>
      </div>
      <div className="table-wrap">
        <table className="devices">
          <thead>
            <tr>
              <th>#</th>
              <th>Net</th>
              <th>Name</th>
              <th>Address 1</th>
              <th>Port</th>
              <th>Address 2</th>
              <th>Port</th>
              <th>Address 3</th>
              <th>Port</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, i, name }) => (
              <tr key={i} className={selected === s.net ? 'selected' : ''} onFocus={() => select(s.net, 'editor')} onClick={() => select(s.net, 'editor')}>
                <td className="muted mono">{i}</td>
                <td>
                  <CommitInput
                    className="mono addr-input"
                    value={s.net}
                    maxLength={4}
                    check={(v) => (isValidAddr(v.trim()) ? null : 'Must be 4 hex digits')}
                    onCommit={(v) => isValidAddr(v.trim()) && set(i, { net: v.trim() })}
                    aria-label={`IpShare${i} net`}
                  />
                </td>
                <td className={name ? '' : 'muted'}>{name || '(no name)'}</td>
                <td>{cell(s, i, 'ip1')}</td>
                <td>{cell(s, i, 'port1')}</td>
                <td>{cell(s, i, 'ip2')}</td>
                <td>{cell(s, i, 'port2')}</td>
                <td>{cell(s, i, 'ip3')}</td>
                <td>{cell(s, i, 'port3')}</td>
                <td>
                  <button className="small danger" title="Remove this device" onClick={() => apply((d) => removeIpShare(d, i))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shares.length === 0 && <p className="empty">No devices yet. Select a net in the Tree tab and click “+ Add device”.</p>}
      </div>
    </div>
  );
}
