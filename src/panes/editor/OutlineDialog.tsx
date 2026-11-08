import { useMemo, useState } from 'react';
import { applyOutline, exportOutline, parseOutline } from '../../model/bulk';
import { OpError } from '../../model/ops';
import { isValidPort } from '../../model/validate';
import { BUILTIN_PREFABS, checkParam, defaultValues, renderPrefab, type Prefab, type PrefabParam } from '../../model/prefabs';
import { TemplateError, type Value, type Vars } from '../../model/template';
import type { NetAddr } from '../../model/types';
import { downloadText, usePrefabs } from '../../state/prefabs';
import { useStore } from '../../state/store';
import { PrefabEditor } from './PrefabEditor';

const PLACEHOLDER = `Pick a prefab on the left, paste from Excel, or type with Tab / spaces for levels:

Kahuna
\tKahuna 1
\t\tKahuna Frame 1\t10.10.85.10
\t\tMAV1_1
\tKahuna 2
\t\tKahuna Frame 2 @ 10.10.85.11:2051, 10.20.85.11`;

function ParamField({ p, value, onChange }: { p: PrefabParam; value: Value; onChange: (v: Value) => void }) {
  const err = checkParam(p, value);
  const id = `pf-${p.key}`;
  if (p.type === 'bool') {
    return (
      <label className="checkbox pf-row" title={p.hint}>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {p.label}
      </label>
    );
  }
  return (
    <div className="pf-row">
      <label htmlFor={id}>{p.label}</label>
      <input
        id={id}
        className={`${p.type === 'text' ? '' : 'mono'}${err ? ' invalid' : ''}`}
        type={p.type === 'int' ? 'number' : 'text'}
        min={p.min}
        max={p.max}
        value={String(value)}
        title={err ?? p.hint}
        onChange={(e) => onChange(p.type === 'int' ? e.target.value : e.target.value)}
      />
      {p.hint && <div className="hint">{p.hint}</div>}
    </div>
  );
}

