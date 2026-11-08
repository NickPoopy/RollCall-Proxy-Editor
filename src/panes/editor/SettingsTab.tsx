import { useState } from 'react';
import { addEntry, removeEntry, setEntry } from '../../model/ops';
import { NETNAMES_SECTION } from '../../model/types';
import { useStore } from '../../state/store';
import { CommitInput } from './CommitInput';

/** Known settings, with a short explanation shown as a hint. */
const HINTS: Record<string, string> = {
  ControlPort: 'TCP port the proxy listens on for RollCall control',
  LogPort: 'Port used for logging',
  WindowPos: 'Saved window position of the proxy app',
  UnitName: 'Name of this proxy as reported to the log server',
  LogServerIP: 'Log server address',
  LogServerPort: 'Log server port',
};

function AddRow({ onAdd }: { onAdd: (k: string, v: string) => void }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const submit = () => {
    if (!k.trim()) return;
    onAdd(k.trim(), v);
    setK('');
    setV('');
  };
  return (
    <div className="kv-row add">
      <input placeholder="New key" value={k} onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="New key" />
      <input placeholder="Value" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="New value" />
      <button className="small" onClick={submit} disabled={!k.trim()}>Add</button>
    </div>
  );
}

export function SettingsTab() {
  const doc = useStore((s) => s.doc);
  const version = useStore((s) => s.proxyVersion);
  const { apply, setProxyVersion } = useStore.getState();

  return (
    <div className="settings-tab">
      {doc.sections.map((sec, sIdx) => {
        if (sec.name === NETNAMES_SECTION) return null;
        const hasKv = sec.entries.some((e) => e.type === 'kv' || e.type === 'ipshares');
        return (
          <fieldset key={sIdx} className="settings-section">
            <legend>{sec.name === null ? '(lines before the first section)' : `[${sec.name}]`}</legend>
            {sec.entries.map((e, eIdx) => {
              if (e.type === 'ipshares') {
                return (
                  <div key={eIdx} className="kv-note muted small">
                    IpShare0…{doc.ipShares.length - 1}: {doc.ipShares.length} device line(s). Edit them in the Devices tab.
                  </div>
                );
              }
              if (e.type !== 'kv') return null;
              return (
                <div key={eIdx} className="kv-row" title={HINTS[e.key]}>
                  <CommitInput className="kv-key mono" value={e.key} onCommit={(k) => k.trim() && apply((d) => setEntry(d, sIdx, eIdx, k.trim(), e.value))} aria-label="Key" />
                  <CommitInput className="kv-value mono" value={e.value} onCommit={(v) => apply((d) => setEntry(d, sIdx, eIdx, e.key, v))} aria-label={`${e.key} value`} />
                  <button className="small danger" title="Remove" onClick={() => apply((d) => removeEntry(d, sIdx, eIdx))}>✕</button>
                </div>
              );
            })}
            {!hasKv && <div className="muted small">Empty section</div>}
            {sec.name !== null && <AddRow onAdd={(k, v) => apply((d) => addEntry(d, sIdx, k, v))} />}
          </fieldset>
        );
      })}

      <fieldset className="settings-section app-settings">
        <legend>Preview options (not saved in the file)</legend>
        <div className="kv-row">
          <label htmlFor="pv">Proxy version label</label>
          <CommitInput id="pv" className="mono" value={version} onCommit={(v) => setProxyVersion(v)} />
        </div>
        <p className="muted small">RollCall shows each proxy net with the proxy software version, e.g. “IQ Frames 0000:01:00 (4.9 .0)”.</p>
      </fieldset>
    </div>
  );
}
