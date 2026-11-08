import { useMemo, useState } from 'react';
import { defaultValues, renderPrefab, type ParamType, type Prefab, type PrefabParam } from '../../model/prefabs';
import { TemplateError } from '../../model/template';
import { usePrefabs } from '../../state/prefabs';
import { useStore } from '../../state/store';

const TYPES: [ParamType, string][] = [
  ['int', 'Number'],
  ['text', 'Text'],
  ['ip', 'IP address'],
  ['bool', 'Yes/No'],
  ['scheme', 'IP scheme'],
];

function coerce(type: ParamType, v: string): PrefabParam['default'] {
  if (type === 'int') return Number(v) || 0;
  if (type === 'bool') return v === 'true';
  if (type === 'scheme') return ['flat', '/31', '/30'].includes(v) ? v : 'flat';
  return v;
}

/** Create or edit a custom prefab: name, settings and the outline template. */
export function PrefabEditor({ initial, onClose, onSaved }: { initial: Prefab; onClose: () => void; onSaved?: (p: Prefab) => void }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [params, setParams] = useState<PrefabParam[]>(initial.params);
  const [body, setBody] = useState(initial.body);

  const draft: Prefab = { id: initial.id, name, description, params, body };
  const keyErrors = params
    .map((p, i) => (!/^[A-Za-z_]\w*$/.test(p.key) ? `Setting ${i + 1}: key must be letters/numbers, starting with a letter` : params.findIndex((q) => q.key === p.key) !== i ? `Setting “${p.key}” is listed twice` : null))
    .filter((x): x is string => !!x);

  const test = useMemo(() => {
    try {
      return { text: renderPrefab(draft, defaultValues(draft)) };
    } catch (e) {
      if (e instanceof TemplateError) return { error: e.message };
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, body]);

  const errors = [...(name.trim() ? [] : ['Give the prefab a name']), ...keyErrors, ...('error' in test && test.error ? [test.error] : [])];

  const setParam = (i: number, patch: Partial<PrefabParam>) => setParams((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const save = () => {
    if (errors.length) return;
    const p = { ...draft, name: name.trim() };
    usePrefabs.getState().save(p);
    useStore.getState().showToast(`Saved prefab “${p.name}”`, 'info');
    onSaved?.(p);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="pe-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3 id="pe-title">Prefab</h3>
        <div className="form-grid">
          <label htmlFor="pe-name">Name</label>
          <input id="pe-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label htmlFor="pe-desc">Description</label>
          <input id="pe-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="section-title" style={{ marginTop: 14 }}>
          Settings
          <button className="small" onClick={() => setParams((ps) => [...ps, { key: `setting${ps.length + 1}`, label: 'New setting', type: 'int', default: 1 }])}>
            + Setting
          </button>
        </div>
        <table className="param-table">
          <thead>
            <tr>
              <th>Key (used as {'{{key}}'})</th>
              <th>Label</th>
              <th>Type</th>
              <th>Default</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => (
              <tr key={i}>
                <td><input className="mono" value={p.key} onChange={(e) => setParam(i, { key: e.target.value.trim() })} aria-label="Key" /></td>
                <td><input value={p.label} onChange={(e) => setParam(i, { label: e.target.value })} aria-label="Label" /></td>
                <td>
                  <select value={p.type} onChange={(e) => setParam(i, { type: e.target.value as ParamType, default: coerce(e.target.value as ParamType, String(p.default)) })} aria-label="Type">
                    {TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
                  </select>
                </td>
                <td>
                  {p.type === 'scheme' ? (
                    <select value={String(p.default)} onChange={(e) => setParam(i, { default: e.target.value })} aria-label="Default">
                      <option value="flat">flat</option>
                      <option value="/31">/31</option>
                      <option value="/30">/30</option>
                    </select>
                  ) : p.type === 'bool' ? (
                    <input type="checkbox" checked={Boolean(p.default)} onChange={(e) => setParam(i, { default: e.target.checked })} aria-label="Default" />
                  ) : (
                    <input className="mono" value={String(p.default)} onChange={(e) => setParam(i, { default: coerce(p.type, e.target.value) })} aria-label="Default" />
                  )}
                </td>
                <td><button className="small danger" title="Remove setting" onClick={() => setParams((ps) => ps.filter((_, k) => k !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="outline-grid" style={{ marginTop: 12 }}>
          <div className="outline-input">
            <div className="section-title">Outline template</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} aria-label="Template" style={{ minHeight: 220 }} />
            <div className="hint">
              Same as an outline, plus <span className="mono">{'{{expr}}'}</span> to insert settings,{' '}
              <span className="mono">@repeat i 1..count</span> … <span className="mono">@end</span> to repeat lines, and{' '}
              <span className="mono">@if expr</span> … <span className="mono">@end</span>. Functions: <span className="mono">pad(n, 2)</span>,{' '}
              <span className="mono">hex(n)</span>, <span className="mono">ip(base, offset)</span>, <span className="mono">addr(base, i, scheme)</span> (i-th device; /30 and /31 step by subnet). <span className="mono">[3] Name</span> pins a net to slot 3.
            </div>
          </div>
          <div>
            <div className="section-title">Result with default settings</div>
            <pre className="template-test">{'text' in test ? test.text || '(empty)' : ''}</pre>
          </div>
        </div>

        {errors.length > 0 && <ul className="form-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={errors.length > 0} onClick={save}>Save prefab</button>
        </div>
      </div>
    </div>
  );
}
