import { useState } from 'react';
import { childAddr, depthOf, inSubtree, MAX_DEPTH } from '../../model/address';
import { bulkAddChildren, formatPattern, incrementIp } from '../../model/ops';
import { isValidIp, isValidPort } from '../../model/validate';
import type { NetAddr } from '../../model/types';
import { useStore } from '../../state/store';

export function BulkAddDialog({ parent, parentName, onClose }: { parent: NetAddr; parentName: string; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const [count, setCount] = useState(4);
  const [pattern, setPattern] = useState('Item {n:2}');
  const [start, setStart] = useState(1);
  const [withDevice, setWithDevice] = useState(true);
  const [ip1, setIp1] = useState('10.0.0.10');
  const [ip2, setIp2] = useState('-');
  const [ip3, setIp3] = useState('-');
  const [port, setPort] = useState('2050');
  const [step, setStep] = useState(1);

  const used = [...doc.netNames.map((n) => n.addr), ...doc.ipShares.map((s) => s.net)];
  const free: NetAddr[] = [];
  if (depthOf(parent) < MAX_DEPTH) {
    for (let d = 1; d <= 15; d++) {
      const a = childAddr(parent, d)!;
      if (!used.some((u) => inSubtree(u, a))) free.push(a);
    }
  }

  const ipOk = (v: string, opt: boolean) => (opt && v === '-') || isValidIp(v);
  const errors: string[] = [];
  if (!(count >= 1)) errors.push('Count must be at least 1.');
  if (count > free.length) errors.push(`Only ${free.length} free slot(s) under ${parent}. A net can have at most 15 children.`);
  if (withDevice) {
    if (!ipOk(ip1, false)) errors.push('Address 1 must be an IPv4 address.');
    if (!ipOk(ip2, true) || !ipOk(ip3, true)) errors.push('Addresses 2 and 3 must be IPv4 addresses or "-".');
    if (!isValidPort(port)) errors.push('Port must be 1–65535.');
  }

  const previewRows = free.slice(0, Math.max(0, Math.min(count, free.length))).map((a, k) => ({
    addr: a,
    name: formatPattern(pattern, start + k, parseInt(a[depthOf(parent)], 16)),
    ip: withDevice ? incrementIp(ip1, k * step) : '',
  }));

  const submit = () => {
    if (errors.length) return;
    const ok = useStore.getState().apply(
      (d) =>
        bulkAddChildren(d, parent, {
          count,
          namePattern: pattern,
          startNumber: start,
          device: withDevice ? { ip1, port1: port, ip2, port2: port, ip3, port3: port, step } : undefined,
        }).doc,
    );
    if (ok) onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="bulk-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3 id="bulk-title">Add children to {parentName} <span className="mono muted">({parent})</span></h3>
        <div className="form-grid">
          <label htmlFor="b-count">How many</label>
          <input id="b-count" type="number" min={1} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} autoFocus />
          <label htmlFor="b-pattern">Name pattern</label>
          <div>
            <input id="b-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} />
            <div className="hint">{'{n}'} = number, {'{n:2}'} = zero-padded to 2 digits, {'{x}'} = slot hex digit</div>
          </div>
          <label htmlFor="b-start">Start number</label>
          <input id="b-start" type="number" value={start} onChange={(e) => setStart(Number(e.target.value))} />
          <label htmlFor="b-dev">Attach devices</label>
          <label className="checkbox">
            <input id="b-dev" type="checkbox" checked={withDevice} onChange={(e) => setWithDevice(e.target.checked)} />
            Add an IpShare for each new net
          </label>
          {withDevice && (
            <>
              <label htmlFor="b-ip1">Address 1 (first)</label>
              <input id="b-ip1" className="mono" value={ip1} onChange={(e) => setIp1(e.target.value.trim())} />
              <label htmlFor="b-ip2">Address 2 (first)</label>
              <input id="b-ip2" className="mono" value={ip2} onChange={(e) => setIp2(e.target.value.trim())} />
              <label htmlFor="b-ip3">Address 3 (first)</label>
              <input id="b-ip3" className="mono" value={ip3} onChange={(e) => setIp3(e.target.value.trim())} />
              <label htmlFor="b-port">Port (all)</label>
              <input id="b-port" className="mono" value={port} onChange={(e) => setPort(e.target.value.trim())} />
              <label htmlFor="b-step">IP step</label>
              <div>
                <input id="b-step" type="number" value={step} onChange={(e) => setStep(Number(e.target.value))} />
                <div className="hint">Added to the last octet of each address for every new net</div>
              </div>
            </>
          )}
        </div>
        {previewRows.length > 0 && (
          <table className="bulk-preview">
            <thead>
              <tr>
                <th>Net</th>
                <th>Name</th>
                {withDevice && <th>Address 1</th>}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r) => (
                <tr key={r.addr}>
                  <td className="mono">{r.addr}</td>
                  <td>{r.name}</td>
                  {withDevice && <td className="mono">{r.ip}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={errors.length > 0} onClick={submit}>
            Add {count} net{count === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
