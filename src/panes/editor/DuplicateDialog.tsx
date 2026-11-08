import { useMemo, useState } from 'react';
import { cloneSubtree, suggestRename, type CloneOptions, type RenameRule } from '../../model/bulk';
import { OpError } from '../../model/ops';
import type { NetAddr } from '../../model/types';
import { useStore } from '../../state/store';

export function DuplicateDialog({ src, srcName, onClose }: { src: NetAddr; srcName: string; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const suggestion = useMemo(() => suggestRename(srcName), [srcName]);
  const [copies, setCopies] = useState(1);
  const [start, setStart] = useState(suggestion?.next ?? 2);
  const [rules, setRules] = useState<RenameRule[]>(suggestion ? [suggestion.rule] : [{ find: srcName, replace: `${srcName} {n}` }]);
  const [octet, setOctet] = useState<3 | 4>(4);
  const [step, setStep] = useState(10);

  const opts: CloneOptions = { copies, startNumber: start, renameRules: rules, ip: { octet, step } };
  const result = useMemo(() => {
    try {
      return { ok: cloneSubtree(doc, src, opts) } as const;
    } catch (e) {
      if (e instanceof OpError) return { error: e.message } as const;
      throw e;
    }
  }, [doc, src, copies, start, rules, octet, step]); // opts is rebuilt from these each render

  const setRule = (i: number, patch: Partial<RenameRule>) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const submit = () => {
    if (!('ok' in result) || !result.ok) return;
    const first = result.ok.copies[0]?.root;
    if (useStore.getState().apply((d) => cloneSubtree(d, src, opts).doc)) {
      if (first) useStore.getState().select(first, 'editor');
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dup-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3 id="dup-title">
          Duplicate {srcName} <span className="mono muted">({src})</span>
        </h3>
        <p className="muted small" style={{ marginTop: -6 }}>
          Copies the net, everything under it, and all its devices into the next free slots beside it.
        </p>
        <div className="form-grid">
          <label htmlFor="d-copies">Copies</label>
          <input id="d-copies" type="number" min={1} max={14} value={copies} onChange={(e) => setCopies(Number(e.target.value))} autoFocus />
          <label htmlFor="d-start">First number</label>
          <div>
            <input id="d-start" type="number" value={start} onChange={(e) => setStart(Number(e.target.value))} />
            <div className="hint">Used for {'{n}'} in the first copy, then counts up</div>
          </div>
          <label>Rename</label>
          <div className="rules">
            {rules.map((r, i) => (
              <div className="rule-row" key={i}>
                <input value={r.find} placeholder="find" onChange={(e) => setRule(i, { find: e.target.value })} aria-label={`Rule ${i + 1} find`} />
                <span className="muted">→</span>
                <input value={r.replace} placeholder="replace with" onChange={(e) => setRule(i, { replace: e.target.value })} aria-label={`Rule ${i + 1} replace`} />
                <button className="small danger" title="Remove rule" onClick={() => setRules((rs) => rs.filter((_, k) => k !== i))}>✕</button>
              </div>
            ))}
            <button className="small" onClick={() => setRules((rs) => [...rs, { find: '', replace: '' }])}>+ Rule</button>
            <div className="hint">Applied to every name in the copy. {'{n}'} = copy number, {'{n:2}'} = zero-padded. E.g. “F1 ” → “F{'{n}'} ” renames the cards too.</div>
          </div>
          <label htmlFor="d-step">Shift IPs by</label>
          <div className="inline">
            <input id="d-step" type="number" value={step} onChange={(e) => setStep(Number(e.target.value))} style={{ width: '8ch' }} />
            <span className="muted">per copy, on the</span>
            <select value={octet} onChange={(e) => setOctet(Number(e.target.value) as 3 | 4)} aria-label="Octet">
              <option value={4}>last octet (x.x.x.N)</option>
              <option value={3}>3rd octet (x.x.N.x)</option>
            </select>
          </div>
        </div>

        {'ok' in result && result.ok && (
          <table className="bulk-preview">
            <thead>
              <tr>
                <th>Net</th>
                <th>Name</th>
                <th>Nets</th>
                <th>Devices</th>
                <th>First IP</th>
              </tr>
            </thead>
            <tbody>
              {result.ok.copies.map((c) => (
                <tr key={c.root}>
                  <td className="mono">{c.root}</td>
                  <td>{c.name}</td>
                  <td>{c.nets}</td>
                  <td>{c.devices}</td>
                  <td className="mono">{c.firstIp ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {'error' in result && <ul className="form-errors"><li>{result.error}</li></ul>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!('ok' in result)} onClick={submit}>
            Duplicate ×{copies}
          </button>
        </div>
      </div>
    </div>
  );
}
