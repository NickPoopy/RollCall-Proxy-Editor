import { useState } from 'react';
import { ROOT } from '../model/address';
import { schemeFor } from '../model/ipscheme';
import { BUILTIN_PREFABS, type Prefab } from '../model/prefabs';
import { downloadText, usePrefabs } from '../state/prefabs';
import { useFileSchemes } from '../state/schemes';
import { useStore } from '../state/store';
import { canHoldChildren, runTool, useToolDialog, useToolDrag, type ToolId } from '../state/toolbox';
import { BulkAddDialog } from './editor/BulkAddDialog';
import { OutlineDialog } from './editor/OutlineDialog';
import { PrefabEditor } from './editor/PrefabEditor';

interface CardProps {
  tool: ToolId;
  icon: string;
  title: string;
  hint: string;
  actions?: React.ReactNode;
}

function ToolCard({ tool, icon, title, hint, actions }: CardProps) {
  const selected = useStore((s) => s.selected);
  return (
    <li className="tool-card-wrap">
      <button
        className="tool-card"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', tool);
          useToolDrag.getState().set(tool);
        }}
        onDragEnd={() => useToolDrag.getState().set(null)}
        onClick={() => runTool(tool, selected)}
        title={`${hint}\n\nDrag onto a net in the tree, or click to add to the selected net.`}
      >
        <span className="tool-icon" aria-hidden="true">{icon}</span>
        <span className="tool-text">
          <span className="tool-title">{title}</span>
          <span className="tool-hint">{hint}</span>
        </span>
      </button>
      {actions && <span className="tool-actions">{actions}</span>}
    </li>
  );
}

export function ToolboxPane() {
  const selected = useStore((s) => s.selected);
  const netNames = useStore((s) => s.doc.netNames);
  const custom = usePrefabs((s) => s.custom);
  const [editing, setEditing] = useState<Prefab | null>(null);

  const target = selected ?? ROOT;
  const targetName = netNames.find((n) => n.addr === target)?.name ?? (target === ROOT ? 'the top level' : target);
  const blocked = !canHoldChildren(target);

  const newPrefab = (from?: Prefab) =>
    setEditing({
      id: `custom-${Date.now().toString(36)}`,
      name: from ? `${from.name} (copy)` : 'New prefab',
      description: from?.description ?? '',
      params: from ? from.params.map((p) => ({ ...p })) : [{ key: 'count', label: 'How many', type: 'int', default: 2, min: 1, max: 15 }],
      body: from?.body ?? '@repeat i 1..count\nItem {{pad(i, 2)}}\n@end',
    });

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

  return (
    <section className="pane">
      <div className="pane-header">
        <h2>Toolbox</h2>
      </div>
      <div className="pane-body toolbox-pane">
        <p className={`tb-target small${blocked ? ' sev-warning' : ''}`}>
          {blocked ? (
            <>“{targetName}” is at the deepest level. Select or drop onto a net that can hold children.</>
          ) : (
            <>
              Drag onto a net in the tree, or click to add to <strong>{targetName}</strong>{target !== ROOT && <span className="mono muted"> ({target})</span>}.
            </>
          )}
        </p>

        <div className="tb-heading">Basics</div>
        <ul className="tool-list">
          <ToolCard tool="folder" icon="📁" title="Folder" hint="An empty net to group things under" />
          <ToolCard tool="device" icon="🖥" title="Device" hint="A net with an IpShare on the next free IP" />
          <ToolCard tool="bulk" icon="☰" title="Several children…" hint="N nets with a name pattern and stepping IPs" />
          <ToolCard tool="outline" icon="⇥" title="Outline / Excel paste…" hint="Paste an indented list or Excel columns" />
        </ul>

        <div className="tb-heading">Prefabs</div>
        <ul className="tool-list">
          {BUILTIN_PREFABS.map((p) => (
            <ToolCard
              key={p.id}
              tool={`prefab:${p.id}`}
              icon="▦"
              title={p.name}
              hint={p.description}
              actions={
                <button className="small tb-act" title="Copy to My prefabs to customise" onClick={() => newPrefab(p)}>
                  ⧉
                </button>
              }
            />
          ))}
        </ul>

        <div className="tb-heading">
          My prefabs
          <button className="small" onClick={() => newPrefab()} title="Write a new prefab">+ New</button>
        </div>
        {custom.length === 0 ? (
          <p className="muted small tb-empty">None yet. Use “Save as prefab…” on any branch, or copy a built-in with ⧉.</p>
        ) : (
          <ul className="tool-list">
            {custom.map((p) => (
              <ToolCard
                key={p.id}
                tool={`prefab:${p.id}`}
                icon="★"
                title={p.name}
                hint={p.description || 'Your prefab'}
                actions={
                  <>
                    <button className="small tb-act" title="Edit" onClick={() => setEditing(p)}>✎</button>
                    <button
                      className="small tb-act danger"
                      title="Delete"
                      onClick={() => window.confirm(`Delete prefab “${p.name}”?`) && usePrefabs.getState().remove(p.id)}
                    >
                      ✕
                    </button>
                  </>
                }
              />
            ))}
          </ul>
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
      </div>
      {editing && <PrefabEditor initial={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** Shows the dialog a toolbox drop asked for. */
export function ToolDialogHost() {
  const req = useToolDialog((s) => s.open);
  const fileName = useStore((s) => s.fileName);
  const netNames = useStore((s) => s.doc.netNames);
  const schemes = useFileSchemes(fileName);
  if (!req) return null;
  const close = () => useToolDialog.getState().show(null);
  const name = netNames.find((n) => n.addr === req.parent)?.name ?? (req.parent === ROOT ? 'the top level' : req.parent);
  const scheme = schemeFor(schemes, req.parent);
  if (req.kind === 'bulk') return <BulkAddDialog parent={req.parent} parentName={name} scheme={scheme} onClose={close} />;
  return <OutlineDialog parent={req.parent} parentName={name} scheme={scheme} initialPrefabId={req.prefabId} onClose={close} />;
}
