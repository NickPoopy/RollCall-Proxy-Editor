import { useMemo, useState } from 'react';
import { buildTree } from '../model/tree';
import { useStore } from '../state/store';
import { NodeTree } from './editor/NodeTree';
import { NodeDetails } from './editor/NodeDetails';
import { DevicesTab } from './editor/DevicesTab';
import { SettingsTab } from './editor/SettingsTab';
import { IssuesTab } from './editor/IssuesTab';

type Tab = 'tree' | 'devices' | 'settings' | 'issues';

export function EditorPane() {
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selected);
  const issues = useStore((s) => s.issues);
  const stale = useStore((s) => s.parseErrors.length > 0);
  const tree = useMemo(() => buildTree(doc), [doc]);
  const [tab, setTab] = useState<Tab>('tree');
  const [filter, setFilter] = useState('');
  const [treeCmd, setTreeCmd] = useState<{ kind: 'expand' | 'collapse'; n: number }>();
  const node = (selected && tree.byAddr.get(selected)) || null;
  const problemCount = issues.filter((i) => i.severity !== 'info').length;

  const tabs: [Tab, string][] = [
    ['tree', 'Tree'],
    ['devices', `Devices (${doc.ipShares.length})`],
    ['settings', 'Settings'],
    ['issues', problemCount ? `Issues (${problemCount})` : 'Issues'],
  ];

  return (
    <section className="pane">
      <div className="pane-header tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {stale && (
        <div className="banner banner-error">
          The raw text has errors. Showing the last valid version. Edits here are paused until the text is fixed.
        </div>
      )}
      <div className={`pane-body editor-body${stale ? ' is-stale' : ''}`}>
        {tab === 'tree' && (
          <div className="tree-tab">
            <div className="tree-tools">
              <input type="search" placeholder="Filter by name or address…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter nets" />
              <button className="small" onClick={() => setTreeCmd((c) => ({ kind: 'expand', n: (c?.n ?? 0) + 1 }))} title="Expand every branch">
                Expand all
              </button>
              <button className="small" onClick={() => setTreeCmd((c) => ({ kind: 'collapse', n: (c?.n ?? 0) + 1 }))} title="Collapse to the top level">
                Collapse
              </button>
            </div>
            <NodeTree tree={tree} filter={filter} command={treeCmd} />
            {node ? (
              <NodeDetails node={node} />
            ) : (
              <div className="details muted">Select a net to edit it. Select the root to add top-level items.</div>
            )}
          </div>
        )}
        {tab === 'devices' && <DevicesTab tree={tree} />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'issues' && <IssuesTab onShowTree={() => setTab('tree')} />}
      </div>
    </section>
  );
}