export function OutlineDialog({ parent, parentName, onClose }: { parent: NetAddr; parentName: string; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const custom = usePrefabs((s) => s.custom);
  const [text, setText] = useState('');
  const [merge, setMerge] = useState(true);
  const [port, setPort] = useState('2050');
  const [prefab, setPrefab] = useState<Prefab | null>(null);
  const [values, setValues] = useState<Vars>({});
  const [handEdited, setHandEdited] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Prefab | null>(null);

  const regenerate = (p: Prefab, vals: Vars) => {
    const bad = p.params.map((x) => checkParam(x, vals[x.key] ?? x.default)).find(Boolean);
    if (bad) {
      setTemplateError(bad);
      return;
    }
    try {
      setText(renderPrefab(p, vals));
      setTemplateError(null);
      setHandEdited(false);
    } catch (e) {
      if (e instanceof TemplateError) setTemplateError(e.message);
      else throw e;
    }
  };

  const choose = (p: Prefab) => {
    if (handEdited && !window.confirm('Replace your hand-edited outline with this prefab?')) return;
    const vals = defaultValues(p);
    setPrefab(p);
    setValues(vals);
    regenerate(p, vals);
  };

  const setValue = (key: string, v: Value) => {
    if (!prefab) return;
    const vals = { ...values, [key]: v };
    setValues(vals);
    regenerate(prefab, vals);
  };

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
    ...(templateError ? [`Prefab: ${templateError}`] : []),
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
    setPrefab(null);
    try {
      await navigator.clipboard.writeText(out);
      useStore.getState().showToast('Branch copied to the clipboard as an outline. It pastes straight into Excel.', 'info');
    } catch {
      /* clipboard blocked; the text is still in the box */
    }
  };

  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const n = usePrefabs.getState().importJson(await f.text());
        useStore.getState().showToast(`Imported ${n} prefab${n === 1 ? '' : 's'}`, 'info');
      } catch (e) {
        useStore.getState().showToast(`Could not import: ${(e as Error).message}`);
      }
    };
    input.click();
  };

  const newPrefab = (from?: Prefab) =>
    setEditing({
      id: `custom-${Date.now().toString(36)}`,
      name: from ? `${from.name} (copy)` : 'New prefab',
      description: from?.description ?? '',
      params: from ? from.params.map((p) => ({ ...p })) : [{ key: 'count', label: 'How many', type: 'int', default: 2, min: 1, max: 15 }],
      body: from?.body ?? '@repeat i 1..count\nItem {{pad(i, 2)}}\n@end',
    });

  const item = (p: Prefab) => (
    <li key={p.id} className={prefab?.id === p.id ? 'active' : ''}>
      <button className="tb-pick" onClick={() => choose(p)} title={p.description}>
        {p.name}
      </button>
      {p.builtin ? (
        <button className="small tb-act" title="Copy to My prefabs to customise" onClick={() => newPrefab(p)}>⧉</button>
      ) : (
        <>
          <button className="small tb-act" title="Edit" onClick={() => setEditing(p)}>✎</button>
          <button
            className="small tb-act danger"
            title="Delete"
            onClick={() => {
              if (!window.confirm(`Delete prefab “${p.name}”?`)) return;
              usePrefabs.getState().remove(p.id);
              if (prefab?.id === p.id) setPrefab(null);
            }}
          >
            ✕
          </button>
        </>
      )}
    </li>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal xwide" role="dialog" aria-modal="true" aria-labelledby="ol-title" onKeyDown={(e) => e.key === 'Escape' && !editing && onClose()}>
        <h3 id="ol-title">
          Toolbox: add to {parentName} <span className="mono muted">({parent})</span>
        </h3>
        <div className="toolbox-grid">
          <aside className="toolbox" aria-label="Prefabs">
            <div className="tb-heading">Prefabs</div>
            <ul className="tb-list">{BUILTIN_PREFABS.map(item)}</ul>
            <div className="tb-heading">
              My prefabs
              <button className="small" onClick={() => newPrefab()} title="Write a new prefab">+ New</button>
            </div>
            {custom.length === 0 ? (
              <p className="muted small tb-empty">None yet. Use “Save as prefab…” on any branch, or copy a built-in with ⧉.</p>
            ) : (
              <ul className="tb-list">{custom.map(item)}</ul>
            )}
            <div className="tb-io">
              <button className="small" onClick={importFile} title="Import prefabs from a .json file">Import…</button>
              <button
                className="small"
                disabled={custom.length === 0}
                onClick={() => downloadText(usePrefabs.getState().exportJson(), 'rollcall-prefabs.json')}
                title="Save My prefabs to a .json file to share"
              >
                Export
              </button>
            </div>
          </aside>

          <div className="outline-input">
            {prefab && (
              <div className="prefab-settings">
                <div className="ps-head">
                  <strong>{prefab.name}</strong>
                  <span className="muted small">{prefab.description}</span>
                </div>
                <div className="ps-fields">
                  {prefab.params.map((p) => (
                    <ParamField key={p.key} p={p} value={values[p.key] ?? p.default} onChange={(v) => setValue(p.key, v)} />
                  ))}
                </div>
                {handEdited && <div className="hint">You've edited the outline by hand. Changing a setting will regenerate it.</div>}
              </div>
            )}
            <textarea
              value={text}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              aria-label="Outline"
              onChange={(e) => {
                setText(e.target.value);
                if (prefab) setHandEdited(true);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Tab') return;
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: a, selectionEnd: b } = el;
                setText(text.slice(0, a) + '\t' + text.slice(b));
                if (prefab) setHandEdited(true);
                requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
              }}
            />
            <div className="hint">
              One net per line, indented with Tab or spaces per level (or Excel columns A, B, C…). Addresses go in the next cells or after{' '}
              <span className="mono">@</span>: <span className="mono">ip</span> or <span className="mono">ip:port</span>, <span className="mono">-</span> = unused.{' '}
              <span className="mono">[3] Name</span> pins a net to slot 3. <span className="mono">#</span> = comment.
            </div>
          </div>

          <div className="outline-preview" aria-label="Preview">
            {plan.length === 0 ? (
              <p className="muted small">The preview appears here.</p>
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
      {editing && (
        <PrefabEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            if (prefab?.id === p.id) choose(p);
          }}
        />
      )}
    </div>
  );
}
