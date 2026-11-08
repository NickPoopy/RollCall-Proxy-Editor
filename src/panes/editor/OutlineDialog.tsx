import { useMemo, useState } from 'react';
import { applyOutline, exportOutline, parseOutline } from '../../model/bulk';
import { OpError } from '../../model/ops';
import { isValidPort } from '../../model/validate';
import type { NetAddr } from '../../model/types';
import { useStore } from '../../state/store';

const PLACEHOLDER = `Paste from Excel, or type with Tab / spaces for levels:

Kahuna
\tKahuna 1
\t\tKahuna Frame 1\t10.10.85.10
\t\tMAV1_1
\tKahuna 2
\t\tKahuna Frame 2 @ 10.10.85.11:2051, 10.20.85.11`;

export function OutlineDialog({ parent, parentName, onClose }: { parent: NetAddr; parentName: string; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const [text, setText] = useState('');
  const [merge, setMerge] = useState(true);
  const [port, setPort] = useState('2050');

  const parsed = useMemo(() => parseOutline(text), [text]);
  const applied = useMemo(() => {
    if (parsed.rows.length === 0 || !isValidPort(port)) return null;
    try {
      return { ok: applyOutline(doc, parent, parsed.rows, { defaultPort: port, merge }) } as const;
    } catch (e) {
      if (e instanceof OpError) return { error: e.message } as const;
      throw e;
    }
  }, [doc, parent, parsed, merge, port]);

  const plan = applied && 'ok' in applied && applied.ok ? applied.ok.plan : [];
  const newNets = plan.filter((p) => p.status === 'new').length;
  const newDevices = plan.filter((p) => p.device?.status === 'new').length;
  const errors = [
    ...parsed.errors.map((e) => `Line ${e.line + 1}: ${e.message}`),
    ...(applied && 'error' in applied ? [applied.error] : []),
    ...(isValidPort(port) ? [] : ['Default port must be 1–65535']),
  ];
  const canApply = errors.length === 0 && newNets + newDevices > 0;

  const submit = () => {
    if (!canApply) return;
    const first = plan.find((p) => p.status === 'new')?.addr;
    const ok = useStore.getState().apply((d) => applyOutline(d, parent, parsed.rows, { defaultPort: port, merge }).doc);
    if (ok) {
      if (first) useStore.getState().select(first, 'editor');
      onClose();
    }
  };

  const copyBranch = async () => {
    const out = exportOutline(doc, parent, port);
    setText(out);
    try {
      await navigator.clipboard.writeText(out);
      useStore.getState().showToast('Branch copied to the clipboard as an outline. It pastes straight into Excel.', 'info');
    } catch {
      /* clipboard blocked; the text is still in the box */
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="ol-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3 id="ol-title">
          Paste outline into {parentName} <span className="mono muted">({parent})</span>
        </h3>
        <div className="outline-grid">
          <div className="outline-input">
            <textarea
              value={text}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              autoFocus
              aria-label="Outline"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Tab') return;
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: a, selectionEnd: b } = el;
                const next = text.slice(0, a) + '\t' + text.slice(b);
                setText(next);
                requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
              }}
            />
            <div className="hint">
              One net per line. Indent with Tab or spaces for each level, or lay the levels out in Excel columns A, B, C…
              Put addresses after the name in the next cells, or after <span className="mono">@</span>, separated by commas. Format: <span className="mono">ip</span> or <span className="mono">ip:port</span>. Use <span className="mono">-</span> for an unused slot. Lines starting with <span className="mono">#</span> are ignored.
            </div>
          </div>
          <div className="outline-preview" aria-label="Preview">
            {plan.length === 0 ? (
              <p className="muted small">The preview appears here as you type.</p>
            ) : (
              <ul>
                {plan.map((p, i) => (
                  <li key={i} className={`plan-${p.status}`} style={{ paddingLeft: p.depth * 14 }}>
                    <span className="mono muted">{p.addr}</span> {p.name}
                    {p.device && <span className={`mono plan-dev-${p.device.status}`}> @ {p.device.ip}</span>}
                    {p.status === 'existing' && <span className="muted small"> (existing)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="outline-options">
          <label className="checkbox">
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Reuse existing nets with the same name
          </label>
          <label className="checkbox">
            Default port
            <input className="mono" style={{ width: '7ch' }} value={port} onChange={(e) => setPort(e.target.value.trim())} aria-label="Default port" />
          </label>
          <button className="small" onClick={() => void copyBranch()} title="Fill the box with this branch, and copy it for Excel">
            Copy branch as outline
          </button>
        </div>
        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
            {errors.length > 8 && <li>…and {errors.length - 8} more</li>}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canApply} onClick={submit}>
            Add {newNets} net{newNets === 1 ? '' : 's'}, {newDevices} device{newDevices === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
